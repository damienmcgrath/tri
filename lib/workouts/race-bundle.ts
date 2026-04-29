import type { SupabaseClient } from "@supabase/supabase-js";
import { isRaceSession } from "@/lib/training/race-session";
import { detectRaceBundle, type RaceCandidate } from "@/lib/workouts/race-detection";
import type { RaceSegmentRole } from "@/lib/workouts/activity-parser";
import { triggerRaceReviewBackground } from "@/lib/race-review";

export type PersistMultisportBundleArgs = {
  supabase: SupabaseClient;
  userId: string;
  uploadId: string;
  bundle: {
    startedAt: string;
    endedAt: string;
    totalDurationSec: number;
    totalDistanceM: number;
  };
  /**
   * Activity rows already inserted into completed_activities, in segment order.
   * Each must include the resolved id, sport_type, start_time_utc, duration_sec,
   * plus the role assigned at parse time.
   */
  segments: Array<{
    activityId: string;
    role: RaceSegmentRole;
    segmentIndex: number;
  }>;
};

export type PersistMultisportBundleResult =
  | { status: "linked"; bundleId: string; plannedSessionId: string | null }
  | { status: "error"; reason: string };

/**
 * Persists a Garmin auto_multi_sport bundle: creates the race_bundles row,
 * stamps each child activity with bundle metadata, and (when a planned race
 * session is present same-day) creates confirmed session_activity_links.
 */
export async function persistMultisportBundle(
  args: PersistMultisportBundleArgs
): Promise<PersistMultisportBundleResult> {
  const { supabase, userId, uploadId, bundle, segments } = args;

  if (segments.length === 0) {
    return { status: "error", reason: "no_segments" };
  }

  const { data: createdBundle, error: bundleError } = await supabase
    .from("race_bundles")
    .insert({
      user_id: userId,
      started_at: bundle.startedAt,
      ended_at: bundle.endedAt,
      total_duration_sec: Math.round(bundle.totalDurationSec),
      total_distance_m: bundle.totalDistanceM || null,
      source: "garmin_multisport",
      upload_id: uploadId
    })
    .select("id")
    .single();

  if (bundleError || !createdBundle) {
    return { status: "error", reason: `bundle_insert_failed:${bundleError?.message}` };
  }
  const bundleId = createdBundle.id as string;

  for (const segment of segments) {
    const { error: updateError } = await supabase
      .from("completed_activities")
      .update({
        race_bundle_id: bundleId,
        race_segment_role: segment.role,
        race_segment_index: segment.segmentIndex
      })
      .eq("user_id", userId)
      .eq("id", segment.activityId);
    if (updateError) {
      console.error("[race-bundle] segment update failed", { id: segment.activityId, err: updateError.message });
    }
  }

  // Find a planned race session for the same local date.
  const startDate = bundle.startedAt.slice(0, 10);
  const { data: sameDaySessions } = await supabase
    .from("sessions")
    .select("id,sport,type,session_name")
    .eq("user_id", userId)
    .eq("date", startDate);

  const raceSessions = (sameDaySessions ?? []).filter((s: any) =>
    isRaceSession({ type: s.type, session_name: s.session_name })
  );

  if (raceSessions.length !== 1) {
    return { status: "linked", bundleId, plannedSessionId: null };
  }
  const plannedSessionId = raceSessions[0].id as string;

  const linkRows = segments.map((segment) => ({
    user_id: userId,
    planned_session_id: plannedSessionId,
    completed_activity_id: segment.activityId,
    link_type: "auto" as const,
    confidence: 1,
    confirmation_status: "confirmed" as const,
    match_method: "race_bundle" as const,
    match_reason: { kind: "race_bundle", role: segment.role, segmentIndex: segment.segmentIndex, source: "garmin_multisport" }
  }));

  const { error: linkError } = await supabase.from("session_activity_links").insert(linkRows);
  if (linkError) {
    console.error("[race-bundle] link insert failed", linkError.message);
    return { status: "error", reason: `link_insert_failed:${linkError.message}` };
  }

  // Only fire the race-review generator when the bundle is attached to a
  // planned race session — ad-hoc bundles without a planned target are out
  // of scope for v2.
  if (plannedSessionId) {
    triggerRaceReviewBackground({ supabase, userId, bundleId });
  }
  return { status: "linked", bundleId, plannedSessionId };
}

export type AttemptRaceBundleArgs = {
  supabase: SupabaseClient;
  userId: string;
  /** Local-date (YYYY-MM-DD) to scan for a race shape. */
  date: string;
  /** How the bundle was produced. */
  source: "garmin_multisport" | "strava_reconstructed" | "manual";
  /** Optional originating upload (used for source=garmin_multisport). */
  uploadId?: string | null;
};

