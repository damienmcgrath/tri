import type { SupabaseClient } from "@supabase/supabase-js";
import type { RaceSegmentSummary } from "@/app/(protected)/sessions/[sessionId]/components/race-segment-list";

export type RaceProfileSnapshotInput = {
  id: string;
  name: string | null;
  date: string;
  distance_type: string | null;
  priority: string | null;
  goal_time_sec: number | null;
  goal_strategy_summary: string | null;
  course_profile: Record<string, unknown> | null;
  notes: string | null;
};

export type FrozenGoalSnapshot = {
  race_profile_id: string;
  goal_time_sec: number | null;
  goal_strategy_summary: string | null;
  course_profile_snapshot: Record<string, unknown>;
};

/**
 * Look up the same-day `race_profiles` row for a bundle. Mirrors the
 * date-based lookup pattern in attemptRaceBundle. Returns null when there is
 * no profile (or more than one — caller should not guess).
 */
export async function resolveRaceProfileForBundle(
  supabase: SupabaseClient,
  userId: string,
  bundleStartDateLocal: string
): Promise<RaceProfileSnapshotInput | null> {
  const { data, error } = await supabase
    .from("race_profiles")
    .select("id, name, date, distance_type, priority, goal_time_sec, goal_strategy_summary, course_profile, notes")
    .eq("user_id", userId)
    .eq("date", bundleStartDateLocal);

  if (error || !data || data.length !== 1) return null;
  const row = data[0] as RaceProfileSnapshotInput;
  return row;
}

/**
 * Build the immutable goal snapshot from a race profile. Used at insert time
 * (and once during self-heal) so that future edits to the race profile do not
 * silently mutate a race that's already been raced.
 */
export function freezeGoalSnapshot(profile: RaceProfileSnapshotInput): FrozenGoalSnapshot {
  return {
    race_profile_id: profile.id,
    goal_time_sec: profile.goal_time_sec ?? null,
    goal_strategy_summary: profile.goal_strategy_summary ?? null,
    course_profile_snapshot: (profile.course_profile ?? {}) as Record<string, unknown>
  };
}

export type RaceBundleSummary = {
  bundle: {
    id: string;
    user_id: string;
    started_at: string;
    ended_at: string | null;
    total_duration_sec: number;
    total_distance_m: number | null;
    source: "garmin_multisport" | "strava_reconstructed" | "manual";
    race_profile_id: string | null;
    goal_time_sec: number | null;
    goal_strategy_summary: string | null;
    course_profile_snapshot: Record<string, unknown>;
    pre_race_ctl: number | null;
    pre_race_atl: number | null;
    pre_race_tsb: number | null;
    pre_race_tsb_state: "fresh" | "absorbing" | "fatigued" | "overreaching" | null;
    pre_race_ramp_rate: number | null;
    pre_race_snapshot_at: string | null;
    pre_race_snapshot_status: "pending" | "captured" | "partial" | "unavailable";
    taper_compliance_score: number | null;
    taper_compliance_summary: string | null;
    athlete_rating: number | null;
    athlete_notes: string | null;
    issues_flagged: string[];
    finish_position: number | null;
    age_group_position: number | null;
    subjective_captured_at: string | null;
    status: "imported" | "reviewed" | "archived";
    inferred_transitions: boolean;
  };
  raceProfile: {
    id: string;
    name: string;
    date: string;
    distance_type: string | null;
  } | null;
  segments: RaceSegmentSummary[];
  review: {
    headline: string | null;
    narrative: string | null;
    coach_take: string | null;
    transition_notes: string | null;
    pacing_notes: unknown;
    discipline_distribution_actual: Record<string, number> | null;
    discipline_distribution_delta: Record<string, number> | null;
    is_provisional: boolean;
    generated_at: string | null;
    /** Phase 1B Layer 1 — Verdict (structured). */
    verdict: unknown;
    /** Phase 1B Layer 2 — Race Story (structured). */
    race_story: unknown;
    /** Per-leg deterministic status snapshot. */
    leg_status: unknown;
    /** Set only when emotional-frame trigger fired. */
    emotional_frame: string | null;
    /** Set only when cross-discipline gate detected a hypothesis. */
    cross_discipline_insight: string | null;
    /** Pre-computed series for the unified pacing arc visualization. */
    pacing_arc_data: unknown;
    /** Tone-guard telemetry for the spot-check audit. */
    tone_violations: unknown;
    model_used: string | null;
  } | null;
};

