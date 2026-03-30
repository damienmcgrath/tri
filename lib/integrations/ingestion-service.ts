/**
 * Strava ingestion service.
 *
 * Provider-agnostic pipeline:
 *   fetch activity → normalize → dedupe check → insert → session match
 *
 * Uses the Supabase service-role client (via token-service pattern) so this
 * module works both in authenticated routes and webhook routes (no user session).
 * All queries scope explicitly to userId.
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchActivity, fetchRecentActivitiesWithRateLimit } from "./providers/strava/client";
import { shouldThrottle } from "./providers/strava/rate-limiter";
import { normalizeStravaActivity } from "./providers/strava/normalizer";
import { refreshIfExpired, updateSyncStatus, type ExternalConnection } from "./token-service";
import { syncSessionLoad } from "@/lib/training/load-sync";
import { suggestSessionMatches, pickBestSuggestion } from "@/lib/workouts/matching-service";
import { findCrossSourceDuplicate, mergeStravaIntoExisting } from "./cross-source-dedup";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IngestResult = {
  imported: number;
  skipped: number;
  matched: number;
};

export type IngestOneResult =
  | { status: "imported"; activityId: string; matched: boolean }
  | { status: "skipped" }
  | { status: "merged" };

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /(is_unplanned|schedule_status|schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

/** Strip columns that may not exist yet (migration not applied) and retry insert. */
async function insertActivity(
  supabase: SupabaseClient,
  normalized: Record<string, unknown>
): Promise<{ data: any; error: any }> {
  const result = await supabase
    .from("completed_activities")
    .insert(normalized)
    .select("id,start_time_utc,sport_type,duration_sec,distance_m")
    .single();

  if (!result.error || !isMissingColumnError(result.error)) {
    return result;
  }

  // Retry without optional columns
  const { is_unplanned, schedule_status, ...safe } = normalized as any;
  return supabase
    .from("completed_activities")
    .insert(safe)
    .select("id,start_time_utc,sport_type,duration_sec,distance_m")
    .single();
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role credentials not configured");
  }
  return createSupabaseClient(url, key);
}

async function logSyncEvent(
  userId: string,
  provider: string,
  eventType: string,
  externalActivityId: string | null,
  status: "ok" | "skipped" | "error",
  rawPayload: Record<string, unknown>,
  errorMessage?: string
): Promise<void> {
  const supabase = getAdminClient();
  await supabase.from("external_sync_log").insert({
    user_id: userId,
    provider,
    event_type: eventType,
    external_activity_id: externalActivityId,
    status,
    raw_payload: rawPayload,
    error_message: errorMessage ?? null
  });
}

type CreatedActivity = {
  id: string;
  start_time_utc: string;
  sport_type: string;
  duration_sec: number;
  distance_m: string | number | null;
};

/**
 * Try to auto-match a newly imported activity to a planned session.
 * Returns true if a match was created.
 */
