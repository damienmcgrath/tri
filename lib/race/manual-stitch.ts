import type { SupabaseClient } from "@supabase/supabase-js";
import type { RaceSegmentRole } from "@/lib/workouts/activity-parser";
import { isRaceSession } from "@/lib/training/race-session";
import { triggerRaceReviewBackground } from "@/lib/race-review";
import { snapshotPreRaceState } from "@/lib/race/snapshot-pre-race-state";
import { freezeGoalSnapshot, resolveRaceProfileForBundle } from "@/lib/race/bundle-helpers";

export type ManualStitchSegment = {
  activityId: string;
  role: RaceSegmentRole;
  index: number;
};

export type ManualStitchRaceBundleArgs = {
  supabase: SupabaseClient;
  userId: string;
  segments: ManualStitchSegment[];
};

export type ManualStitchRaceBundleResult =
  | { status: "error"; reason: string }
  | { status: "stitched"; bundleId: string; plannedSessionId: string | null };

/**
 * Manual Strava-stitch path. Skips the `detectRaceBundle` confidence check
 * (the athlete has confirmed) but still validates ownership of every activity
 * and short-circuits if any segment is already part of a bundle. Stamps the
 * bundle with `source = 'manual'`, `inferred_transitions = true`, and runs the
 * same goal-freeze + pre-race snapshot pipeline as the auto path.
 */
export async function manualStitchRaceBundle(
  args: ManualStitchRaceBundleArgs
): Promise<ManualStitchRaceBundleResult> {
  const { supabase, userId, segments } = args;

  if (segments.length < 3) {
    return { status: "error", reason: "fewer_than_three_segments" };
  }

  const activityIds = segments.map((s) => s.activityId);

  const { data: activityRows, error: activityError } = await supabase
    .from("completed_activities")
    .select("id,sport_type,start_time_utc,duration_sec,distance_m,race_bundle_id,user_id")
    .in("id", activityIds)
    .eq("user_id", userId);

  if (activityError) {
    return { status: "error", reason: `activities_query_failed:${activityError.message}` };
  }
  if (!activityRows || activityRows.length !== segments.length) {
    return { status: "error", reason: "activity_ownership_mismatch" };
  }
  if (activityRows.some((row: any) => row.race_bundle_id)) {
    return { status: "error", reason: "activity_already_in_bundle" };
  }

  const ordered = segments
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((segment) => {
      const row = activityRows.find((r: any) => r.id === segment.activityId);
      if (!row) throw new Error("activity_lookup_failed");
      return {
        ...segment,
        startUtc: row.start_time_utc as string,
        durationSec: Number(row.duration_sec ?? 0),
        distanceM: row.distance_m != null ? Number(row.distance_m) : 0
      };
    });

  const startedAt = ordered[0].startUtc;
  const last = ordered[ordered.length - 1];
  const endedAt = new Date(new Date(last.startUtc).getTime() + last.durationSec * 1000).toISOString();
  const totalDurationSec = ordered.reduce((sum, s) => sum + s.durationSec, 0);
  const totalDistanceM = ordered.reduce((sum, s) => sum + s.distanceM, 0);
  const startDate = startedAt.slice(0, 10);

  const profile = await resolveRaceProfileForBundle(supabase, userId, startDate);
  const goalSnapshot = profile ? freezeGoalSnapshot(profile) : null;

  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    started_at: startedAt,
    ended_at: endedAt,
    total_duration_sec: Math.round(totalDurationSec),
    total_distance_m: totalDistanceM || null,
    source: "manual",
    inferred_transitions: true
  };
  if (goalSnapshot) {
    insertPayload.race_profile_id = goalSnapshot.race_profile_id;
    insertPayload.goal_time_sec = goalSnapshot.goal_time_sec;
    insertPayload.goal_strategy_summary = goalSnapshot.goal_strategy_summary;
    insertPayload.course_profile_snapshot = goalSnapshot.course_profile_snapshot;
  }

  const { data: createdBundle, error: bundleError } = await supabase
    .from("race_bundles")
    .insert(insertPayload)
    .select("id")
    .single();

  if (bundleError || !createdBundle) {
    return { status: "error", reason: `bundle_insert_failed:${bundleError?.message}` };
  }
  const bundleId = createdBundle.id as string;

  for (const segment of ordered) {
    const { error: updateError } = await supabase
      .from("completed_activities")
      .update({
        race_bundle_id: bundleId,
        race_segment_role: segment.role,
        race_segment_index: segment.index
      })
      .eq("user_id", userId)
      .eq("id", segment.activityId);

    if (updateError) {
      console.error("[manual-stitch] segment update failed", { id: segment.activityId, err: updateError.message });
    }
  }

  // Best-effort link to a planned race session on the same date.
  const { data: sameDaySessions } = await supabase
    .from("sessions")
    .select("id,sport,type,session_name")
    .eq("user_id", userId)
    .eq("date", startDate);

  const raceSessions = (sameDaySessions ?? []).filter((s: any) =>
    isRaceSession({ type: s.type, session_name: s.session_name })
  );

  let plannedSessionId: string | null = null;
  if (raceSessions.length === 1) {
    plannedSessionId = raceSessions[0].id as string;

    const linkRows = ordered.map((segment) => ({
      user_id: userId,
      planned_session_id: plannedSessionId,
      completed_activity_id: segment.activityId,
      link_type: "auto" as const,
      confidence: 1,
      confirmation_status: "confirmed" as const,
      match_method: "race_bundle" as const,
      match_reason: { kind: "race_bundle", role: segment.role, segmentIndex: segment.index, source: "manual" }
    }));

    const { error: linkError } = await supabase.from("session_activity_links").insert(linkRows);
    if (linkError) {
      console.error("[manual-stitch] link insert failed", linkError.message);
    }
  }

  await snapshotPreRaceState({ supabase, userId, bundleId, raceDate: startDate });

  if (plannedSessionId) {
    triggerRaceReviewBackground({ supabase, userId, bundleId });
  }

  return { status: "stitched", bundleId, plannedSessionId };
}
