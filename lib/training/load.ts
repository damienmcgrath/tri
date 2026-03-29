/**
 * Training load (TSS) computation.
 *
 * Resolves a single TSS value per activity using a cascade:
 *   device (Garmin-computed) → power-based → HR-based → pace-based → duration heuristic
 *
 * All formulas produce a relative stress number on the same scale so that
 * downstream CTL/ATL/TSB math stays consistent regardless of input source.
 */

import { getNestedNumber } from "@/lib/workouts/metrics-v2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TssSource = "device" | "power" | "hr" | "pace" | "duration_estimate";

export type Sport = "swim" | "bike" | "run" | "strength" | "other";

export type TssResult = {
  tss: number;
  source: TssSource;
  intensityFactor: number | null;
};

export type MetricsInput = {
  /** The full metrics_v2 JSONB blob from completed_activities */
  metricsV2: unknown;
  /** Scalar columns from completed_activities */
  sport: Sport;
  durationSec: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  avgPaceSPerKm?: number | null;
  avgPacePer100mSec?: number | null;
};

export type AthleteThresholds = {
  ftp: number | null;
  maxHr: number | null;
  restingHr: number | null;
  /** Threshold run pace in sec/km */
  thresholdRunPace: number | null;
  /** CSS (Critical Swim Speed) in sec/100m */
  thresholdSwimPace: number | null;
};

// ---------------------------------------------------------------------------
// Individual computation methods
// ---------------------------------------------------------------------------

/**
 * Standard power-based TSS: (duration × NP × IF) / (FTP × 3600) × 100
 * Returns null if any required input is missing.
 */
export function computeTssFromPower(
  normalizedPower: number | null,
  intensityFactor: number | null,
  durationSec: number | null,
  ftp: number | null
): number | null {
  if (!normalizedPower || !durationSec || !ftp || ftp <= 0) return null;
  // If IF not provided, derive it
  const ifValue = intensityFactor ?? normalizedPower / ftp;
  const tss = (durationSec * normalizedPower * ifValue) / (ftp * 3600) * 100;
  return clampTss(tss);
}

/**
 * HR-based TSS (hrTSS) using a simplified TRIMP approach.
 *
 * Formula: duration_hours × (avgHR − restHR) / (maxHR − restHR) × 100
 * This produces values roughly comparable to power-based TSS for most
 * steady-state efforts. Not accurate for highly variable sessions.
 */
export function computeTssFromHr(
  avgHr: number | null,
  maxHr: number | null,
  restingHr: number | null,
  durationSec: number | null
): number | null {
  if (!avgHr || !maxHr || !durationSec || maxHr <= 0) return null;
  const restHr = restingHr ?? 50; // conservative default
  const hrRange = maxHr - restHr;
  if (hrRange <= 0) return null;
  const hrRatio = Math.max(0, (avgHr - restHr) / hrRange);
  const durationHours = durationSec / 3600;
  // Scale so that 1hr at threshold HR (~88% of max) ≈ 100 TSS
  const tss = durationHours * hrRatio * hrRatio * 100;
  return clampTss(tss);
}

/**
 * Pace-based TSS for running (rTSS).
 *
 * Formula: (duration × NGP² ) / (thresholdPace² × 3600) × 100
 * where NGP = normalized graded pace (or avg pace as fallback).
 */
export function computeTssFromRunPace(
  avgPaceSPerKm: number | null,
  thresholdPaceSPerKm: number | null,
  durationSec: number | null
): number | null {
  if (!avgPaceSPerKm || !thresholdPaceSPerKm || !durationSec) return null;
  if (avgPaceSPerKm <= 0 || thresholdPaceSPerKm <= 0) return null;
  // Intensity factor for pace: threshold / actual (lower pace = faster = higher IF)
  const ifValue = thresholdPaceSPerKm / avgPaceSPerKm;
  const tss = (durationSec * ifValue * ifValue) / 3600 * 100;
  return clampTss(tss);
}

/**
 * Pace-based TSS for swimming (sTSS).
 *
 * Uses CSS (Critical Swim Speed) as the threshold reference.
 * Formula: (duration × (CSS / actualPace)²) / 3600 × 100
 */
export function computeTssFromSwimPace(
  avgPacePer100mSec: number | null,
  cssPer100mSec: number | null,
  durationSec: number | null
): number | null {
  if (!avgPacePer100mSec || !cssPer100mSec || !durationSec) return null;
  if (avgPacePer100mSec <= 0 || cssPer100mSec <= 0) return null;
  const ifValue = cssPer100mSec / avgPacePer100mSec;
  const tss = (durationSec * ifValue * ifValue) / 3600 * 100;
  return clampTss(tss);
}

/**
 * Duration-based heuristic fallback — last resort when no intensity data exists.
 *
 * Uses conservative fixed multipliers per sport and intent category.
 * Produces rough estimates only, flagged as `duration_estimate` source.
 */