async function matchActivity(
  supabase: SupabaseClient,
  userId: string,
  created: CreatedActivity
): Promise<boolean> {
  const start = new Date(created.start_time_utc);
  const windowStart = new Date(start.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(start.getTime() + 6 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = await supabase
    .from("sessions")
    .select("id,sport,date,duration_minutes,intent_category")
    .eq("user_id", userId)
    .gte("date", windowStart.slice(0, 10))
    .lte("date", windowEnd.slice(0, 10));

  const candidateIntentById = new Map<string, string | null>(
    (candidates ?? []).map((candidate: any) => [candidate.id as string, candidate.intent_category ?? null])
  );

  const suggestions = suggestSessionMatches(
    {
      id: created.id,
      userId,
      sportType: created.sport_type,
      startTimeUtc: created.start_time_utc,
      durationSec: created.duration_sec,
      distanceM: Number(created.distance_m ?? 0)
    },
    (candidates ?? []).map((c: { id: string; sport: string; date: string; duration_minutes: number | null }) => ({
      id: c.id,
      userId,
      date: c.date,
      sport: c.sport,
      type: c.sport,
      durationMinutes: c.duration_minutes,
      distanceM: null
    }))
  );

  const best = pickBestSuggestion(suggestions);
  if (!best) return false;

  const { error: linkError } = await supabase.from("session_activity_links").insert({
    user_id: userId,
    planned_session_id: best.plannedSessionId,
    completed_activity_id: created.id,
    link_type: "auto",
    confidence: best.confidence,
    match_reason: best.reason,
    confirmation_status: "suggested",
    match_method: best.matchMethod
  });

  if (linkError) return false;

  try {
    await syncSessionLoad(
      supabase,
      userId,
      created.id,
      best.plannedSessionId,
      candidateIntentById.get(best.plannedSessionId) ?? null
    );
  } catch (syncError) {
    console.error("[training-load] Failed to sync auto-matched activity load:", syncError);
  }

  return true;
}

// ─── Core ingest ──────────────────────────────────────────────────────────────

/**
 * Import a single Strava activity for a user.
 *
 * Idempotent: returns 'skipped' if the activity is already in completed_activities.
 * The caller is responsible for ensuring `connection` has a valid (not-expired) token.
 */
export async function ingestStravaActivity(
  userId: string,
  stravaActivityId: string | number,
  connection: ExternalConnection
): Promise<IngestOneResult> {
  const supabase = getAdminClient();
  const externalId = String(stravaActivityId);

  console.log(`[INGEST] START userId=${userId} activityId=${externalId}`);

  // 1. Dedup check
  const { data: existing } = await supabase
    .from("completed_activities")
    .select("id")
    .eq("user_id", userId)
    .eq("external_provider", "strava")
    .eq("external_activity_id", externalId)
    .maybeSingle();

  if (existing) {
    console.log(`[INGEST] SKIPPED (already imported) activityId=${externalId}`);
    await logSyncEvent(userId, "strava", "activity_skipped", externalId, "skipped", {});
    return { status: "skipped" };
  }

  // 2. Fetch raw activity from Strava
  let raw;
  try {
    raw = await fetchActivity(connection.accessToken, externalId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown fetch error";
    console.error(`[INGEST] FETCH_ERROR activityId=${externalId}:`, msg);
    await logSyncEvent(userId, "strava", "activity_fetch_error", externalId, "error", {}, msg);
    throw err;
  }

  // 3. Log raw payload
  await logSyncEvent(userId, "strava", "activity_fetched", externalId, "ok", raw as Record<string, unknown>);

  // 4. Normalize
  const normalized = normalizeStravaActivity(raw, userId);

  // 4b. Cross-source dedup — check if a FIT/TCX upload already has this workout
  const crossMatch = await findCrossSourceDuplicate(
    userId,
    normalized.sport_type,
    normalized.start_time_utc,
    normalized.duration_sec
  );
  if (crossMatch) {
    console.log(`[INGEST] MERGED activityId=${externalId} into existing ${crossMatch.existingId} (source: ${crossMatch.existingSource})`);
    await mergeStravaIntoExisting(crossMatch.existingId, externalId, normalized.external_title);
    await logSyncEvent(userId, "strava", "activity_merged", externalId, "ok", { mergedInto: crossMatch.existingId });
    return { status: "merged" };
  }

  // 5. Insert (ON CONFLICT DO NOTHING for safety — partial index handles dedup)
  const { data: created, error: insertError } = await insertActivity(supabase, normalized);

  if (insertError) {
    // If it's a uniqueness violation the row already exists — treat as skipped
    if (insertError.code === "23505") {
      console.log(`[INGEST] SKIPPED (conflict) activityId=${externalId}`);
      return { status: "skipped" };
    }
    console.error(`[INGEST] INSERT_ERROR activityId=${externalId}:`, insertError.message);
    await logSyncEvent(userId, "strava", "activity_insert_error", externalId, "error", {}, insertError.message);
    throw new Error(`Failed to insert activity: ${insertError.message}`);
  }

  if (!created) {
    // Shouldn't happen, but guard defensively
    return { status: "skipped" };
  }

  console.log(`[INGEST] IMPORTED activityId=${externalId} completedActivityId=${created.id}`);

  // 6. Session matching
  const matched = await matchActivity(supabase, userId, created);
  if (matched) {
    console.log(`[INGEST] MATCHED activityId=${externalId}`);
  } else {
    console.log(`[INGEST] NO_MATCH activityId=${externalId}`);
  }

  await logSyncEvent(userId, "strava", "activity_imported", externalId, "ok", { matched });

  return { status: "imported", activityId: created.id, matched };
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

/**
 * Import recent Strava activities for a user.
 *
 * Uses the list endpoint (GET /athlete/activities) which returns summaries —
 * this avoids hitting per-activity endpoints and respects Strava's rate limits.
 * Stops early with partial results if approaching the 15-minute rate limit.
 */
export async function backfillRecentActivities(
  userId: string,
  connection: ExternalConnection,
  syncWindowDays: number = 7
): Promise<IngestResult> {
  console.log(`[INGEST] BACKFILL START userId=${userId} window=${syncWindowDays}d`);

  // Refresh token if needed before starting
  const freshConnection = await refreshIfExpired(connection);

  const afterSec = Math.floor((Date.now() - syncWindowDays * 24 * 60 * 60 * 1000) / 1000);
  const result: IngestResult = { imported: 0, skipped: 0, matched: 0 };

  let page = 1;
  const perPage = 50;

  while (true) {
    let activities;
    let throttled = false;

    try {
      const { data, rateLimit } = await fetchRecentActivitiesWithRateLimit(freshConnection.accessToken, {
        after: afterSec,
        page,
        perPage
      });
      activities = data;

      if (rateLimit && shouldThrottle(rateLimit)) {
        console.log(`[INGEST] BACKFILL THROTTLED — 15min usage ${rateLimit.usage15min}/${rateLimit.limit15min}`);
        throttled = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fetch error";
      console.error(`[INGEST] BACKFILL_FETCH_ERROR page=${page}:`, msg);
      await updateSyncStatus(userId, "strava", "error", `Backfill fetch failed: ${msg}`);
      throw err;
    }

    if (activities.length === 0) break;

    for (const activity of activities) {
      try {
        const externalId = String(activity.id);

        // Dedup check first (fast path)
        const supabase = getAdminClient();
        const { data: existing } = await supabase
          .from("completed_activities")
          .select("id")
          .eq("user_id", userId)
          .eq("external_provider", "strava")
          .eq("external_activity_id", externalId)
          .maybeSingle();

        if (existing) {
          result.skipped++;
          continue;
        }

        // Normalize and insert from list summary (has all fields needed)
        const normalized = normalizeStravaActivity(activity, userId);

        // Cross-source dedup — check if a FIT/TCX upload already has this workout
        const crossMatch = await findCrossSourceDuplicate(
          userId,
          normalized.sport_type,
          normalized.start_time_utc,
          normalized.duration_sec
        );
        if (crossMatch) {
          console.log(`[INGEST] BACKFILL MERGED activityId=${externalId} into existing ${crossMatch.existingId}`);
          await mergeStravaIntoExisting(crossMatch.existingId, externalId, normalized.external_title);
          result.skipped++;
          continue;
        }

        const { data: created, error: insertError } = await insertActivity(supabase, normalized);

        if (insertError) {
          if (insertError.code === "23505") {
            result.skipped++;
            continue;
          }
          console.error(`[INGEST] BACKFILL_INSERT_ERROR activityId=${externalId}:`, insertError.message);
          result.skipped++;
          continue;
        }

        if (!created) {
          result.skipped++;
          continue;
        }

        result.imported++;

        const matched = await matchActivity(supabase, userId, created);
        if (matched) result.matched++;
      } catch (err) {
        console.error(`[INGEST] BACKFILL_ACTIVITY_ERROR activityId=${activity.id}:`, err);
        result.skipped++;
      }
    }

    // Stop pagination if throttled or fewer results than requested
    if (throttled || activities.length < perPage) break;
    page++;
  }

  console.log(`[INGEST] BACKFILL DONE userId=${userId}`, result);
  await updateSyncStatus(userId, "strava", "ok", undefined, {
    importedCount: result.imported,
    skippedCount: result.skipped
  });
  return result;
}
