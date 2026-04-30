/**
 * Phase 1C — per-segment diagnostic builder.
 *
 * Given the Phase 1B RaceFacts plus the additional inputs (FTP, prior race,
 * recent session pool), produce one deterministic diagnostic packet per
 * discipline that has data. The packet carries the four reference frames,
 * pacing analysis, and detected anomalies — every observation grounded in
 * a number from this athlete's own data.
 *
 * The AI is invoked separately to synthesize a one-paragraph narrative per
 * discipline. The synthesis is layered onto the deterministic packet by
 * the orchestrator (lib/race-review.ts) before persistence.
 *
 * NOTE on missing thresholds: CSS / run-threshold storage is not yet
 * implemented (separate workstream per spec). vsThreshold returns null for
 * swim and run when only FTP is known. Tracked with the issue #309 spec
 * note "CSS / run-threshold storage may require a separate workstream".
 */

import { getMetricsV2Laps, type ActivityLapMetrics } from "@/lib/workouts/metrics-v2";
import { detectLegAnomalies } from "./anomaly-detection";
import { findBestComparableTraining, type ComparableCandidate } from "./best-comparable";
import {
  classifySplitType,
  computeDecouplingObservation,
  computeDriftObservation
} from "./pacing-analysis";
import { getTransitionNorm } from "./transition-norms";
import type {
  SegmentDiagnostic,
  SegmentDiagnostics,
  TransitionsAnalysis
} from "./segment-diagnostics-schemas";
import type {
  LegPacing,
  RaceFacts,
  RaceSegmentData,
  RaceSegmentRole
} from "@/lib/race-review";

const VS_PLAN_TOLERANCE_PCT = 2;

export type PriorRaceComparison = {
  bundleId: string;
  raceName: string;
  raceDate: string;
  legDurations: { swim: number | null; bike: number | null; run: number | null };
};

export type BuildSegmentDiagnosticsArgs = {
  facts: RaceFacts;
  ftpAtRace: number | null;
  priorRace: PriorRaceComparison | null;
  comparableCandidates: ComparableCandidate[];
};

export type BuildSegmentDiagnosticsResult = {
  diagnostics: SegmentDiagnostics;
  transitionsAnalysis: TransitionsAnalysis;
};

export function buildSegmentDiagnostics(args: BuildSegmentDiagnosticsArgs): BuildSegmentDiagnosticsResult {
  const { facts, ftpAtRace, priorRace, comparableCandidates } = args;

  const diagnostics: SegmentDiagnostic[] = [];
  for (const discipline of ["swim", "bike", "run"] as const) {
    const segment = facts.segments.find((s) => s.role === discipline);
    if (!segment) continue;
    const diag = buildOneDiscipline({
      discipline,
      segment,
      facts,
      ftpAtRace,
      priorRace,
      comparableCandidates
    });
    if (diag) diagnostics.push(diag);
  }

  const transitionsAnalysis = buildTransitionsAnalysis(facts);

  return { diagnostics, transitionsAnalysis };
}