export type AttemptRaceBundleResult =
  | { status: "skipped"; reason: string }
  | {
      status: "bundled";
      bundleId: string;
      plannedSessionId: string;
      segmentIds: string[];
    };

function startOfDayIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function endOfDayIso(date: string): string {
  return `${date}T23:59:59.999Z`;
}

/**
 * Detect and persist a race bundle for a single user/day.
 *
 * Idempotent: bails if any candidate is already part of a bundle, or if a race
 * shape isn't present, or if there isn't exactly one planned race session that day.
 */
export async function attemptRaceBundle(
  args: AttemptRaceBundleArgs
): Promise<AttemptRaceBundleResult> {
  const { supabase, userId, date, source, uploadId } = args;

  const { data: sameDaySessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,duration_minutes")
    .eq("user_id", userId)
    .eq("date", date);

  if (sessionsError) {
    return { status: "skipped", reason: `sessions_query_failed:${sessionsError.message}` };
  }

  const raceSessions = (sameDaySessions ?? []).filter((s: any) =>
    isRaceSession({ type: s.type, session_name: s.session_name })
  );

  if (raceSessions.length === 0) return { status: "skipped", reason: "no_race_session" };
  if (raceSessions.length > 1) return { status: "skipped", reason: "multiple_race_sessions" };
  const plannedSession = raceSessions[0];

  const { data: activities, error: activitiesError } = await supabase
    .from("completed_activities")
    .select("id,sport_type,start_time_utc,duration_sec,distance_m,race_bundle_id,race_segment_role,race_segment_index")
    .eq("user_id", userId)
    .gte("start_time_utc", startOfDayIso(date))
    .lte("start_time_utc", endOfDayIso(date))
    .order("start_time_utc", { ascending: true });

  if (activitiesError) {
    return { status: "skipped", reason: `activities_query_failed:${activitiesError.message}` };
  }

  const activityRows = activities ?? [];
  if (activityRows.length < 3) {
    return { status: "skipped", reason: "fewer_than_three_activities" };
  }

  const { data: existingLinks } = await supabase
    .from("session_activity_links")
    .select("completed_activity_id,planned_session_id,confirmation_status,match_method")
    .eq("user_id", userId)
    .in("completed_activity_id", activityRows.map((a: any) => a.id as string));

  // Self-heal: a previous run may have created the bundle + stamped activities
  // but failed before inserting links. If every activity is already in the same
  // bundle (with role/index), just create the missing links.
  const bundledActivities = activityRows.filter((a: any) => a.race_bundle_id);
  if (bundledActivities.length > 0) {
    const allBundled = bundledActivities.length === activityRows.length;
    const sameBundle = allBundled
      && activityRows.every((a: any) => a.race_bundle_id === bundledActivities[0].race_bundle_id);
    const allRolesPresent = sameBundle
      && activityRows.every((a: any) => a.race_segment_role && a.race_segment_index !== null);

    if (sameBundle && allRolesPresent) {
      const bundleId = bundledActivities[0].race_bundle_id as string;
      const confirmedForThisSession = (existingLinks ?? []).filter((l: any) =>
        l.planned_session_id === plannedSession.id
        && (l.confirmation_status === "confirmed" || l.confirmation_status === null)
      );
      if (confirmedForThisSession.length === activityRows.length) {
        return { status: "skipped", reason: "already_bundled_and_linked" };
      }

      // Drop any stale links pointing at other planned sessions for these activities.
      const linkedActivityIdsToReplace = (existingLinks ?? [])
        .filter((l: any) => l.planned_session_id !== plannedSession.id)
        .map((l: any) => l.completed_activity_id as string);
      if (linkedActivityIdsToReplace.length > 0) {
        await supabase
          .from("session_activity_links")
          .delete()
          .eq("user_id", userId)
          .in("completed_activity_id", linkedActivityIdsToReplace);
      }

      // Drop any partial confirmed-for-this-session links so we can re-insert cleanly.
      await supabase
        .from("session_activity_links")
        .delete()
        .eq("user_id", userId)
        .eq("planned_session_id", plannedSession.id)
        .in("completed_activity_id", activityRows.map((a: any) => a.id as string));

      const orderedRows = [...activityRows].sort(
        (a: any, b: any) => (a.race_segment_index ?? 0) - (b.race_segment_index ?? 0)
      );

      const linkRows = orderedRows.map((row: any) => ({
        user_id: userId,
        planned_session_id: plannedSession.id,
        completed_activity_id: row.id,
        link_type: "auto" as const,
        confidence: 1,
        confirmation_status: "confirmed" as const,
        match_method: "race_bundle" as const,
        match_reason: {
          kind: "race_bundle",
          role: row.race_segment_role,
          segmentIndex: row.race_segment_index,
          source,
          recovered: true
        }
      }));

      const { error: linkError } = await supabase.from("session_activity_links").insert(linkRows);
      if (linkError) {
        return { status: "skipped", reason: `link_insert_failed:${linkError.message}` };
      }

      triggerRaceReviewBackground({ supabase, userId, bundleId });
      return {
        status: "bundled",
        bundleId,
        plannedSessionId: plannedSession.id,
        segmentIds: orderedRows.map((row: any) => row.id as string)
      };
    }

    // Mixed state: some bundled, some not — bail rather than guess.
    return { status: "skipped", reason: "partial_bundle_state" };
  }

  const linkedConfirmedIds = new Set(
    (existingLinks ?? [])
      .filter((l: any) => l.confirmation_status === "confirmed")
      .map((l: any) => l.completed_activity_id as string)
  );
  const linkedSuggestedIds = new Set(
    (existingLinks ?? [])
      .filter((l: any) => l.confirmation_status !== "confirmed")
      .map((l: any) => l.completed_activity_id as string)
  );

  // Confirmed links must be cleared before re-bundling. We don't auto-blow them away.
  if (activityRows.some((a: any) => linkedConfirmedIds.has(a.id))) {
    return { status: "skipped", reason: "confirmed_links_exist" };
  }

  const candidates: RaceCandidate[] = activityRows.map((a: any) => ({
    id: a.id as string,
    sport: a.sport_type as string,
    startUtc: a.start_time_utc as string,
    durationSec: Number(a.duration_sec) || 0
  }));

  const detection = detectRaceBundle(candidates, {
    plannedDurationMin: plannedSession.duration_minutes ?? null
  });

  if (!detection.matched) {
    return { status: "skipped", reason: detection.reason };
  }

  const segments = detection.orderedSegments;
  const segmentIds = segments.map((s) => s.id);

  // Bundle window from first to last segment.
  const startedAt = segments[0].startUtc;
  const lastSeg = segments[segments.length - 1];
  const endedAt = new Date(
    new Date(lastSeg.startUtc).getTime() + Math.max(0, lastSeg.durationSec) * 1000
  ).toISOString();
  const totalDurationSec = segments.reduce((sum, s) => sum + s.durationSec, 0);

  // Sum distances from rows (detection only carries duration).
  const distanceById = new Map(
    activityRows.map((a: any) => [a.id as string, Number(a.distance_m ?? 0) || 0])
  );
  const totalDistanceM = segmentIds.reduce((sum, id) => sum + (distanceById.get(id) ?? 0), 0);

  const { data: createdBundle, error: bundleError } = await supabase
    .from("race_bundles")
    .insert({
      user_id: userId,
      started_at: startedAt,
      ended_at: endedAt,
      total_duration_sec: Math.round(totalDurationSec),
      total_distance_m: totalDistanceM || null,
      source,
      upload_id: uploadId ?? null
    })
    .select("id")
    .single();

  if (bundleError || !createdBundle) {
    return { status: "skipped", reason: `bundle_insert_failed:${bundleError?.message}` };
  }
  const bundleId = createdBundle.id as string;

  // Update child activities one-by-one with their role + index.
  for (const segment of segments) {
    const { error: updateError } = await supabase
      .from("completed_activities")
      .update({
        race_bundle_id: bundleId,
        race_segment_role: segment.role,
        race_segment_index: segment.index
      })
      .eq("user_id", userId)
      .eq("id", segment.id);

    if (updateError) {
      console.error("[race-bundle] segment update failed", { id: segment.id, err: updateError.message });
    }
  }

  // Clear suggested-only links so we can replace them with confirmed bundle links.
  if (linkedSuggestedIds.size > 0) {
    await supabase
      .from("session_activity_links")
      .delete()
      .eq("user_id", userId)
      .in("completed_activity_id", [...linkedSuggestedIds]);
  }

  // Create confirmed links for every segment → planned race session.
  const linkRows = segments.map((segment) => ({
    user_id: userId,
    planned_session_id: plannedSession.id,
    completed_activity_id: segment.id,
    link_type: "auto" as const,
    confidence: 1,
    confirmation_status: "confirmed" as const,
    match_method: "race_bundle" as const,
    match_reason: { kind: "race_bundle", role: segment.role, segmentIndex: segment.index, source }
  }));

  const { error: linkError } = await supabase.from("session_activity_links").insert(linkRows);
  if (linkError) {
    console.error("[race-bundle] link insert failed", linkError.message);
    return { status: "skipped", reason: `link_insert_failed:${linkError.message}` };
  }

  triggerRaceReviewBackground({ supabase, userId, bundleId });
  return {
    status: "bundled",
    bundleId,
    plannedSessionId: plannedSession.id,
    segmentIds
  };
}