const BUNDLE_COLUMNS =
  "id,user_id,started_at,ended_at,total_duration_sec,total_distance_m,source," +
  "race_profile_id,goal_time_sec,goal_strategy_summary,course_profile_snapshot," +
  "pre_race_ctl,pre_race_atl,pre_race_tsb,pre_race_tsb_state,pre_race_ramp_rate," +
  "pre_race_snapshot_at,pre_race_snapshot_status,taper_compliance_score,taper_compliance_summary," +
  "athlete_rating,athlete_notes,issues_flagged,finish_position,age_group_position,subjective_captured_at," +
  "status,inferred_transitions";

/**
 * Single source of truth for the AI-free race summary route. Returns the
 * bundle row, the (optional) linked race profile, ordered segments, and the
 * (optional) AI race review for the embed slot. Returns null when the bundle
 * is missing or not owned by `userId`.
 */
export async function loadRaceBundleSummary(
  supabase: SupabaseClient,
  userId: string,
  bundleId: string
): Promise<RaceBundleSummary | null> {
  const { data: bundleRow, error: bundleError } = await supabase
    .from("race_bundles")
    .select(BUNDLE_COLUMNS)
    .eq("id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (bundleError || !bundleRow) return null;

  const bundle = normalizeBundleRow(bundleRow as unknown as Record<string, unknown>);

  let raceProfile: RaceBundleSummary["raceProfile"] = null;
  if (bundle.race_profile_id) {
    const { data: profileRow } = await supabase
      .from("race_profiles")
      .select("id, name, date, distance_type")
      .eq("id", bundle.race_profile_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (profileRow) {
      raceProfile = {
        id: profileRow.id as string,
        name: profileRow.name as string,
        date: profileRow.date as string,
        distance_type: (profileRow.distance_type as string | null) ?? null
      };
    }
  }

  const { data: segmentRows } = await supabase
    .from("completed_activities")
    .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,race_segment_role,race_segment_index")
    .eq("user_id", userId)
    .eq("race_bundle_id", bundleId)
    .order("race_segment_index", { ascending: true });

  const segments: RaceSegmentSummary[] = (segmentRows ?? [])
    .filter((row: any) => row.race_segment_role)
    .map((row: any) => ({
      activityId: row.id as string,
      role: row.race_segment_role as RaceSegmentSummary["role"],
      sport: row.sport_type as string,
      startTimeUtc: row.start_time_utc as string,
      durationSec: Number(row.duration_sec ?? 0),
      distanceM: row.distance_m !== null && row.distance_m !== undefined ? Number(row.distance_m) : null,
      avgHr: row.avg_hr !== null && row.avg_hr !== undefined ? Number(row.avg_hr) : null,
      avgPower: row.avg_power !== null && row.avg_power !== undefined ? Number(row.avg_power) : null
    }));

  const { data: reviewRow } = await supabase
    .from("race_reviews")
    .select(
      "headline,narrative,coach_take,transition_notes,pacing_notes," +
        "discipline_distribution_actual,discipline_distribution_delta," +
        "verdict,race_story,leg_status,emotional_frame,cross_discipline_insight," +
        "pacing_arc_data,tone_violations,model_used,is_provisional,generated_at"
    )
    .eq("race_bundle_id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();

  const reviewRecord = reviewRow ? (reviewRow as unknown as Record<string, unknown>) : null;
  const review: RaceBundleSummary["review"] = reviewRecord
    ? {
        headline: (reviewRecord.headline as string | null) ?? null,
        narrative: (reviewRecord.narrative as string | null) ?? null,
        coach_take: (reviewRecord.coach_take as string | null) ?? null,
        transition_notes: (reviewRecord.transition_notes as string | null) ?? null,
        pacing_notes: reviewRecord.pacing_notes ?? null,
        discipline_distribution_actual:
          (reviewRecord.discipline_distribution_actual as Record<string, number> | null) ?? null,
        discipline_distribution_delta:
          (reviewRecord.discipline_distribution_delta as Record<string, number> | null) ?? null,
        verdict: reviewRecord.verdict ?? null,
        race_story: reviewRecord.race_story ?? null,
        leg_status: reviewRecord.leg_status ?? null,
        emotional_frame: (reviewRecord.emotional_frame as string | null) ?? null,
        cross_discipline_insight: (reviewRecord.cross_discipline_insight as string | null) ?? null,
        pacing_arc_data: reviewRecord.pacing_arc_data ?? null,
        tone_violations: reviewRecord.tone_violations ?? null,
        model_used: (reviewRecord.model_used as string | null) ?? null,
        is_provisional: Boolean(reviewRecord.is_provisional),
        generated_at: (reviewRecord.generated_at as string | null) ?? null
      }
    : null;

  return { bundle, raceProfile, segments, review };
}

function normalizeBundleRow(row: Record<string, unknown>): RaceBundleSummary["bundle"] {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    started_at: row.started_at as string,
    ended_at: (row.ended_at as string | null) ?? null,
    total_duration_sec: Number(row.total_duration_sec ?? 0),
    total_distance_m: row.total_distance_m != null ? Number(row.total_distance_m) : null,
    source: row.source as "garmin_multisport" | "strava_reconstructed" | "manual",
    race_profile_id: (row.race_profile_id as string | null) ?? null,
    goal_time_sec: row.goal_time_sec != null ? Number(row.goal_time_sec) : null,
    goal_strategy_summary: (row.goal_strategy_summary as string | null) ?? null,
    course_profile_snapshot: (row.course_profile_snapshot as Record<string, unknown> | null) ?? {},
    pre_race_ctl: row.pre_race_ctl != null ? Number(row.pre_race_ctl) : null,
    pre_race_atl: row.pre_race_atl != null ? Number(row.pre_race_atl) : null,
    pre_race_tsb: row.pre_race_tsb != null ? Number(row.pre_race_tsb) : null,
    pre_race_tsb_state: (row.pre_race_tsb_state as "fresh" | "absorbing" | "fatigued" | "overreaching" | null) ?? null,
    pre_race_ramp_rate: row.pre_race_ramp_rate != null ? Number(row.pre_race_ramp_rate) : null,
    pre_race_snapshot_at: (row.pre_race_snapshot_at as string | null) ?? null,
    pre_race_snapshot_status:
      (row.pre_race_snapshot_status as "pending" | "captured" | "partial" | "unavailable" | null) ?? "pending",
    taper_compliance_score: row.taper_compliance_score != null ? Number(row.taper_compliance_score) : null,
    taper_compliance_summary: (row.taper_compliance_summary as string | null) ?? null,
    athlete_rating: row.athlete_rating != null ? Number(row.athlete_rating) : null,
    athlete_notes: (row.athlete_notes as string | null) ?? null,
    issues_flagged: Array.isArray(row.issues_flagged) ? (row.issues_flagged as string[]) : [],
    finish_position: row.finish_position != null ? Number(row.finish_position) : null,
    age_group_position: row.age_group_position != null ? Number(row.age_group_position) : null,
    subjective_captured_at: (row.subjective_captured_at as string | null) ?? null,
    status: (row.status as "imported" | "reviewed" | "archived" | null) ?? "imported",
    inferred_transitions: Boolean(row.inferred_transitions)
  };
}