function buildOneDiscipline(args: {
  discipline: "swim" | "bike" | "run";
  segment: RaceSegmentData;
  facts: RaceFacts;
  ftpAtRace: number | null;
  priorRace: PriorRaceComparison | null;
  comparableCandidates: ComparableCandidate[];
}): SegmentDiagnostic | null {
  const { discipline, segment, facts, ftpAtRace, priorRace, comparableCandidates } = args;
  const pacing = facts.pacing[discipline];
  const hrHalves = computeLegHrHalves(segment);

  const vsPlan = buildVsPlan(discipline, pacing, facts);
  const vsThreshold = buildVsThreshold(discipline, segment, pacing, facts, ftpAtRace);
  const vsBestComparableTraining = buildVsBestComparable({
    discipline,
    segment,
    candidates: comparableCandidates
  });
  const vsPriorRace = buildVsPriorRace({
    discipline,
    segment,
    priorRace
  });

  const splitType = pacing && pacing.halvesAvailable ? classifySplitType(pacing) : null;
  const driftObservation = pacing && pacing.halvesAvailable ? computeDriftObservation(pacing) : null;
  const decouplingObservation =
    pacing && pacing.halvesAvailable
      ? computeDecouplingObservation({
          pacing,
          hrFirstHalfBpm: hrHalves.first,
          hrLastHalfBpm: hrHalves.last
        })
      : null;

  const anomalies = detectLegAnomalies(segment);

  // If absolutely nothing fired, skip this discipline entirely so the UI
  // doesn't render an empty card.
  const hasContent =
    vsPlan ||
    vsThreshold ||
    vsBestComparableTraining ||
    vsPriorRace ||
    splitType ||
    driftObservation ||
    decouplingObservation ||
    anomalies.length > 0;
  if (!hasContent) return null;

  return {
    discipline,
    referenceFrames: {
      vsPlan,
      vsThreshold,
      vsBestComparableTraining,
      vsPriorRace
    },
    pacingAnalysis: {
      splitType,
      driftObservation,
      decouplingObservation
    },
    anomalies,
    aiNarrative: null
  };
}

function buildVsPlan(
  discipline: "swim" | "bike" | "run",
  pacing: LegPacing | undefined,
  facts: RaceFacts
): SegmentDiagnostic["referenceFrames"]["vsPlan"] {
  const ideal = facts.raceProfile?.idealDisciplineDistribution;
  const goalSec = facts.bundle.goalTimeSec;
  if (!ideal || !goalSec) return null;
  if (!pacing || !pacing.halvesAvailable) return null;

  // Distribution share for this discipline (T1/T2 already absorbed elsewhere).
  const share = (ideal as Record<string, number | undefined>)[discipline];
  if (typeof share !== "number" || share <= 0) return null;

  const segment = facts.segments.find((s) => s.role === discipline);
  if (!segment || segment.distanceM === null || segment.distanceM <= 0) return null;

  // Compute prescribed per-leg target output for the goal time.
  const targetLegSec = goalSec * share;
  let target: number;
  if (discipline === "bike") {
    // Without an FTP-derived target wattage we can't compare bike output to
    // plan; fall back to comparing plan time to actual time as a proxy.
    const actualLegSec = segment.durationSec;
    const deltaPct = ((actualLegSec - targetLegSec) / targetLegSec) * 100;
    return labelVsPlan(deltaPct, summarizeBikeVsPlan(actualLegSec, targetLegSec, deltaPct));
  }
  if (discipline === "swim") {
    target = targetLegSec / (segment.distanceM / 100); // sec/100m
    const avg = (pacing.firstHalf + pacing.lastHalf) / 2;
    const deltaPct = ((avg - target) / target) * 100;
    return labelVsPlan(deltaPct, `Avg ${formatPace(avg, "sec_per_100m")} vs plan ${formatPace(target, "sec_per_100m")} (${signedPct(deltaPct)}).`);
  }
  // run
  target = targetLegSec / (segment.distanceM / 1000); // sec/km
  const avg = (pacing.firstHalf + pacing.lastHalf) / 2;
  const deltaPct = ((avg - target) / target) * 100;
  return labelVsPlan(deltaPct, `Avg ${formatPace(avg, "sec_per_km")} vs plan ${formatPace(target, "sec_per_km")} (${signedPct(deltaPct)}).`);
}

function summarizeBikeVsPlan(actualSec: number, targetSec: number, deltaPct: number): string {
  return `Bike split ${formatDuration(actualSec)} vs plan ${formatDuration(targetSec)} (${signedPct(deltaPct)}).`;
}

function labelVsPlan(deltaPct: number, summary: string): SegmentDiagnostic["referenceFrames"]["vsPlan"] {
  let label: "on_plan" | "under" | "over";
  if (Math.abs(deltaPct) <= VS_PLAN_TOLERANCE_PCT) label = "on_plan";
  else if (deltaPct > 0) label = "under"; // slower than plan / longer than goal
  else label = "over";
  return { label, deltaPct: round1(deltaPct), summary };
}

