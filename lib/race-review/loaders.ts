/**
 * Data loaders for the race-review pipeline.
 *
 * Each function returns a typed view of one slice of data the orchestrator
 * (`generateRaceReview` in `lib/race-review.ts`) needs: the race_bundles
 * row, its segment activities, the linked planned session, the matching
 * race_profiles row, the FTP at race day, the prior comparable race, and
 * the recent training-session pool used by the best-comparable finder.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RaceBundleData,
  RaceProfileForReview,
  RaceSegmentData,
  RaceSegmentRole
} from "@/lib/race-review";
import type { PriorRaceComparison } from "@/lib/race-review/segment-diagnostics";
import type { ComparableCandidate } from "@/lib/race-review/best-comparable";

const BUNDLE_COLUMNS_FOR_REVIEW =
  "id,user_id,started_at,ended_at,total_duration_sec,total_distance_m,source," +
  "goal_time_sec,goal_strategy_summary," +
  "pre_race_ctl,pre_race_atl,pre_race_tsb,pre_race_tsb_state," +
  "taper_compliance_score,taper_compliance_summary," +
  "athlete_rating,athlete_notes,issues_flagged,finish_position,age_group_position," +
  "subjective_captured_at,inferred_transitions";

export async function loadBundle(supabase: SupabaseClient, userId: string, bundleId: string): Promise<RaceBundleData | null> {
  const { data, error } = await supabase
    .from("race_bundles")
    .select(BUNDLE_COLUMNS_FOR_REVIEW)
    .eq("id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Surface the cause so a missing column or RLS denial doesn't masquerade
    // as `bundle_not_found`. Re-throwing forces the API route into its 500
    // path with a readable message instead of "Could not regenerate race
    // review: bundle_not_found".
    throw new Error(`race_bundles select failed: ${error.message}`);
  }
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  return {
    id: row.id as string,
    startedAt: row.started_at as string,
    endedAt: (row.ended_at as string | null) ?? null,
    totalDurationSec: Number(row.total_duration_sec ?? 0),
    totalDistanceM: row.total_distance_m === null || row.total_distance_m === undefined ? null : Number(row.total_distance_m),
    source: row.source as RaceBundleData["source"],
    goalTimeSec: row.goal_time_sec != null ? Number(row.goal_time_sec) : null,
    goalStrategySummary: (row.goal_strategy_summary as string | null) ?? null,
    preRaceCtl: row.pre_race_ctl != null ? Number(row.pre_race_ctl) : null,
    preRaceAtl: row.pre_race_atl != null ? Number(row.pre_race_atl) : null,
    preRaceTsb: row.pre_race_tsb != null ? Number(row.pre_race_tsb) : null,
    preRaceTsbState: (row.pre_race_tsb_state as RaceBundleData["preRaceTsbState"]) ?? null,
    taperComplianceScore: row.taper_compliance_score != null ? Number(row.taper_compliance_score) : null,
    taperComplianceSummary: (row.taper_compliance_summary as string | null) ?? null,
    athleteRating: row.athlete_rating != null ? Number(row.athlete_rating) : null,
    athleteNotes: (row.athlete_notes as string | null) ?? null,
    issuesFlagged: Array.isArray(row.issues_flagged) ? (row.issues_flagged as string[]) : [],
    finishPosition: row.finish_position != null ? Number(row.finish_position) : null,
    ageGroupPosition: row.age_group_position != null ? Number(row.age_group_position) : null,
    subjectiveCapturedAt: (row.subjective_captured_at as string | null) ?? null,
    inferredTransitions: Boolean(row.inferred_transitions)
  };
}

export async function loadSegments(supabase: SupabaseClient, userId: string, bundleId: string): Promise<RaceSegmentData[]> {
  const { data } = await supabase
    .from("completed_activities")
    .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,race_segment_role,race_segment_index,metrics_v2")
    .eq("user_id", userId)
    .eq("race_bundle_id", bundleId)
    .order("race_segment_index", { ascending: true });

  return (data ?? [])
    .filter((row: any) => row.race_segment_role && row.race_segment_index !== null)
    .map((row: any) => ({
      activityId: row.id as string,
      role: row.race_segment_role as RaceSegmentRole,
      segmentIndex: Number(row.race_segment_index),
      sportType: row.sport_type as string,
      durationSec: Number(row.duration_sec ?? 0),
      distanceM: row.distance_m === null || row.distance_m === undefined ? null : Number(row.distance_m),
      avgHr: row.avg_hr === null || row.avg_hr === undefined ? null : Number(row.avg_hr),
      avgPower: row.avg_power === null || row.avg_power === undefined ? null : Number(row.avg_power),
      metricsV2: (row.metrics_v2 ?? null) as Record<string, unknown> | null
    }));
}

export async function loadPlannedSession(supabase: SupabaseClient, userId: string, plannedSessionId: string | null) {
  if (!plannedSessionId) return null;
  const { data } = await supabase
    .from("sessions")
    .select("id,type,session_name,target")
    .eq("id", plannedSessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    type: (data.type as string | null) ?? null,
    sessionName: (data.session_name as string | null) ?? null,
    target: (data.target as string | null) ?? null
  };
}

export async function loadRaceProfile(supabase: SupabaseClient, userId: string, bundleDateIso: string): Promise<RaceProfileForReview | null> {
  const date = bundleDateIso.slice(0, 10);
  const { data } = await supabase
    .from("race_profiles")
    .select("id,name,date,distance_type,ideal_discipline_distribution")
    .eq("user_id", userId)
    .eq("date", date)
    .order("priority", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    date: data.date as string,
    distanceType: data.distance_type as string,
    idealDisciplineDistribution: (data.ideal_discipline_distribution ?? null) as RaceProfileForReview["idealDisciplineDistribution"]
  };
}

export async function resolvePlannedSessionId(supabase: SupabaseClient, userId: string, segmentIds: string[]): Promise<string | null> {
  if (segmentIds.length === 0) return null;
  const { data } = await supabase
    .from("session_activity_links")
    .select("planned_session_id,confirmation_status")
    .eq("user_id", userId)
    .eq("match_method", "race_bundle")
    .in("completed_activity_id", segmentIds);
  const confirmed = (data ?? []).filter(
    (row: any) => row.confirmation_status === "confirmed" || row.confirmation_status === null
  );
  const ids = new Set(confirmed.map((row: any) => row.planned_session_id as string));
  if (ids.size !== 1) return null;
  return [...ids][0];
}

// ─── Phase 1C loaders ───────────────────────────────────────────────────────

/**
 * Returns the most-recent FTP value recorded on or before the race date.
 * Returns null when no FTP entry exists.
 */
