/**
 * Strava metrics_v2 backfill.
 *
 * Re-fetches existing Strava activities from the detailed endpoint and
 * updates their database rows with the enriched normalizer output
 * (metrics_v2, laps, pace, power analytics, etc.).
 *
 * Respects Strava rate limits: pauses between batches and stops early
 * if approaching the 15-minute window ceiling.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchActivity } from "./providers/strava/client";
import { normalizeStravaActivity } from "./providers/strava/normalizer";
import { refreshIfExpired, type ExternalConnection } from "./token-service";
import { StravaRateLimitError } from "./providers/strava/rate-limiter";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BackfillResult = {
  updated: number;
  skipped: number;
  failed: number;
  rateLimited: boolean;
  total: number;
};

export type BackfillProgress = {
  current: number;
  total: number;
  updated: number;
  failed: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role credentials not configured");
  }
  return createSupabaseClient(url, key);
}

/** Delay between individual fetches to stay under Strava rate limits. */
const FETCH_DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Core backfill ────────────────────────────────────────────────────────────

/**
 * Re-fetch all Strava activities for a user from the detailed endpoint
 * and update their metrics_v2, laps, pace, and other enriched fields.
 *
 * Only processes activities that are missing metrics_v2 (or have no
 * schemaVersion). Activities already backfilled are skipped.
 */
export async function backfillStravaMetrics(
  userId: string,
  connection: ExternalConnection,
  onProgress?: (progress: BackfillProgress) => void
): Promise<BackfillResult> {
  const supabase = getAdminClient();

  // Find all Strava activities missing metrics_v2
  const { data: activities, error: queryError } = await supabase
    .from("completed_activities")
    .select("id,external_activity_id,sport_type,start_time_utc,duration_sec,distance_m")
    .eq("user_id", userId)
    .eq("external_provider", "strava")
    .order("start_time_utc", { ascending: false });

  if (queryError) {
    throw new Error(`Failed to query Strava activities: ${queryError.message}`);
  }

  if (!activities || activities.length === 0) {
    return { updated: 0, skipped: 0, failed: 0, rateLimited: false, total: 0 };
  }

  // Filter to only activities that need backfilling
  // We need to check metrics_v2 separately since the column might be large
  const { data: withMetrics } = await supabase
    .from("completed_activities")
    .select("id,metrics_v2")
    .eq("user_id", userId)
    .eq("external_provider", "strava");

  const alreadyBackfilled = new Set<string>();
  if (withMetrics) {
    for (const row of withMetrics) {
      const mv2 = row.metrics_v2 as Record<string, unknown> | null;
      // Only consider fully enriched if laps is a real array (not null) —
      // summary-only imports set schemaVersion and laps:null from the normalizer,
      // but only the detail endpoint populates laps with actual data.
      if (mv2 && mv2.schemaVersion != null && Array.isArray(mv2.laps)) {
        alreadyBackfilled.add(row.id);
      }
    }
  }

  const needsBackfill = activities.filter((a) => !alreadyBackfilled.has(a.id));

  if (needsBackfill.length === 0) {
    return { updated: 0, skipped: activities.length, failed: 0, rateLimited: false, total: activities.length };
  }

  console.log(`[BACKFILL] ${needsBackfill.length} of ${activities.length} Strava activities need metrics_v2 backfill for user ${userId}`);

  // Refresh token before starting
  let freshConnection = await refreshIfExpired(connection);

  const result: BackfillResult = {
    updated: 0,
    skipped: alreadyBackfilled.size,
    failed: 0,
    rateLimited: false,
    total: activities.length
  };

  for (let i = 0; i < needsBackfill.length; i++) {
    const activity = needsBackfill[i];
    const externalId = activity.external_activity_id;

    if (!externalId) {
      result.skipped++;
      continue;
    }

    try {
      // Re-refresh token if needed mid-backfill
      if (i > 0 && i % 20 === 0) {
        freshConnection = await refreshIfExpired(freshConnection);
      }

      // Fetch detailed activity from Strava
      const raw = await fetchActivity(freshConnection.accessToken, externalId);

      // Re-normalize with the enriched normalizer
      const normalized = normalizeStravaActivity(raw, userId);

      // Update the existing row with enriched fields
      const { error: updateError } = await supabase
        .from("completed_activities")
        .update({
          end_time_utc: normalized.end_time_utc,
          elapsed_duration_sec: normalized.elapsed_duration_sec,
          moving_duration_sec: normalized.moving_duration_sec,
          avg_pace_per_100m_sec: normalized.avg_pace_per_100m_sec,
          laps_count: normalized.laps_count,
          avg_cadence: normalized.avg_cadence,
          avg_hr: normalized.avg_hr,
          max_hr: normalized.max_hr,
          avg_power: normalized.avg_power,
          max_power: normalized.max_power,
          elevation_gain_m: normalized.elevation_gain_m,
          activity_type_raw: normalized.activity_type_raw,
          metrics_v2: normalized.metrics_v2
        })
        .eq("id", activity.id)
        .eq("user_id", userId);

      if (updateError) {
        console.error(`[BACKFILL] UPDATE_ERROR activityId=${externalId}:`, updateError.message);
        result.failed++;
      } else {
        result.updated++;
        console.log(`[BACKFILL] UPDATED ${i + 1}/${needsBackfill.length} activityId=${externalId}`);
      }
    } catch (err) {
      if (err instanceof StravaRateLimitError) {
        console.warn(`[BACKFILL] RATE_LIMITED at ${i + 1}/${needsBackfill.length} — stopping early`);
        result.rateLimited = true;
        break;
      }
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[BACKFILL] FETCH_ERROR activityId=${externalId}:`, msg);
      result.failed++;
    }

    // Report progress
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: needsBackfill.length,
        updated: result.updated,
        failed: result.failed
      });
    }

    // Rate-limit delay between fetches
    if (i < needsBackfill.length - 1) {
      await delay(FETCH_DELAY_MS);
    }
  }

  console.log(`[BACKFILL] DONE userId=${userId}`, result);
  return result;
}