function buildVsThreshold(
  discipline: "swim" | "bike" | "run",
  segment: RaceSegmentData,
  pacing: LegPacing | undefined,
  _facts: RaceFacts,
  ftpAtRace: number | null
): SegmentDiagnostic["referenceFrames"]["vsThreshold"] {
  if (discipline !== "bike") {
    // CSS / run-threshold storage is a separate workstream; null for now.
    return null;
  }
  if (!ftpAtRace || ftpAtRace <= 0) return null;
  const avgPower = segment.avgPower ?? (pacing && pacing.halvesAvailable && pacing.unit === "watts"
    ? Math.round((pacing.firstHalf + pacing.lastHalf) / 2)
    : null);
  if (avgPower === null) return null;
  const intensityFactor = avgPower / ftpAtRace;
  const summary = describeBikeIF(avgPower, ftpAtRace, intensityFactor, segment.durationSec);
  return {
    thresholdValue: ftpAtRace,
    thresholdUnit: "watts",
    intensityFactor: round2(intensityFactor),
    summary
  };
}

function describeBikeIF(avgPower: number, ftp: number, ifValue: number, durationSec: number): string {
  // Distance-aware narration: 70.3 race-pace IF is typically 0.78–0.85,
  // Olympic 0.85–0.92, sprint 0.93+, Ironman 0.65–0.75.
  let appropriateness = "in the appropriate range for this distance";
  if (durationSec < 60 * 60) {
    if (ifValue < 0.85) appropriateness = "below typical race-effort range for this distance";
    else if (ifValue > 1.0) appropriateness = "above sustainable threshold for this distance";
  } else if (durationSec < 3 * 60 * 60) {
    if (ifValue < 0.78) appropriateness = "conservative for this distance";
    else if (ifValue > 0.92) appropriateness = "above typical race-effort range for this distance";
  } else {
    if (ifValue < 0.65) appropriateness = "well below typical race-effort range for this distance";
    else if (ifValue > 0.78) appropriateness = "above sustainable Ironman pacing range";
  }
  return `${avgPower}W avg vs FTP ${ftp}W = IF ${ifValue.toFixed(2)} — ${appropriateness}.`;
}

function buildVsBestComparable(args: {
  discipline: "swim" | "bike" | "run";
  segment: RaceSegmentData;
  candidates: ComparableCandidate[];
}): SegmentDiagnostic["referenceFrames"]["vsBestComparableTraining"] {
  const { discipline, segment, candidates } = args;
  const match = findBestComparableTraining({
    discipline,
    raceLegDurationSec: segment.durationSec,
    candidates
  });
  if (!match) return null;
  const comparison = `Closest training analogue: ${match.sessionName} (${match.date}, ${formatDuration(match.durationSec)}). Race leg ${formatDuration(segment.durationSec)}.`;
  return {
    sessionId: match.sessionId,
    sessionDate: match.date,
    sessionName: match.sessionName,
    comparison
  };
}

function buildVsPriorRace(args: {
  discipline: "swim" | "bike" | "run";
  segment: RaceSegmentData;
  priorRace: PriorRaceComparison | null;
}): SegmentDiagnostic["referenceFrames"]["vsPriorRace"] {
  const { discipline, segment, priorRace } = args;
  if (!priorRace) return null;
  const priorSec = priorRace.legDurations[discipline];
  if (priorSec === null || priorSec <= 0) return null;
  const deltaSec = segment.durationSec - priorSec;
  const deltaPct = (deltaSec / priorSec) * 100;
  const direction = deltaSec === 0 ? "matched" : deltaSec < 0 ? "faster than" : "slower than";
  const comparison = `${formatDuration(segment.durationSec)} ${direction} ${priorRace.raceName} (${formatDuration(priorSec)}, ${signedPct(deltaPct)}).`;
  return {
    bundleId: priorRace.bundleId,
    raceName: priorRace.raceName,
    raceDate: priorRace.raceDate,
    comparison
  };
}

