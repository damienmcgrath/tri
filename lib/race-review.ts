/**
 * AI race review pipeline (Phase 1B — Verdict + Race Story).
 *
 * Given a race_bundle (multi-segment swim/T1/bike/T2/run race), load the
 * bundle + segments + planned session + race profile + Phase 1A subjective
 * inputs + pre-race state snapshot, compute deterministic facts, then
 * synthesize the two-layer AI output:
 *
 *   Layer 1 — Verdict (headline, per-discipline status, Coach Take, optional
 *             emotional frame)
 *   Layer 2 — Race Story (overall narrative, per-leg narratives with key
 *             evidence, transitions, optional cross-discipline insight)
 *
 * Plus pre-computed pacing-arc series for the unified visualization.
 *
 * Generation is GATED on `subjective_captured_at` — Phase 1A's notes form
 * must be submitted before Layer 1+2 run. Re-fires when notes update so
 * the review reflects the athlete's account.
 *
 * Triggers: fire-and-forget after persistMultisportBundle / attemptRaceBundle
 * via triggerRaceReviewBackground; after subjective input save; manual via
 * POST /api/race-reviews/[bundleId]/regenerate.
 */

import "openai/shims/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { getCoachModel } from "@/lib/openai";
import { getMetricsV2Laps } from "@/lib/workouts/metrics-v2";
import {
  raceReviewLayersSchema,
  type RaceReviewLayers,
  type Verdict,
  type RaceStory,
  LEG_STATUS_LABELS
} from "@/lib/race-review/schemas";
import { classifyLegStatus, type LegStatusLabel, type LegStatusResult } from "@/lib/race-review/leg-status";
import {
  detectCrossDisciplineSignal,
  athleteAccountSuppressesInsight,
  type CrossDisciplineSignal
} from "@/lib/race-review/cross-discipline";
import { buildPacingArcData, type PacingArcData } from "@/lib/race-review/pacing-arc";
import {
  scanForToneViolations,
  buildReinforcementSystemMessage,
  type ToneViolation
} from "@/lib/race-review/tone-guard";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RaceSegmentRole = "swim" | "t1" | "bike" | "t2" | "run";

export type RaceSegmentData = {
  activityId: string;
  role: RaceSegmentRole;
  segmentIndex: number;
  sportType: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  avgPower: number | null;
  metricsV2: Record<string, unknown> | null;
};

export type RaceBundleData = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  totalDurationSec: number;
  totalDistanceM: number | null;
  source: "garmin_multisport" | "strava_reconstructed" | "manual";
  goalTimeSec: number | null;
  goalStrategySummary: string | null;
  preRaceCtl: number | null;
  preRaceAtl: number | null;
  preRaceTsb: number | null;
  preRaceTsbState: "fresh" | "absorbing" | "fatigued" | "overreaching" | null;
  taperComplianceScore: number | null;
  taperComplianceSummary: string | null;
  athleteRating: number | null;
  athleteNotes: string | null;
  issuesFlagged: string[];
  finishPosition: number | null;
  ageGroupPosition: number | null;
  subjectiveCapturedAt: string | null;
  inferredTransitions: boolean;
};

export type RaceProfileForReview = {
  id: string;
  name: string;
  date: string;
  distanceType: string;
  idealDisciplineDistribution: { swim: number; bike: number; run: number; strength?: number } | null;
};

export type DisciplineDistribution = Partial<Record<RaceSegmentRole, number>>;

export type LegPacing =
  | { halvesAvailable: false }
  | {
      halvesAvailable: true;
      firstHalf: number;
      lastHalf: number;
      deltaPct: number;
      unit: "watts" | "sec_per_km" | "sec_per_100m";
    };

export type RaceFacts = {
  bundle: RaceBundleData;
  segments: RaceSegmentData[];
  plannedSession: { id: string; type: string | null; sessionName: string | null; target: string | null } | null;
  raceProfile: RaceProfileForReview | null;
  disciplineDistributionActual: DisciplineDistribution;
  disciplineDistributionDelta: { swim?: number; bike?: number; run?: number } | null;
  pacing: { swim?: LegPacing; bike?: LegPacing; run?: LegPacing };
  transitions: { t1DurationSec: number | null; t2DurationSec: number | null };
  /** Goal delta in seconds (actual − goal). Positive = slower than goal. */
  goalDeltaSec: number | null;
  /** Per-leg HR drift (first-half avg → second-half avg) in bpm. */
  hrDrift: { swim: number | null; bike: number | null; run: number | null };
  /** Deterministic per-leg status labels handed to the AI. */
  legStatus: { swim: LegStatusResult | null; bike: LegStatusResult | null; run: LegStatusResult | null };
  /** Cross-discipline insight gate result; AI sees `null` when not detected. */
  crossDisciplineSignal: CrossDisciplineSignal;
  /**
   * True when the deterministic emotional-frame trigger fires (actual >5%
   * above goal, athlete rating ≤2, or notes/issues mention illness/injury/
   * mechanical/major issue). The AI only writes emotionalFrame prose when
   * this is true.
   */
  emotionalFrameTriggered: boolean;
};

/**
 * Legacy single-narrative shape — kept for backward-compatibility with
 * existing test fixtures and the deterministic fallback. The Phase 1B
 * pipeline projects from this into the structured layers when AI fails.
 */
export type RaceReviewNarrative = {
  headline: string;
  narrative: string;
  coachTake: string;
  transitionNotes: string | null;
  pacingNotes: {
    swim: { note: string } | null;
    bike: { note: string } | null;
    run: { note: string } | null;
  };
};

export const raceReviewNarrativeSchema = z.object({
  headline: z.string().min(1).max(120),
  narrative: z.string().min(1).max(420),
  coachTake: z.string().min(1).max(220),
  transitionNotes: z.string().max(220).nullable(),
  pacingNotes: z.object({
    swim: z.object({ note: z.string().min(1).max(220) }).nullable(),
    bike: z.object({ note: z.string().min(1).max(220) }).nullable(),
    run: z.object({ note: z.string().min(1).max(220) }).nullable()
  })
});

