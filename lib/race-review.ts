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
  type RaceStory
} from "@/lib/race-review/schemas";
import {
  buildRaceReviewInstructions,
  buildSegmentDiagnosticInstructions
} from "@/lib/race-review/prompts";
import {
  buildDeterministicLayers,
  buildDeterministicRaceReview
} from "@/lib/race-review/deterministic";
import {
  loadBundle,
  loadFtpAtRace,
  loadPlannedSession,
  loadPriorRaceComparison,
  loadRaceProfile,
  loadRecentSessionPool,
  loadSegments,
  resolvePlannedSessionId
} from "@/lib/race-review/loaders";
import {
  capitalize,
  clip,
  formatDeltaPct,
  formatDeltaPctLabel,
  formatDistanceLabel,
  formatDuration,
  formatDurationLabel,
  formatHalvesUnitLabel,
  formatPacePer100m,
  formatPaceSecPerKm,
  formatSignedDurationLabel,
  round2,
  round4,
  signed,
  sportsList
} from "@/lib/race-review/format-helpers";

// Re-export the prompt builders + deterministic builders so existing
// consumers keep working.
export {
  buildDeterministicLayers,
  buildDeterministicRaceReview,
  buildRaceReviewInstructions,
  buildSegmentDiagnosticInstructions
};
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
import {
  buildSegmentDiagnostics,
  type PriorRaceComparison
} from "@/lib/race-review/segment-diagnostics";
import {
  segmentNarrativesSchema,
  type SegmentDiagnostics,
  type SegmentNarratives,
  type TransitionsAnalysis
} from "@/lib/race-review/segment-diagnostics-schemas";
import type { ComparableCandidate } from "@/lib/race-review/best-comparable";
import { generateRaceLessons } from "@/lib/race-review/lessons";
import {
  persistPreRaceRetrospective,
  persistTrainingToRaceLinks
} from "@/lib/race-review/persist-tail";

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

  // Per-leg status (deterministic). Leg-average outputs feed the whole-leg
  // fallback in classifyLegStatus when halves data isn't available (e.g.
  // a Strava swim that imports as a single lap).
  const targets = inferTargetOutputs({ bundle, segments, raceProfile });
  const swimSeg = segments.find((s) => s.role === "swim");
  const bikeSeg = segments.find((s) => s.role === "bike");
  const runSeg = segments.find((s) => s.role === "run");
  const swimAvg = swimSeg && swimSeg.distanceM && swimSeg.distanceM > 0 && swimSeg.durationSec > 0
    ? swimSeg.durationSec / (swimSeg.distanceM / 100)
    : null;
  const runAvg = runSeg && runSeg.distanceM && runSeg.distanceM > 0 && runSeg.durationSec > 0
    ? runSeg.durationSec / (runSeg.distanceM / 1000)
    : null;
  const bikeAvgWatts = bikeSeg && typeof bikeSeg.avgPower === "number" && bikeSeg.avgPower > 0
    ? bikeSeg.avgPower
    : null;
  const legStatus: RaceFacts["legStatus"] = {
    swim: classifyLegStatus({
      pacing: pacing.swim,
      targetOutput: targets.swim,
      legAverageOutput: swimAvg,
      legAverageUnit: "sec_per_100m"
    }),
    bike: classifyLegStatus({
      pacing: pacing.bike,
      targetOutput: targets.bike,
      legAverageOutput: bikeAvgWatts,
      legAverageUnit: "watts"
    }),
    run: classifyLegStatus({
      pacing: pacing.run,
      targetOutput: targets.run,
      hrDriftBpm: hrDrift.run,
      legAverageOutput: runAvg,
      legAverageUnit: "sec_per_km"
    })
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

  // Phase 1C inputs: FTP at race date, prior-race comparison, recent session pool.
  const [ftpAtRace, priorRace, comparableCandidates] = await Promise.all([
    loadFtpAtRace(supabase, userId, bundle.startedAt).catch(() => null),
    loadPriorRaceComparison(supabase, userId, bundleId, bundle.startedAt, raceProfile?.distanceType ?? null).catch(() => null),
    loadRecentSessionPool(supabase, userId, bundle.startedAt).catch(() => [])
  ]);

  const { diagnostics: deterministicDiagnostics, transitionsAnalysis } = buildSegmentDiagnostics({
    facts,
    ftpAtRace,
    priorRace,
    comparableCandidates
  });

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

  // Phase 1C: AI narrative synthesis for the per-segment diagnostic. One
  // round-trip; the model only writes wording, never picks reference frames.
  const narrativeFallback: SegmentNarratives = { swim: null, bike: null, run: null };
  const segmentNarrativesAttempt = deterministicDiagnostics.length > 0
    ? await callOpenAIWithFallback<SegmentNarratives>({
        logTag: "race-review-segment-diagnostics",
        fallback: narrativeFallback,
        buildRequest: () => ({
          instructions: buildSegmentDiagnosticInstructions(),
          reasoning: { effort: "low" },
          max_output_tokens: 2000,
          text: {
            format: zodTextFormat(segmentNarrativesSchema, "segment_narratives", {
              description: "One-paragraph narrative synthesis per discipline."
            })
          },
          input: [
            {
              role: "user" as const,
              content: [
                {
                  type: "input_text" as const,
                  text: JSON.stringify({
                    bundle: {
                      totalDurationSec: facts.bundle.totalDurationSec,
                      goalTimeSec: facts.bundle.goalTimeSec,
                      goalDeltaSec: facts.goalDeltaSec
                    },
                    diagnostics: deterministicDiagnostics
                  })
                }
              ]
            }
          ]
        }),
        schema: segmentNarrativesSchema,
        logContext: { bundleId, plannedSessionId }
      })
    : { value: narrativeFallback, source: "fallback" as const };

  const narratives = segmentNarrativesAttempt.value;
  const segmentDiagnosticsPersisted: SegmentDiagnostics = deterministicDiagnostics.map((diag) => ({
    ...diag,
    aiNarrative: narratives[diag.discipline] ?? null
  }));

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
        // Phase 1C columns.
        segment_diagnostics: segmentDiagnosticsPersisted.length > 0 ? segmentDiagnosticsPersisted : null,
        transitions_analysis: transitionsAnalysis,
        // Phase 3 columns: clear here so regeneration cannot leave stale
        // training_to_race_links / pre_race_retrospective from a prior run
        // attached to a freshly regenerated review. The tail-call writers
        // below repopulate these on success; a failure leaves them null,
        // which is the correct "no current artifact" state.
        training_to_race_links: null,
        pre_race_retrospective: null,
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

  // Phase 1D — fire Lessons generation. Tail-call so the review row is
  // visible to the loader before lessons read it; failures don't roll back
  // the review.
  // Phase 3 — fire Training-to-Race Linking (3.2) and Pre-race Retrospective (3.3)
  // alongside lessons. All three are tail calls; failures persist null in
  // their columns rather than rolling back the review.
  await Promise.all([
    generateRaceLessons({ supabase, userId, bundleId }).catch((err) => {
      console.warn("[race-review] lessons generation failed (review still saved)", {
        bundleId,
        error: err instanceof Error ? err.message : String(err)
      });
    }),
    persistTrainingToRaceLinks({ supabase, userId, bundleId, segments, raceDateIso: bundle.startedAt }).catch((err) => {
      console.warn("[race-review] training-links generation failed (review still saved)", {
        bundleId,
        error: err instanceof Error ? err.message : String(err)
      });
    }),
    persistPreRaceRetrospective({ supabase, userId, bundleId, bundle, raceDateIso: bundle.startedAt }).catch((err) => {
      console.warn("[race-review] retrospective generation failed (review still saved)", {
        bundleId,
        error: err instanceof Error ? err.message : String(err)
      });
    })
  ]);

  return {
    status: "ok",
    reviewId: upsertData.id as string,
    source,
    plannedSessionId
  };
}

/**
 * Phase 3.2 tail call. Builds the training-to-race-links artifact and
 * writes it to the existing race_reviews row.
 */

export function triggerRaceReviewBackground(args: GenerateRaceReviewArgs): void {
  void generateRaceReview(args).catch((err) => {
    console.error("[race-review] background generation failed", {
      bundleId: args.bundleId,
      error: err instanceof Error ? err.message : String(err)
    });
  });
}