function buildTransitionsAnalysis(facts: RaceFacts): TransitionsAnalysis {
  const { transitions } = facts;
  if (transitions.t1DurationSec === null && transitions.t2DurationSec === null) return null;
  if (facts.bundle.inferredTransitions) {
    // Stitched from gaps — timing too uncertain to compare against medians.
    return null;
  }

  const norm = getTransitionNorm(facts.raceProfile);
  const t1Segment = facts.segments.find((s) => s.role === "t1");
  const t2Segment = facts.segments.find((s) => s.role === "t2");

  const t1 =
    transitions.t1DurationSec !== null
      ? buildOneTransition({
          athleteSec: transitions.t1DurationSec,
          medianSec: norm?.t1Sec ?? null,
          hrAtEnd: lastLapAvgHr(t1Segment) ?? null,
          which: "T1"
        })
      : null;
  const t2 =
    transitions.t2DurationSec !== null
      ? buildOneTransition({
          athleteSec: transitions.t2DurationSec,
          medianSec: norm?.t2Sec ?? null,
          hrAtEnd: lastLapAvgHr(t2Segment) ?? null,
          which: "T2"
        })
      : null;

  if (!t1 && !t2) return null;
  return { t1, t2 };
}

function buildOneTransition(args: {
  athleteSec: number;
  medianSec: number | null;
  hrAtEnd: number | null;
  which: "T1" | "T2";
}): NonNullable<TransitionsAnalysis>["t1"] {
  const { athleteSec, medianSec, hrAtEnd, which } = args;
  let summary = `${which} ${formatDuration(athleteSec)}`;
  if (medianSec !== null) {
    const delta = athleteSec - medianSec;
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
    summary += ` vs typical ${formatDuration(medianSec)} (${sign}${formatDuration(Math.abs(delta))})`;
  }
  if (hrAtEnd !== null && hrAtEnd > 0) {
    summary += `, end HR ${hrAtEnd} bpm`;
  }
  summary += ".";
  return {
    athleteSec,
    populationMedianSec: medianSec,
    hrAtEnd,
    summary
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function computeLegHrHalves(segment: RaceSegmentData): { first: number | null; last: number | null } {
  const laps = getMetricsV2Laps(segment.metricsV2);
  if (laps.length < 2) return { first: null, last: null };
  const totalDuration = laps.reduce((sum, l) => sum + (l.durationSec ?? 0), 0);
  if (totalDuration <= 0) return { first: null, last: null };
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
  const avg = (chunk: ActivityLapMetrics[]): number | null => {
    let weighted = 0;
    let weight = 0;
    for (const lap of chunk) {
      const dur = lap.durationSec ?? 0;
      if (typeof lap.avgHr === "number" && lap.avgHr > 0 && dur > 0) {
        weighted += lap.avgHr * dur;
        weight += dur;
      }
    }
    return weight > 0 ? Math.round(weighted / weight) : null;
  };
  return {
    first: avg(laps.slice(0, splitIdx)),
    last: avg(laps.slice(splitIdx))
  };
}

function lastLapAvgHr(segment: RaceSegmentData | undefined): number | null {
  if (!segment) return null;
  const laps = getMetricsV2Laps(segment.metricsV2);
  if (laps.length === 0) return segment.avgHr ?? null;
  for (let i = laps.length - 1; i >= 0; i--) {
    const hr = laps[i].avgHr;
    if (typeof hr === "number" && hr > 0) return hr;
  }
  return segment.avgHr ?? null;
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(sec: number, unit: "sec_per_km" | "sec_per_100m"): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  const suffix = unit === "sec_per_km" ? " /km" : " /100m";
  return `${m}:${String(s).padStart(2, "0")}${suffix}`;
}

function signedPct(pct: number): string {
  if (pct === 0) return "0.0%";
  return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export types for consumers.
export type { ComparableCandidate } from "./best-comparable";
// Suppress unused import warning if a discipline literal is unused.
export type { RaceSegmentRole };