export function computeTssFromDuration(
  durationSec: number | null,
  sport: Sport,
  intentCategory?: string | null
): number | null {
  if (!durationSec || durationSec <= 0) return null;

  const durationHours = durationSec / 3600;

  // Heuristic: TSS per hour by sport and rough intensity
  const category = (intentCategory ?? "").toLowerCase();
  let tssPerHour: number;

  if (sport === "strength") {
    tssPerHour = category.includes("recovery") ? 25 : 40;
  } else if (category.includes("recovery")) {
    tssPerHour = 30;
  } else if (category.includes("easy") || category.includes("endurance")) {
    tssPerHour = 50;
  } else if (category.includes("threshold") || category.includes("tempo")) {
    tssPerHour = 80;
  } else if (category.includes("vo2") || category.includes("speed") || category.includes("interval")) {
    tssPerHour = 90;
  } else {
    // Generic moderate effort
    tssPerHour = 55;
  }

  return clampTss(durationHours * tssPerHour);
}

// ---------------------------------------------------------------------------
// Cascade resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the best available TSS for an activity, cascading through methods:
 *   1. Device-computed TSS (from Garmin/watch in metrics_v2)
 *   2. Power-based TSS (if NP + FTP available)
 *   3. HR-based TSS (if avgHr + maxHr available)
 *   4. Pace-based TSS (if run/swim pace + threshold available)
 *   5. Duration-based heuristic
 */
export function resolveTss(
  metrics: MetricsInput,
  thresholds: AthleteThresholds,
  intentCategory?: string | null
): TssResult {
  const { metricsV2, sport, durationSec, avgHr, maxHr, avgPower } = metrics;

  // 1. Device-computed TSS from Garmin
  const deviceTss = getNestedNumber(metricsV2, [
    ["load", "trainingStressScore"]
  ]);
  if (deviceTss !== null && deviceTss > 0) {
    const np = getNestedNumber(metricsV2, [["power", "normalizedPower"]]);
    const ifVal = getNestedNumber(metricsV2, [["power", "intensityFactor"]]);
    return { tss: clampTss(deviceTss), source: "device", intensityFactor: ifVal };
  }

  // 2. Power-based TSS
  const np = getNestedNumber(metricsV2, [["power", "normalizedPower"]]) ?? avgPower;
  const ifFromDevice = getNestedNumber(metricsV2, [["power", "intensityFactor"]]);
  if (np && thresholds.ftp) {
    const tss = computeTssFromPower(np, ifFromDevice, durationSec, thresholds.ftp);
    if (tss !== null) {
      const ifValue = ifFromDevice ?? (thresholds.ftp > 0 ? np / thresholds.ftp : null);
      return { tss, source: "power", intensityFactor: ifValue };
    }
  }

  // 3. HR-based TSS
  const activityMaxHr = getNestedNumber(metricsV2, [["heartRate", "maxHr"]]) ?? maxHr;
  const hrTss = computeTssFromHr(avgHr, thresholds.maxHr ?? activityMaxHr, thresholds.restingHr, durationSec);
  if (hrTss !== null) {
    return { tss: hrTss, source: "hr", intensityFactor: null };
  }

  // 4. Pace-based TSS
  if (sport === "run" && thresholds.thresholdRunPace) {
    const avgPace = metrics.avgPaceSPerKm
      ?? getNestedNumber(metricsV2, [["pace", "avgPaceSecPerKm"]]);
    const rTss = computeTssFromRunPace(avgPace, thresholds.thresholdRunPace, durationSec);
    if (rTss !== null) {
      const ifValue = thresholds.thresholdRunPace && avgPace
        ? thresholds.thresholdRunPace / avgPace
        : null;
      return { tss: rTss, source: "pace", intensityFactor: ifValue };
    }
  }

  if (sport === "swim" && thresholds.thresholdSwimPace) {
    const avgSwimPace = metrics.avgPacePer100mSec
      ?? getNestedNumber(metricsV2, [["pace", "avgPacePer100mSec"]]);
    const sTss = computeTssFromSwimPace(avgSwimPace, thresholds.thresholdSwimPace, durationSec);
    if (sTss !== null) {
      const ifValue = thresholds.thresholdSwimPace && avgSwimPace
        ? thresholds.thresholdSwimPace / avgSwimPace
        : null;
      return { tss: sTss, source: "pace", intensityFactor: ifValue };
    }
  }

  // 5. Duration-based heuristic
  const durationTss = computeTssFromDuration(durationSec, sport, intentCategory);
  return {
    tss: durationTss ?? 0,
    source: "duration_estimate",
    intensityFactor: null
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampTss(tss: number): number {
  return Math.round(Math.max(0, Math.min(999, tss)) * 10) / 10;
}