// ─── Public surface ─────────────────────────────────────────────────────────

export type GenerateRaceReviewArgs = {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
};

export type GenerateRaceReviewResult =
  | { status: "ok"; reviewId: string; source: "ai" | "fallback"; plannedSessionId: string | null }
  | { status: "skipped"; reason: string };

// ─── Loaders ────────────────────────────────────────────────────────────────

const BUNDLE_COLUMNS_FOR_REVIEW =
  "id,user_id,started_at,ended_at,total_duration_sec,total_distance_m,source," +
  "goal_time_sec,goal_strategy_summary," +
  "pre_race_ctl,pre_race_atl,pre_race_tsb,pre_race_tsb_state," +
  "taper_compliance_score,taper_compliance_summary," +
  "athlete_rating,athlete_notes,issues_flagged,finish_position,age_group_position," +
  "subjective_captured_at,inferred_transitions";

async function loadBundle(supabase: SupabaseClient, userId: string, bundleId: string): Promise<RaceBundleData | null> {
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

async function loadSegments(supabase: SupabaseClient, userId: string, bundleId: string): Promise<RaceSegmentData[]> {
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

async function loadPlannedSession(supabase: SupabaseClient, userId: string, plannedSessionId: string | null) {
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

async function loadRaceProfile(supabase: SupabaseClient, userId: string, bundleDateIso: string): Promise<RaceProfileForReview | null> {
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

async function resolvePlannedSessionId(supabase: SupabaseClient, userId: string, segmentIds: string[]): Promise<string | null> {
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

// ─── Deterministic facts builder ────────────────────────────────────────────

/**
 * Compute halves split for a leg from its laps array. Returns null if the laps
 * data isn't present or doesn't carry a usable metric (power for bike, pace
 * for run/swim).
 */
function computeLegHalvesFromLaps(segment: RaceSegmentData): LegPacing {
  // Prefer the explicit `halves` block if present (bike power case).
  const halvesBlock = segment.metricsV2 && typeof segment.metricsV2 === "object"
    ? (segment.metricsV2 as Record<string, unknown>).halves
    : null;
  if (segment.role === "bike" && halvesBlock && typeof halvesBlock === "object") {
    const h = halvesBlock as Record<string, unknown>;
    const first = typeof h.firstHalfAvgPower === "number" ? h.firstHalfAvgPower : null;
    const last = typeof h.lastHalfAvgPower === "number" ? h.lastHalfAvgPower : null;
    if (first !== null && last !== null && first > 0) {
      return {
        halvesAvailable: true,
        firstHalf: Math.round(first),
        lastHalf: Math.round(last),
        deltaPct: round2(((last - first) / first) * 100),
        unit: "watts"
      };
    }
  }

  // Otherwise compute from laps. Need ≥2 laps with the right metric.
  const laps = getMetricsV2Laps(segment.metricsV2);
  if (laps.length < 2) return { halvesAvailable: false };

  const totalDuration = laps.reduce((sum, lap) => sum + (lap.durationSec ?? 0), 0);
  if (totalDuration <= 0) return { halvesAvailable: false };

  const half = totalDuration / 2;
  let acc = 0;
  let splitIdx = 0;
  for (let i = 0; i < laps.length; i++) {
    acc += laps[i].durationSec ?? 0;
    if (acc >= half) {
      splitIdx = i + 1;
      break;
    }
  }
  splitIdx = Math.max(1, Math.min(splitIdx, laps.length - 1));
  const firstLaps = laps.slice(0, splitIdx);
  const lastLaps = laps.slice(splitIdx);
  if (firstLaps.length === 0 || lastLaps.length === 0) return { halvesAvailable: false };

  const weightedAvg = (
    pickMetric: (lap: typeof laps[number]) => number | null | undefined,
    chunk: typeof laps
  ): number | null => {
    let weighted = 0;
    let weight = 0;
    for (const lap of chunk) {
      const value = pickMetric(lap);
      const dur = lap.durationSec ?? 0;
      if (typeof value === "number" && Number.isFinite(value) && dur > 0) {
        weighted += value * dur;
        weight += dur;
      }
    }
    return weight > 0 ? weighted / weight : null;
  };

  if (segment.role === "bike") {
    const first = weightedAvg((lap) => lap.avgPower, firstLaps);
    const last = weightedAvg((lap) => lap.avgPower, lastLaps);
    if (first !== null && last !== null && first > 0) {
      return {
        halvesAvailable: true,
        firstHalf: Math.round(first),
        lastHalf: Math.round(last),
        deltaPct: round2(((last - first) / first) * 100),
        unit: "watts"
      };
    }
  }

  if (segment.role === "run") {
    const first = weightedAvg((lap) => lap.avgPaceSecPerKm ?? null, firstLaps);
    const last = weightedAvg((lap) => lap.avgPaceSecPerKm ?? null, lastLaps);
    if (first !== null && last !== null && first > 0) {
      return {
        halvesAvailable: true,
        firstHalf: Math.round(first),
        lastHalf: Math.round(last),
        deltaPct: round2(((last - first) / first) * 100),
        unit: "sec_per_km"
      };
    }
  }

  if (segment.role === "swim") {
    const first = weightedAvg((lap) => lap.avgPacePer100mSec ?? null, firstLaps);
    const last = weightedAvg((lap) => lap.avgPacePer100mSec ?? null, lastLaps);
    if (first !== null && last !== null && first > 0) {
      return {
        halvesAvailable: true,
        firstHalf: Math.round(first),
        lastHalf: Math.round(last),
        deltaPct: round2(((last - first) / first) * 100),
        unit: "sec_per_100m"
      };
    }
  }

  return { halvesAvailable: false };
}

/**
 * Compute halves HR drift (bpm) for a leg using the same midpoint split as
 * computeLegHalvesFromLaps. Positive = HR rose in the second half. Returns
 * null when laps data is unavailable.
 */
function computeLegHrDrift(segment: RaceSegmentData): number | null {
  const laps = getMetricsV2Laps(segment.metricsV2);
  if (laps.length < 2) return null;
  const totalDuration = laps.reduce((sum, lap) => sum + (lap.durationSec ?? 0), 0);
  if (totalDuration <= 0) return null;
  const half = totalDuration / 2;
  let acc = 0;
  let splitIdx = 0;
  for (let i = 0; i < laps.length; i++) {
    acc += laps[i].durationSec ?? 0;
    if (acc >= half) {
      splitIdx = i + 1;
      break;
    }
  }
  splitIdx = Math.max(1, Math.min(splitIdx, laps.length - 1));
  const firstLaps = laps.slice(0, splitIdx);
  const lastLaps = laps.slice(splitIdx);
  const avg = (chunk: typeof laps): number | null => {
    let weighted = 0;
    let weight = 0;
    for (const lap of chunk) {
      const dur = lap.durationSec ?? 0;
      if (typeof lap.avgHr === "number" && lap.avgHr > 0 && dur > 0) {
        weighted += lap.avgHr * dur;
        weight += dur;
      }
    }
    return weight > 0 ? weighted / weight : null;
  };
  const first = avg(firstLaps);
  const last = avg(lastLaps);
  if (first === null || last === null) return null;
  return Math.round(last - first);
}

/**
 * Best-effort target-output inference per leg. Today we only resolve a
 * target when the bundle's frozen goal_time_sec exists AND the race profile
 * carries an ideal discipline distribution. Returns null otherwise; the
 * leg-status classifier then degrades to fade-only signals.
 */
function inferTargetOutputs(args: {
  bundle: RaceBundleData;
  segments: RaceSegmentData[];
  raceProfile: RaceProfileForReview | null;
}): { swim: number | null; bike: number | null; run: number | null } {
  const { bundle, segments, raceProfile } = args;
  const ideal = raceProfile?.idealDisciplineDistribution;
  if (!bundle.goalTimeSec || !ideal) {
    return { swim: null, bike: null, run: null };
  }

  // Estimated leg duration at goal pace.
  const swimDur = bundle.goalTimeSec * ideal.swim;
  const bikeDur = bundle.goalTimeSec * ideal.bike;
  const runDur = bundle.goalTimeSec * ideal.run;

  const swimSeg = segments.find((s) => s.role === "swim");
  const runSeg = segments.find((s) => s.role === "run");

  // Pace targets need distance — use actual (a swim/run distance changes
  // little vs ideal so this is a fair anchor).
  const swimTarget =
    swimSeg && swimSeg.distanceM && swimSeg.distanceM > 0
      ? swimDur / (swimSeg.distanceM / 100) // sec/100m
      : null;
  const runTarget =
    runSeg && runSeg.distanceM && runSeg.distanceM > 0
      ? runDur / (runSeg.distanceM / 1000) // sec/km
      : null;

  // Bike target needs FTP, not just goal time. Skip for now — leg-status
  // classifier will fall back to fade-only signals on the bike when null.
  return {
    swim: swimTarget,
    bike: null,
    run: runTarget
  };
}

export function buildRaceFacts(args: {
  bundle: RaceBundleData;
  segments: RaceSegmentData[];
  plannedSession: RaceFacts["plannedSession"];
  raceProfile: RaceProfileForReview | null;
}): RaceFacts {
  const { bundle, segments, plannedSession, raceProfile } = args;

  const totalDurationSec = bundle.totalDurationSec > 0
    ? bundle.totalDurationSec
    : segments.reduce((sum, s) => sum + s.durationSec, 0);

  const disciplineDistributionActual: DisciplineDistribution = {};
  for (const segment of segments) {
    const share = totalDurationSec > 0 ? segment.durationSec / totalDurationSec : 0;
    disciplineDistributionActual[segment.role] = round4(share);
  }

  let disciplineDistributionDelta: RaceFacts["disciplineDistributionDelta"] = null;
  const ideal = raceProfile?.idealDisciplineDistribution;
  if (ideal) {
    const actualSwim = disciplineDistributionActual.swim ?? 0;
    const actualBike = (disciplineDistributionActual.bike ?? 0) + (disciplineDistributionActual.t1 ?? 0);
    const actualRun = (disciplineDistributionActual.run ?? 0) + (disciplineDistributionActual.t2 ?? 0);
    disciplineDistributionDelta = {
      swim: round4(actualSwim - ideal.swim),
      bike: round4(actualBike - ideal.bike),
      run: round4(actualRun - ideal.run)
    };
  }

  const pacing: RaceFacts["pacing"] = {};
  const hrDrift: RaceFacts["hrDrift"] = { swim: null, bike: null, run: null };
  for (const segment of segments) {
    if (segment.role === "swim" || segment.role === "bike" || segment.role === "run") {
      pacing[segment.role] = computeLegHalvesFromLaps(segment);
      hrDrift[segment.role] = computeLegHrDrift(segment);
    }
  }

  const t1Segment = segments.find((s) => s.role === "t1");
  const t2Segment = segments.find((s) => s.role === "t2");
  const transitions = {
    t1DurationSec: t1Segment ? t1Segment.durationSec : null,
    t2DurationSec: t2Segment ? t2Segment.durationSec : null
  };

  // Goal delta (positive = slower than goal).
  const goalDeltaSec = bundle.goalTimeSec ? totalDurationSec - bundle.goalTimeSec : null;

  // Per-leg status (deterministic).
  const targets = inferTargetOutputs({ bundle, segments, raceProfile });
  const legStatus: RaceFacts["legStatus"] = {
    swim: classifyLegStatus({ pacing: pacing.swim, targetOutput: targets.swim }),
    bike: classifyLegStatus({ pacing: pacing.bike, targetOutput: targets.bike }),
    run: classifyLegStatus({ pacing: pacing.run, targetOutput: targets.run, hrDriftBpm: hrDrift.run })
  };

  // Cross-discipline gate (deterministic; AI only narrates if detected).
  const accountSuppresses = athleteAccountSuppressesInsight({
    notes: bundle.athleteNotes,
    issuesFlagged: bundle.issuesFlagged
  });
  const crossDisciplineSignal = detectCrossDisciplineSignal({
    bikePacing: pacing.bike,
    runPacing: pacing.run,
    runHrDriftBpm: hrDrift.run,
    swimRating: bundle.athleteRating, // overall rating, used as proxy when leg-specific not captured
    bikeStatus: legStatus.bike?.label ?? null,
    athleteAccountSuppresses: accountSuppresses
  });

  // Emotional frame trigger: actual >5% over goal, rating ≤2, or notes/issues
  // imply illness/injury/major issue.
  const overGoal = goalDeltaSec !== null && bundle.goalTimeSec
    ? goalDeltaSec / bundle.goalTimeSec > 0.05
    : false;
  const ratingTriggers = bundle.athleteRating !== null && bundle.athleteRating <= 2;
  const emotionalFrameTriggered = Boolean(overGoal || ratingTriggers || accountSuppresses);

  return {
    bundle: { ...bundle, totalDurationSec },
    segments,
    plannedSession,
    raceProfile,
    disciplineDistributionActual,
    disciplineDistributionDelta,
    pacing,
    transitions,
    goalDeltaSec,
    hrDrift,
    legStatus,
    crossDisciplineSignal,
    emotionalFrameTriggered
  };
}

// ─── Deterministic fallback narrative (legacy shape) ────────────────────────

export function buildDeterministicRaceReview(facts: RaceFacts): RaceReviewNarrative {
  const totalLabel = formatDuration(facts.bundle.totalDurationSec);
  const sportsPresent = facts.segments
    .filter((s) => s.role === "swim" || s.role === "bike" || s.role === "run")
    .map((s) => s.role);
  const sportsLabel = sportsPresent.join("/") || "race";

  const headline = `Race completed in ${totalLabel} across ${sportsLabel}.`;

  const narrativeParts: string[] = [
    `${capitalize(sportsLabel)} race completed in ${totalLabel}.`
  ];
  if (facts.pacing.bike?.halvesAvailable) {
    const dir = facts.pacing.bike.deltaPct >= 0 ? "rose" : "eased";
    narrativeParts.push(
      `Bike power ${dir} ${Math.abs(facts.pacing.bike.deltaPct).toFixed(1)}% second half (${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W).`
    );
  }
  if (facts.pacing.run?.halvesAvailable) {
    const dir = facts.pacing.run.deltaPct > 0 ? "eased" : "held";
    narrativeParts.push(
      `Run pace ${dir} ${Math.abs(facts.pacing.run.deltaPct).toFixed(1)}% second half (${formatPaceSecPerKm(facts.pacing.run.firstHalf)} → ${formatPaceSecPerKm(facts.pacing.run.lastHalf)} /km).`
    );
  }
  if (facts.transitions.t1DurationSec !== null || facts.transitions.t2DurationSec !== null) {
    const parts: string[] = [];
    if (facts.transitions.t1DurationSec !== null) parts.push(`T1 ${formatDuration(facts.transitions.t1DurationSec)}`);
    if (facts.transitions.t2DurationSec !== null) parts.push(`T2 ${formatDuration(facts.transitions.t2DurationSec)}`);
    narrativeParts.push(`Transitions: ${parts.join(" / ")}.`);
  }
  const narrative = narrativeParts.join(" ");

  const coachTake = facts.pacing.bike?.halvesAvailable && Math.abs(facts.pacing.bike.deltaPct) <= 2
    ? "Bike pacing held steady — repeat that controlled effort on the next race-pace ride."
    : facts.pacing.run?.halvesAvailable && facts.pacing.run.deltaPct > 5
      ? "Second-half run eased — practice negative-split runs at race pace before the next event."
      : "Race executed. Review the segment-by-segment splits to identify the next focus area.";

  const transitionNotes = facts.transitions.t1DurationSec !== null || facts.transitions.t2DurationSec !== null
    ? `Transitions: ${[
        facts.transitions.t1DurationSec !== null ? `T1 ${formatDuration(facts.transitions.t1DurationSec)}` : null,
        facts.transitions.t2DurationSec !== null ? `T2 ${formatDuration(facts.transitions.t2DurationSec)}` : null
      ].filter(Boolean).join(", ")}.`
    : null;

  const pacingNotes = {
    swim: facts.pacing.swim?.halvesAvailable
      ? { note: `${formatPacePer100m(facts.pacing.swim.firstHalf)} → ${formatPacePer100m(facts.pacing.swim.lastHalf)} per 100m (${formatDeltaPct(facts.pacing.swim.deltaPct)}).` }
      : null,
    bike: facts.pacing.bike?.halvesAvailable
      ? { note: `${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W (${formatDeltaPct(facts.pacing.bike.deltaPct)}).` }
      : null,
    run: facts.pacing.run?.halvesAvailable
      ? { note: `${formatPaceSecPerKm(facts.pacing.run.firstHalf)} → ${formatPaceSecPerKm(facts.pacing.run.lastHalf)} /km (${formatDeltaPct(facts.pacing.run.deltaPct)}).` }
      : null
  };

  return {
    headline: clip(headline, 120),
    narrative: clip(narrative, 420),
    coachTake: clip(coachTake, 220),
    transitionNotes: transitionNotes ? clip(transitionNotes, 220) : null,
    pacingNotes
  };
}

// ─── Deterministic fallback (Phase 1B layered shape) ────────────────────────

export function buildDeterministicLayers(facts: RaceFacts): RaceReviewLayers {
  const totalLabel = formatDuration(facts.bundle.totalDurationSec);
  const goalDelta = facts.goalDeltaSec;
  const goalLabel = facts.bundle.goalTimeSec ? formatDuration(facts.bundle.goalTimeSec) : null;

  const headlineParts: string[] = [`Finished in ${totalLabel}`];
  if (goalLabel && goalDelta !== null) {
    if (goalDelta > 0) headlineParts.push(`+${formatDuration(Math.abs(goalDelta))} over ${goalLabel} goal`);
    else if (goalDelta < 0) headlineParts.push(`-${formatDuration(Math.abs(goalDelta))} under ${goalLabel} goal`);
    else headlineParts.push(`on goal of ${goalLabel}`);
  }
  if (facts.pacing.bike?.halvesAvailable) {
    headlineParts.push(`bike ${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W`);
  }
  const headline = clip(headlineParts.join("; ") + ".", 160);

  const perDiscipline: Verdict["perDiscipline"] = {
    swim: facts.legStatus.swim
      ? { status: facts.legStatus.swim.label, summary: facts.legStatus.swim.evidence.join(" ").slice(0, 220) }
      : null,
    bike: facts.legStatus.bike
      ? { status: facts.legStatus.bike.label, summary: facts.legStatus.bike.evidence.join(" ").slice(0, 220) }
      : null,
    run: facts.legStatus.run
      ? { status: facts.legStatus.run.label, summary: facts.legStatus.run.evidence.join(" ").slice(0, 220) }
      : null
  };

  // Coach take in deterministic NEXT format.
  const coachTake: Verdict["coachTake"] = {
    target: facts.pacing.bike?.halvesAvailable
      ? `Hold ${facts.pacing.bike.firstHalf}W ±2% across halves`
      : "Hold even-split race pacing across halves",
    scope: "next race-pace session",
    successCriterion: "Halves move less than 2% between first and last",
    progression: "If steady, extend duration by 10 minutes the following week"
  };

  const verdict: Verdict = {
    headline,
    perDiscipline,
    coachTake,
    emotionalFrame: facts.emotionalFrameTriggered
      ? "Conditions and context made this a tough day — the data reads through that lens."
      : null
  };

  // Race story projection.
  const overall = clip(
    [
      `${capitalize(sportsList(facts))} race completed in ${totalLabel}.`,
      facts.pacing.bike?.halvesAvailable
        ? `Bike power moved ${signed(facts.pacing.bike.deltaPct)}% across halves (${facts.pacing.bike.firstHalf}W → ${facts.pacing.bike.lastHalf}W).`
        : null,
      facts.pacing.run?.halvesAvailable
        ? `Run pace moved ${signed(facts.pacing.run.deltaPct)}% across halves.`
        : null
    ]
      .filter(Boolean)
      .join(" "),
    900
  );

  const buildLeg = (role: "swim" | "bike" | "run"): RaceStory["perLeg"]["swim"] => {
    const status = facts.legStatus[role];
    const pacing = facts.pacing[role];
    if (!status && (!pacing || !pacing.halvesAvailable)) return null;
    const evidence: string[] = [];
    if (status) evidence.push(...status.evidence);
    if (pacing?.halvesAvailable) {
      evidence.push(
        `Halves: ${formatHalvesUnitLabel(pacing.firstHalf, pacing.unit)} → ${formatHalvesUnitLabel(pacing.lastHalf, pacing.unit)}.`
      );
    }
    if (evidence.length === 0) return null;
    return {
      narrative: clip(evidence.join(" "), 420),
      keyEvidence: evidence.slice(0, 4).map((s) => clip(s, 180))
    };
  };

  const transitions =
    facts.transitions.t1DurationSec !== null || facts.transitions.t2DurationSec !== null
      ? clip(
          [
            facts.transitions.t1DurationSec !== null ? `T1 ${formatDuration(facts.transitions.t1DurationSec)}` : null,
            facts.transitions.t2DurationSec !== null ? `T2 ${formatDuration(facts.transitions.t2DurationSec)}` : null
          ]
            .filter(Boolean)
            .join(", "),
          280
        )
      : null;

  let crossDisciplineInsight: string | null = null;
  if (facts.crossDisciplineSignal.detected) {
    crossDisciplineInsight = clip(facts.crossDisciplineSignal.evidence.join(" "), 360);
  }

  const raceStory: RaceStory = {
    overall,
    perLeg: {
      swim: buildLeg("swim"),
      bike: buildLeg("bike"),
      run: buildLeg("run")
    },
    transitions,
    crossDisciplineInsight
  };

  return { verdict, raceStory };
}

// ─── Prompt builders ────────────────────────────────────────────────────────

export function buildRaceReviewInstructions(args?: { reinforcement?: string | null }): string {
  const reinforcement = args?.reinforcement?.trim();
  return [
    "You are TriCoach AI, debriefing an athlete on a multi-segment race (triathlon or duathlon).",
    "",
    "OUTPUT TWO STRUCTURED LAYERS in one response:",
    "",
    "Layer 1 — verdict",
    "  - headline (≤160 chars): one sentence anchored to the goal. MUST cite at least one specific number (finish time, goal delta, watts, pace, etc.).",
    "  - perDiscipline: { swim, bike, run } each either null OR { status, summary }.",
    "      status MUST be exactly one of: " + LEG_STATUS_LABELS.join(", ") + ".",
    "      Use the deterministic legStatus label provided in the input — do not pick your own.",
    "      summary (≤220 chars): one observation drawn from the leg's keyEvidence.",
    "  - coachTake: { target, scope, successCriterion, progression } — NEXT format.",
    "      target: a concrete pace/power/structure target with a number, e.g. 'NEXT 245W FTP for 30 min'.",
    "      scope: where the prescription applies, e.g. 'next bike test' or 'race-pace ride before the next event'.",
    "      successCriterion: one objective line — what 'good' looks like.",
    "      progression: one progression rule — what to change once successCriterion is hit.",
    "  - emotionalFrame: string or null. Set to a string ONLY when input.emotionalFrameTriggered is true. Otherwise null.",
    "",
    "Layer 2 — raceStory",
    "  - overall (3–5 sentences, ≤900 chars): the story of how the race was executed.",
    "  - perLeg: { swim, bike, run } each either null (when the leg has no data) OR { narrative, keyEvidence }.",
    "      narrative (≤420 chars): how that leg unfolded.",
    "      keyEvidence: 1–4 short factual bullets, each tied to a number from the input.",
    "  - transitions (≤280 chars or null): a single observation on T1/T2; null when neither is present.",
    "  - crossDisciplineInsight (≤360 chars or null):",
    "      THE MOAT. Set ONLY when input.crossDisciplineSignal.detected is true.",
    "      Narrate the hypothesis using the evidence array. Otherwise null. Do NOT invent connections.",
    "",
    "TONE RULES — HARD, never break these:",
    "- NEVER use the words 'should have', 'missed', 'failed', or 'must'.",
    "- Use 'ended up', 'came in at', 'fell short of plan', 'held', 'eased' instead.",
    "- Diagnose, do not judge. No moralizing.",
    "- TSB / FTP / CSS / NP are fine to use without gloss.",
    "- 'Decoupling', 'intensity factor', 'VLamax' need a plain-English gloss in the same sentence.",
    "- HONOR the athlete's account. If notes mention a discrete event (illness, GI, mechanical, injury), the upstream gate has already suppressed crossDisciplineInsight; mirror that — do not contradict the athlete by diagnosing fitness/pacing instead.",
    "",
    "FORMATTING RULES — also CRITICAL:",
    "- Use the *Label fields when present in the input ('durationLabel', 'paceLabel', 'firstHalfLabel'). They are pre-formatted.",
    "- NEVER write raw seconds or raw meters when a *Label exists.",
    "- Power: 'XXXW' (no decimals, no space).",
    "- Pace: 'M:SS /km' for run, 'M:SS /100m' for swim.",
    "- Percentages: one decimal, signed for deltas (+1.5%, −2.3%).",
    "",
    "Inputs (JSON). Each field is either a raw machine field, a pre-formatted *Label string, or a deterministic-decision packet:",
    "- bundle: totalDurationLabel, goalTimeLabel, goalDeltaLabel, source, preRaceState (CTL/ATL/TSB), taperCompliance",
    "- subjective: athleteRating, athleteNotes, issuesFlagged, finishPosition, ageGroupPosition",
    "- segments[]: role + durationLabel + distanceLabel + avgHr + avgPowerLabel?",
    "- pacing.{swim,bike,run}: halves data with *Label values OR { halvesAvailable: false }",
    "- legStatus.{swim,bike,run}: { label, evidence } OR null. label is one of the six status values.",
    "- crossDisciplineSignal: { detected: true, hypothesis, evidence } OR { detected: false }",
    "- emotionalFrameTriggered: boolean",
    "- transitions: { t1Label, t2Label }",
    reinforcement ? "" : null,
    reinforcement ? "REINFORCEMENT FROM PRIOR ATTEMPT:" : null,
    reinforcement ? reinforcement : null
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatDurationLabel(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSignedDurationLabel(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  const sign = sec < 0 ? "−" : sec > 0 ? "+" : "";
  return `${sign}${formatDurationLabel(Math.abs(sec))}`;
}

function formatDistanceLabel(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function formatHalvesUnitLabel(value: number, unit: "watts" | "sec_per_km" | "sec_per_100m"): string {
  if (unit === "watts") return `${Math.round(value)}W`;
  return formatPaceFromSeconds(value, unit);
}

function formatPaceFromSeconds(sec: number, unit: "sec_per_km" | "sec_per_100m"): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  const suffix = unit === "sec_per_km" ? " /km" : " /100m";
  return `${m}:${String(s).padStart(2, "0")}${suffix}`;
}

function formatDeltaPctLabel(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function buildRaceReviewInput(facts: RaceFacts): unknown {
  return {
    bundle: {
      totalDurationLabel: formatDurationLabel(facts.bundle.totalDurationSec),
      totalDistanceLabel: formatDistanceLabel(facts.bundle.totalDistanceM),
      source: facts.bundle.source,
      goalTimeLabel: formatDurationLabel(facts.bundle.goalTimeSec),
      goalDeltaLabel: formatSignedDurationLabel(facts.goalDeltaSec),
      goalStrategySummary: facts.bundle.goalStrategySummary,
      preRaceState: {
        ctl: facts.bundle.preRaceCtl,
        atl: facts.bundle.preRaceAtl,
        tsb: facts.bundle.preRaceTsb,
        tsbState: facts.bundle.preRaceTsbState
      },
      taperCompliance: {
        score: facts.bundle.taperComplianceScore,
        summary: facts.bundle.taperComplianceSummary
      }
    },
    subjective: {
      athleteRating: facts.bundle.athleteRating,
      athleteNotes: facts.bundle.athleteNotes,
      issuesFlagged: facts.bundle.issuesFlagged,
      finishPosition: facts.bundle.finishPosition,
      ageGroupPosition: facts.bundle.ageGroupPosition
    },
    segments: facts.segments.map((s) => ({
      role: s.role,
      durationLabel: formatDurationLabel(s.durationSec),
      distanceLabel: formatDistanceLabel(s.distanceM),
      avgHr: s.avgHr,
      avgPowerLabel: typeof s.avgPower === "number" ? `${Math.round(s.avgPower)}W` : null
    })),
    plannedSession: facts.plannedSession,
    raceProfile: facts.raceProfile
      ? {
          name: facts.raceProfile.name,
          distanceType: facts.raceProfile.distanceType,
          idealDisciplineDistribution: facts.raceProfile.idealDisciplineDistribution
        }
      : null,
    disciplineDistributionActual: facts.disciplineDistributionActual,
    disciplineDistributionDelta: facts.disciplineDistributionDelta,
    pacing: {
      swim: facts.pacing.swim?.halvesAvailable
        ? {
            firstHalfLabel: formatHalvesUnitLabel(facts.pacing.swim.firstHalf, facts.pacing.swim.unit),
            lastHalfLabel: formatHalvesUnitLabel(facts.pacing.swim.lastHalf, facts.pacing.swim.unit),
            deltaPctLabel: formatDeltaPctLabel(facts.pacing.swim.deltaPct),
            unit: facts.pacing.swim.unit
          }
        : { halvesAvailable: false },
      bike: facts.pacing.bike?.halvesAvailable
        ? {
            firstHalfLabel: formatHalvesUnitLabel(facts.pacing.bike.firstHalf, facts.pacing.bike.unit),
            lastHalfLabel: formatHalvesUnitLabel(facts.pacing.bike.lastHalf, facts.pacing.bike.unit),
            deltaPctLabel: formatDeltaPctLabel(facts.pacing.bike.deltaPct),
            unit: facts.pacing.bike.unit
          }
        : { halvesAvailable: false },
      run: facts.pacing.run?.halvesAvailable
        ? {
            firstHalfLabel: formatHalvesUnitLabel(facts.pacing.run.firstHalf, facts.pacing.run.unit),
            lastHalfLabel: formatHalvesUnitLabel(facts.pacing.run.lastHalf, facts.pacing.run.unit),
            deltaPctLabel: formatDeltaPctLabel(facts.pacing.run.deltaPct),
            unit: facts.pacing.run.unit
          }
        : { halvesAvailable: false }
    },
    hrDrift: facts.hrDrift,
    legStatus: {
      swim: facts.legStatus.swim
        ? { label: facts.legStatus.swim.label, evidence: facts.legStatus.swim.evidence }
        : null,
      bike: facts.legStatus.bike
        ? { label: facts.legStatus.bike.label, evidence: facts.legStatus.bike.evidence }
        : null,
      run: facts.legStatus.run
        ? { label: facts.legStatus.run.label, evidence: facts.legStatus.run.evidence }
        : null
    },
    crossDisciplineSignal: facts.crossDisciplineSignal,
    emotionalFrameTriggered: facts.emotionalFrameTriggered,
    transitions: {
      t1Label: formatDurationLabel(facts.transitions.t1DurationSec),
      t2Label: formatDurationLabel(facts.transitions.t2DurationSec)
    }
  };
}

// ─── Layer projection helpers ───────────────────────────────────────────────

/**
 * Project the new layered output back into the legacy single-narrative shape
 * so existing legacy columns stay populated until they're removed.
 */
function projectLegacyNarrative(layers: RaceReviewLayers, facts: RaceFacts): RaceReviewNarrative {
  const fallback = buildDeterministicRaceReview(facts);
  return {
    headline: clip(layers.verdict.headline, 120),
    narrative: clip(layers.raceStory.overall, 420),
    coachTake: clip(
      [layers.verdict.coachTake.target, layers.verdict.coachTake.successCriterion]
        .filter(Boolean)
        .join(" — "),
      220
    ),
    transitionNotes: layers.raceStory.transitions ? clip(layers.raceStory.transitions, 220) : null,
    pacingNotes: {
      swim: layers.raceStory.perLeg.swim
        ? { note: clip(layers.raceStory.perLeg.swim.narrative, 220) }
        : fallback.pacingNotes.swim,
      bike: layers.raceStory.perLeg.bike
        ? { note: clip(layers.raceStory.perLeg.bike.narrative, 220) }
        : fallback.pacingNotes.bike,
      run: layers.raceStory.perLeg.run
        ? { note: clip(layers.raceStory.perLeg.run.narrative, 220) }
        : fallback.pacingNotes.run
    }
  };
}

/**
 * Force the gates the AI does not get to decide:
 *  - emotionalFrame must be null when trigger is false
 *  - crossDisciplineInsight must be null when signal not detected
 *  - perDiscipline status must match the deterministic label when one was
 *    provided (we trust the label, not the model)
 */
function enforceDeterministicGates(layers: RaceReviewLayers, facts: RaceFacts): RaceReviewLayers {
  const verdictPerDiscipline: Verdict["perDiscipline"] = { swim: null, bike: null, run: null };
  for (const leg of ["swim", "bike", "run"] as const) {
    const det = facts.legStatus[leg];
    const aiLeg = layers.verdict.perDiscipline[leg];
    if (!det) {
      verdictPerDiscipline[leg] = null;
    } else if (!aiLeg) {
      verdictPerDiscipline[leg] = {
        status: det.label,
        summary: det.evidence.join(" ").slice(0, 220)
      };
    } else {
      verdictPerDiscipline[leg] = {
        status: det.label,
        summary: aiLeg.summary
      };
    }
  }

  return {
    verdict: {
      ...layers.verdict,
      perDiscipline: verdictPerDiscipline,
      emotionalFrame: facts.emotionalFrameTriggered ? layers.verdict.emotionalFrame : null
    },
    raceStory: {
      ...layers.raceStory,
      crossDisciplineInsight: facts.crossDisciplineSignal.detected ? layers.raceStory.crossDisciplineInsight : null
    }
  };
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function generateRaceReview(args: GenerateRaceReviewArgs): Promise<GenerateRaceReviewResult> {
  const { supabase, userId, bundleId } = args;

  const bundle = await loadBundle(supabase, userId, bundleId);
  if (!bundle) return { status: "skipped", reason: "bundle_not_found" };

  const segments = await loadSegments(supabase, userId, bundleId);
  if (segments.length < 3) return { status: "skipped", reason: "insufficient_segments" };

  // Phase 1B gate: subjective inputs must be captured before we generate.
  if (!bundle.subjectiveCapturedAt) {
    return { status: "skipped", reason: "subjective_required" };
  }

  const segmentIds = segments.map((s) => s.activityId);
  const plannedSessionId = await resolvePlannedSessionId(supabase, userId, segmentIds);
  const plannedSession = await loadPlannedSession(supabase, userId, plannedSessionId);
  const raceProfile = await loadRaceProfile(supabase, userId, bundle.startedAt);

  const facts = buildRaceFacts({ bundle, segments, plannedSession, raceProfile });
  const fallbackLegacy = buildDeterministicRaceReview(facts);
  const fallbackLayers = buildDeterministicLayers(facts);

  // Persist pacing-arc series alongside the narrative.
  const pacingArc: PacingArcData = buildPacingArcData({
    segments,
    inferredTransitions: bundle.inferredTransitions,
    thresholdHrBpm: null
  });

  // First attempt.
  const firstAttempt = await callOpenAIWithFallback<RaceReviewLayers>({
    logTag: "race-review",
    fallback: fallbackLayers,
    buildRequest: () => ({
      instructions: buildRaceReviewInstructions(),
      reasoning: { effort: "low" },
      max_output_tokens: 4000,
      text: {
        format: zodTextFormat(raceReviewLayersSchema, "race_review_layers", {
          description: "Structured race review: Layer 1 verdict + Layer 2 race story."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify(buildRaceReviewInput(facts))
            }
          ]
        }
      ]
    }),
    schema: raceReviewLayersSchema,
    logContext: { bundleId, plannedSessionId }
  });

  let layers: RaceReviewLayers = firstAttempt.value;
  let source: "ai" | "fallback" = firstAttempt.source;
  let toneViolations: ToneViolation[] = [];

  if (source === "ai") {
    const violations = scanForToneViolations(layers);
    if (violations.length > 0) {
      console.warn("[race-review] tone violations detected, retrying", { bundleId, violations });
      const retry = await callOpenAIWithFallback<RaceReviewLayers>({
        logTag: "race-review-tone-retry",
        fallback: fallbackLayers,
        buildRequest: () => ({
          instructions: buildRaceReviewInstructions({ reinforcement: buildReinforcementSystemMessage(violations) }),
          reasoning: { effort: "low" },
          max_output_tokens: 4000,
          text: {
            format: zodTextFormat(raceReviewLayersSchema, "race_review_layers", {
              description: "Structured race review: Layer 1 verdict + Layer 2 race story."
            })
          },
          input: [
            {
              role: "user" as const,
              content: [
                { type: "input_text" as const, text: JSON.stringify(buildRaceReviewInput(facts)) }
              ]
            }
          ]
        }),
        schema: raceReviewLayersSchema,
        logContext: { bundleId, plannedSessionId, retry: true }
      });
      const retryViolations = retry.source === "ai" ? scanForToneViolations(retry.value) : [];
      if (retry.source === "ai" && retryViolations.length === 0) {
        layers = retry.value;
        source = "ai";
        toneViolations = violations; // first-attempt violations recorded for telemetry
      } else {
        // Both attempts violated tone — fall back deterministically.
        layers = fallbackLayers;
        source = "fallback";
        toneViolations = [...violations, ...retryViolations];
      }
    }
  }

  // Apply deterministic gates: AI doesn't get to decide leg status, emotional
  // frame, or cross-discipline insight presence.
  layers = enforceDeterministicGates(layers, facts);

  const isProvisional = source === "fallback";
  const modelUsed = source === "ai"
    ? getCoachModel()
    : toneViolations.length > 0
      ? "fallback-tone-violation"
      : "fallback";

  // Derived legacy columns from the new layered shape (or AI-source legacy
  // narrative for callers still reading the old fields).
  const legacy = source === "ai" ? projectLegacyNarrative(layers, facts) : fallbackLegacy;

  // Pacing notes payload mirrors the existing legacy shape for consumers.
  const pacingNotesPersisted: Record<string, unknown> = {};
  for (const leg of ["swim", "bike", "run"] as const) {
    const halves = facts.pacing[leg];
    const note = legacy.pacingNotes[leg]?.note ?? null;
    if (halves?.halvesAvailable) {
      pacingNotesPersisted[leg] = {
        firstHalf: halves.firstHalf,
        lastHalf: halves.lastHalf,
        deltaPct: halves.deltaPct,
        unit: halves.unit,
        note
      };
    } else if (note) {
      pacingNotesPersisted[leg] = { note };
    }
  }

  // Per-leg deterministic status snapshot persisted separately for the UI.
  const legStatusPersisted: Record<string, { label: LegStatusLabel; evidence: string[] } | null> = {
    swim: facts.legStatus.swim ? { label: facts.legStatus.swim.label, evidence: facts.legStatus.swim.evidence } : null,
    bike: facts.legStatus.bike ? { label: facts.legStatus.bike.label, evidence: facts.legStatus.bike.evidence } : null,
    run: facts.legStatus.run ? { label: facts.legStatus.run.label, evidence: facts.legStatus.run.evidence } : null
  };

  const { data: upsertData, error: upsertError } = await supabase
    .from("race_reviews")
    .upsert(
      {
        user_id: userId,
        race_bundle_id: bundleId,
        planned_session_id: plannedSessionId,
        // Legacy columns (still required NOT NULL on the table).
        headline: legacy.headline,
        narrative: legacy.narrative,
        coach_take: legacy.coachTake,
        transition_notes: legacy.transitionNotes,
        pacing_notes: pacingNotesPersisted,
        discipline_distribution_actual: facts.disciplineDistributionActual,
        discipline_distribution_delta: facts.disciplineDistributionDelta,
        // Phase 1B columns.
        verdict: layers.verdict,
        race_story: layers.raceStory,
        leg_status: legStatusPersisted,
        emotional_frame: layers.verdict.emotionalFrame,
        cross_discipline_insight: layers.raceStory.crossDisciplineInsight,
        pacing_arc_data: pacingArc,
        tone_violations: toneViolations,
        model_used: modelUsed,
        is_provisional: isProvisional,
        generated_at: new Date().toISOString()
      },
      { onConflict: "race_bundle_id" }
    )
    .select("id")
    .single();

  if (upsertError || !upsertData) {
    console.error("[race-review] upsert failed", { bundleId, error: upsertError?.message });
    return { status: "skipped", reason: `upsert_failed:${upsertError?.message ?? "unknown"}` };
  }

  return {
    status: "ok",
    reviewId: upsertData.id as string,
    source,
    plannedSessionId
  };
}

export function triggerRaceReviewBackground(args: GenerateRaceReviewArgs): void {
  void generateRaceReview(args).catch((err) => {
    console.error("[race-review] background generation failed", {
      bundleId: args.bundleId,
      error: err instanceof Error ? err.message : String(err)
    });
  });
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function sportsList(facts: RaceFacts): string {
  return facts.segments
    .filter((s) => s.role === "swim" || s.role === "bike" || s.role === "run")
    .map((s) => s.role)
    .join("/");
}

function signed(n: number): string {
  if (n === 0) return "0.0";
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPaceSecPerKm(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPacePer100m(secPer100: number): string {
  const m = Math.floor(secPer100 / 60);
  const s = Math.round(secPer100 % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDeltaPct(deltaPct: number): string {
  const sign = deltaPct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(deltaPct).toFixed(1)}% second half`;
}
