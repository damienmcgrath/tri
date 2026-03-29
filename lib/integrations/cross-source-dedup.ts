/**
 * Cross-source deduplication.
 *
 * Detects when a FIT/TCX upload and a Strava import represent the same workout.
 * FIT data takes priority (richer metrics) — when a Strava duplicate is found,
 * we merge the Strava metadata (external ID, title) into the existing FIT row
 * instead of inserting a new row.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role credentials not configured");
  }
  return createSupabaseClient(url, key);
}

/** Window for matching start times (±2 minutes). */
const START_TIME_WINDOW_MS = 2 * 60 * 1000;

/** Max percentage difference in duration for a match. */
const DURATION_TOLERANCE = 0.10;

export type CrossSourceMatch = {
  existingId: string;
  existingSource: string;
};

/**
 * Find an existing completed_activity from a different source that matches
 * the given sport type, start time (±2 min), and duration (±10%).
 *
 * Returns the match or null if no duplicate found.
 */
export async function findCrossSourceDuplicate(
  userId: string,
  sportType: string,
  startTimeUtc: string,
  durationSec: number
): Promise<CrossSourceMatch | null> {
  const supabase = getAdminClient();
  const start = new Date(startTimeUtc);
  const windowStart = new Date(start.getTime() - START_TIME_WINDOW_MS).toISOString();
  const windowEnd = new Date(start.getTime() + START_TIME_WINDOW_MS).toISOString();

  const { data: candidates, error } = await supabase
    .from("completed_activities")
    .select("id,source,duration_sec")
    .eq("user_id", userId)
    .eq("sport_type", sportType)
    .gte("start_time_utc", windowStart)
    .lte("start_time_utc", windowEnd);

  if (error || !candidates || candidates.length === 0) return null;

  // Find the best match by duration proximity
  for (const candidate of candidates) {
    const candidateDuration = candidate.duration_sec as number;
    if (candidateDuration === 0 && durationSec === 0) {
      return { existingId: candidate.id as string, existingSource: candidate.source as string };
    }
    const ref = Math.max(candidateDuration, durationSec);
    const diff = Math.abs(candidateDuration - durationSec) / ref;
    if (diff <= DURATION_TOLERANCE) {
      return { existingId: candidate.id as string, existingSource: candidate.source as string };
    }
  }

  return null;
}

/**
 * Merge Strava metadata into an existing FIT/TCX-sourced activity.
 * Updates the existing row with Strava's external_activity_id and external_title
 * so the activity is linked to Strava without duplicating data.
 */
export async function mergeStravaIntoExisting(
  existingId: string,
  stravaExternalId: string,
  stravaTitle: string
): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("completed_activities")
    .update({
      external_provider: "strava",
      external_activity_id: stravaExternalId,
      external_title: stravaTitle
    })
    .eq("id", existingId);

  if (error) {
    console.error("[CROSS_DEDUP] mergeStravaIntoExisting error:", error.message);
    throw new Error(`Failed to merge Strava data: ${error.message}`);
  }

  console.log(`[CROSS_DEDUP] Merged strava:${stravaExternalId} into existing activity ${existingId}`);
}