export async function loadFtpAtRace(
  supabase: SupabaseClient,
  athleteId: string,
  raceDateIso: string
): Promise<number | null> {
  const date = raceDateIso.slice(0, 10);
  const { data } = await supabase
    .from("athlete_ftp_history")
    .select("value,recorded_at")
    .eq("athlete_id", athleteId)
    .lte("recorded_at", date)
    .order("recorded_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const v = (data as Record<string, unknown>).value;
  return typeof v === "number" && v > 0 ? v : null;
}

/**
 * Find the most-recent prior race bundle by the same athlete at the same
 * distance type, before this race. Returns null when no prior race exists.
 * Distance type is sourced from race_profiles.
 */
export async function loadPriorRaceComparison(
  supabase: SupabaseClient,
  userId: string,
  thisBundleId: string,
  thisRaceDateIso: string,
  distanceType: string | null
): Promise<PriorRaceComparison | null> {
  if (!distanceType) return null;
  const date = thisRaceDateIso.slice(0, 10);

  const { data: priorProfiles } = await supabase
    .from("race_profiles")
    .select("id,name,date,distance_type")
    .eq("user_id", userId)
    .eq("distance_type", distanceType)
    .lt("date", date)
    .order("date", { ascending: false })
    .limit(5);
  if (!priorProfiles || priorProfiles.length === 0) return null;

  // Walk the candidates newest-first looking for a corresponding bundle.
  for (const profile of priorProfiles) {
    const profileDate = profile.date as string;
    const { data: priorBundle } = await supabase
      .from("race_bundles")
      .select("id,started_at")
      .eq("user_id", userId)
      .neq("id", thisBundleId)
      .gte("started_at", `${profileDate}T00:00:00.000Z`)
      .lt("started_at", `${profileDate}T23:59:59.999Z`)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!priorBundle) continue;

    const bundleId = priorBundle.id as string;
    const { data: segments } = await supabase
      .from("completed_activities")
      .select("race_segment_role,duration_sec")
      .eq("user_id", userId)
      .eq("race_bundle_id", bundleId);
    const legDurations: PriorRaceComparison["legDurations"] = { swim: null, bike: null, run: null };
    for (const row of segments ?? []) {
      const role = (row as any).race_segment_role as string | null;
      const dur = Number((row as any).duration_sec ?? 0);
      if (role === "swim" || role === "bike" || role === "run") {
        legDurations[role] = dur > 0 ? dur : null;
      }
    }
    return {
      bundleId,
      raceName: profile.name as string,
      raceDate: profileDate,
      legDurations
    };
  }
  return null;
}

/**
 * Recent completed-session pool for the best-comparable finder. 12-week
 * window ending at the race date; only sessions that already linked to a
 * completed activity (so we know they actually happened with a duration).
 */
export async function loadRecentSessionPool(
  supabase: SupabaseClient,
  userId: string,
  raceDateIso: string
): Promise<ComparableCandidate[]> {
  const raceDate = new Date(raceDateIso);
  const windowStart = new Date(raceDate.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const raceDateOnly = raceDateIso.slice(0, 10);

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,session_role,duration_minutes,status")
    .eq("user_id", userId)
    .gte("date", windowStartIso)
    .lt("date", raceDateOnly)
    .eq("status", "completed");

  const out: ComparableCandidate[] = [];
  for (const row of sessions ?? []) {
    const sport = (row as any).sport as string;
    if (sport !== "swim" && sport !== "bike" && sport !== "run") continue;
    const minutes = Number((row as any).duration_minutes ?? 0);
    if (minutes <= 0) continue;
    out.push({
      sessionId: (row as any).id as string,
      date: (row as any).date as string,
      sport,
      durationSec: minutes * 60,
      sessionName: ((row as any).session_name as string | null) ?? null,
      type: ((row as any).type as string | null) ?? null,
      sessionRole: ((row as any).session_role as string | null) ?? null
    });
  }
  return out;
}
