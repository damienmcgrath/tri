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

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchActivity, fetchRecentActivities } from "./providers/strava/client";
import { normalizeStravaActivity } from "./providers/strava/normalizer";
import { refreshIfExpired, updateSyncStatus, type ExternalConnection } from "./token-service";
import { suggestSessionMatches, pickBestSuggestion } from "@/lib/workouts/matching-service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IngestResult = {
  imported: number;
  skipped: number;
  matched: number;
};

export type IngestOneResult =
  | { status: "imported"; activityId: string; matched: boolean }
  | { status: "skipped" };

// ─── Internal helpers ─────────────────────────────────────────────────────────

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

  // 5. Insert (ON CONFLICT DO NOTHING for safety — partial index handles dedup)
  const { data: created, error: insertError } = await supabase
    .from("completed_activities")
    .insert(normalized)
    .select("id,start_time_utc,sport_type,duration_sec,distance_m")
    .single();

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

  // 6. Session matching — same window query as the file upload route
  const start = new Date(created.start_time_utc);
  const windowStart = new Date(start.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(start.getTime() + 6 * 60 * 60 * 1000).toISOString();

  const { data: candidates } = await supabase
    .from("sessions")
    .select("id,sport,date,duration_minutes")
    .eq("user_id", userId)
    .gte("date", windowStart.slice(0, 10))
    .lte("date", windowEnd.slice(0, 10));

  const suggestions = suggestSessionMatches(
    {
      id: created.id,
      userId,
      sportType: created.sport_type,
      startTimeUtc: created.start_time_utc,
      durationSec: created.duration_sec,
      distanceM: Number(created.distance_m ?? 0)
    },
    (candidates ?? []).map((candidate: { id: string; sport: string; date: string; duration_minutes: number | null }) => ({
      id: candidate.id,
      userId,
      date: candidate.date,
      sport: candidate.sport,
      type: candidate.sport,
      durationMinutes: candidate.duration_minutes,
      distanceM: null
    }))
  );

  const best = pickBestSuggestion(suggestions);
  let matched = false;

  if (best) {
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

    if (!linkError) {
      matched = true;
      console.log(`[INGEST] MATCHED activityId=${externalId} → session ${best.plannedSessionId} (confidence ${best.confidence})`);
    } else {
      console.error(`[INGEST] LINK_ERROR activityId=${externalId}:`, linkError.message);
    }
  } else {
    console.log(`[INGEST] NO_MATCH activityId=${externalId}`);
  }

  await logSyncEvent(userId, "strava", "activity_imported", externalId, "ok", { matched });

  return { status: "imported", activityId: created.id, matched };
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

/**
 * Import the last 7 days of Strava activities for a user.
 *
 * Uses the list endpoint (GET /athlete/activities) which returns summaries —
 * this avoids hitting per-activity endpoints and respects Strava's rate limits.
 * Processes activities sequentially to stay well within the 100 req/15min limit.
 */
export async function backfillRecentActivities(
  userId: string,
  connection: ExternalConnection
): Promise<IngestResult> {
  console.log(`[INGEST] BACKFILL START userId=${userId}`);

  // Refresh token if needed before starting
  const freshConnection = await refreshIfExpired(connection);

  const ninetyDaysAgoSec = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const result: IngestResult = { imported: 0, skipped: 0, matched: 0 };

  let page = 1;
  const perPage = 50;

  while (true) {
    let activities;
    try {
      activities = await fetchRecentActivities(freshConnection.accessToken, {
        after: ninetyDaysAgoSec,
        page,
        perPage
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Fetch error";
      console.error(`[INGEST] BACKFILL_FETCH_ERROR page=${page}:`, msg);
      await updateSyncStatus(userId, "strava", "error", `Backfill fetch failed: ${msg}`);
      throw err;
    }

    if (activities.length === 0) break;

    for (const activity of activities) {
      try {
        // For the list endpoint we already have summary data — use it directly
        // instead of fetching each activity individually (saves API rate limit)
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

        const { data: created, error: insertError } = await supabase
          .from("completed_activities")
          .insert(normalized)
          .select("id,start_time_utc,sport_type,duration_sec,distance_m")
          .single();

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

        // Session matching
        const start = new Date(created.start_time_utc);
        const windowStart = new Date(start.getTime() - 6 * 60 * 60 * 1000).toISOString();
        const windowEnd = new Date(start.getTime() + 6 * 60 * 60 * 1000).toISOString();

        const { data: candidates } = await supabase
          .from("sessions")
          .select("id,sport,date,duration_minutes")
          .eq("user_id", userId)
          .gte("date", windowStart.slice(0, 10))
          .lte("date", windowEnd.slice(0, 10));

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
        if (best) {
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
          if (!linkError) result.matched++;
        }
      } catch (err) {
        console.error(`[INGEST] BACKFILL_ACTIVITY_ERROR activityId=${activity.id}:`, err);
        result.skipped++;
      }
    }

    // If fewer results than requested, we're done
    if (activities.length < perPage) break;
    page++;
  }

  console.log(`[INGEST] BACKFILL DONE userId=${userId}`, result);
  await updateSyncStatus(userId, "strava", "ok");
  return result;
}
