import type { PlannedTargetBand, SplitMetrics } from "@/lib/coach/session-diagnosis";
import { getMetricsV2Laps } from "@/lib/workouts/metrics-v2";
import { asRecord, getNestedNumber, getNumber, type SessionExecutionActivityRow } from "./session-execution-helpers";

export function deriveCompletedIntervals(activity: SessionExecutionActivityRow) {
  const lapMetrics = getMetricsV2Laps(activity.metrics_v2);
  if (lapMetrics.length > 0) {
    const workLaps = lapMetrics.filter((lap) => (lap.distanceM ?? 0) > 0);
    return workLaps.length > 0 ? workLaps.length : lapMetrics.length;
  }
  return activity.laps_count ?? null;
}

/**
 * For interval sessions, compute duration-weighted average power from work
 * laps only (excluding warm-up, cool-down, recovery). Returns null when
 * lap data is unavailable or the session doesn't look like an interval workout.
 */
export function deriveWorkIntervalAvgPower(args: {
  activity: SessionExecutionActivityRow;
  targetBands: PlannedTargetBand | null;
  plannedIntervals: number | null;
}): number | null {
  const lapMetrics = getMetricsV2Laps(args.activity.metrics_v2);
  // Need at least 2 laps with power to distinguish work from recovery
  const lapsWithPower = lapMetrics.filter(
    (lap) => lap.avgPower != null && lap.avgPower > 0 && lap.durationSec != null && lap.durationSec > 0
  );
  if (lapsWithPower.length < 2) return null;

  let workLaps: typeof lapsWithPower;

  const targetPowerMin = args.targetBands?.power?.min;
  if (targetPowerMin) {
    // Strategy 1: use target power to identify work laps (within 20% of target floor)
    workLaps = lapsWithPower.filter((lap) => lap.avgPower! >= targetPowerMin * 0.80);
  } else {
    // Strategy 2: relative power clustering — work laps are in the top power cluster
    const maxLapPower = Math.max(...lapsWithPower.map((lap) => lap.avgPower!));
    workLaps = lapsWithPower.filter((lap) => lap.avgPower! >= maxLapPower * 0.70);
  }

  // Need at least 1 work lap that is a strict subset of all laps.
  // Allow a single work lap when the plan calls for exactly 1 interval (e.g. 1x20min).
  const minWorkLaps = args.plannedIntervals === 1 ? 1 : 2;
  if (workLaps.length < minWorkLaps) return null;

  // Work laps should be a subset (not all laps) — otherwise it's a steady session
  if (workLaps.length === lapsWithPower.length) return null;

  const totalDuration = workLaps.reduce((sum, lap) => sum + lap.durationSec!, 0);
  if (totalDuration <= 0) return null;

  const weightedPower = workLaps.reduce((sum, lap) => sum + lap.avgPower! * lap.durationSec!, 0);
  return Math.round(weightedPower / totalDuration);
}

export function deriveTimeAboveTargetPct(args: {
  targetBands: PlannedTargetBand | null;
  activity: SessionExecutionActivityRow;
}) {
  const metrics = asRecord(args.activity.metrics_v2);
  const lapMetrics = getMetricsV2Laps(args.activity.metrics_v2);
  const explicit =
    getNumber(metrics, ["timeAboveTargetPct", "time_above_target_pct"]) ??
    getNestedNumber([metrics], [["intensity", "timeAboveTargetPct"], ["intensity", "time_above_target_pct"]]);
  if (explicit !== null) return explicit;

  const totalLapDurationSec = lapMetrics.reduce((sum, lap) => sum + Math.max(0, lap.durationSec ?? 0), 0);
  if (totalLapDurationSec <= 0) return null;

  const targetPowerMax = args.targetBands?.power?.max;
  if (targetPowerMax) {
    const abovePowerSec = lapMetrics.reduce((sum, lap) => {
      if (!lap.durationSec || !lap.avgPower) return sum;
      return lap.avgPower > targetPowerMax ? sum + lap.durationSec : sum;
    }, 0);
    if (abovePowerSec > 0) return Number((abovePowerSec / totalLapDurationSec).toFixed(2));
  }

  const targetHrMax = args.targetBands?.hr?.max;
  if (targetHrMax) {
    const aboveHrSec = lapMetrics.reduce((sum, lap) => {
      if (!lap.durationSec || !lap.avgHr) return sum;
      return lap.avgHr > targetHrMax ? sum + lap.durationSec : sum;
    }, 0);
    if (aboveHrSec > 0) return Number((aboveHrSec / totalLapDurationSec).toFixed(2));
  }

  return null;
}

export function deriveAvgPaceSecPerKm(activity: SessionExecutionActivityRow) {
  if (activity.sport_type === "swim") return null;
  const parseSummary = asRecord(activity.parse_summary);
  const parsedPace = getNumber(parseSummary, ["avgPaceSecPerKm", "avg_pace_sec_per_km"]);
  if (parsedPace !== null) return parsedPace;
  if (!activity.duration_sec || !activity.distance_m || activity.distance_m <= 0) return null;
  return Number((activity.duration_sec / (activity.distance_m / 1000)).toFixed(2));
}

export function extractSplitMetrics(activity: SessionExecutionActivityRow): SplitMetrics | null {
  const metrics = asRecord(activity.metrics_v2);
  const parseSummary = asRecord(activity.parse_summary);
  const splits = asRecord(metrics?.splits);
  const halves = asRecord(metrics?.halves);
  const sources = [splits, halves, metrics, parseSummary];

  const firstHalfAvgHr = getNestedNumber(sources, [["firstHalfAvgHr"], ["first_half_avg_hr"], ["firstHalf", "avgHr"], ["first_half", "avg_hr"]]);
  const lastHalfAvgHr = getNestedNumber(sources, [["lastHalfAvgHr"], ["last_half_avg_hr"], ["lastHalf", "avgHr"], ["last_half", "avg_hr"]]);
  const firstHalfAvgPower = getNestedNumber(sources, [["firstHalfAvgPower"], ["first_half_avg_power"], ["firstHalf", "avgPower"], ["first_half", "avg_power"]]);
  const lastHalfAvgPower = getNestedNumber(sources, [["lastHalfAvgPower"], ["last_half_avg_power"], ["lastHalf", "avgPower"], ["last_half", "avg_power"]]);
  const firstHalfPaceSPerKm = getNestedNumber(sources, [["firstHalfPaceSPerKm"], ["first_half_pace_s_per_km"], ["firstHalf", "avgPaceSecPerKm"], ["first_half", "avg_pace_sec_per_km"]]);
  const lastHalfPaceSPerKm = getNestedNumber(sources, [["lastHalfPaceSPerKm"], ["last_half_pace_s_per_km"], ["lastHalf", "avgPaceSecPerKm"], ["last_half", "avg_pace_sec_per_km"]]);
  const firstHalfAvgCadence = getNestedNumber(sources, [["firstHalfAvgCadence"], ["first_half_avg_cadence"], ["firstHalf", "avgCadence"], ["first_half", "avg_cadence"]]);
  const lastHalfAvgCadence = getNestedNumber(sources, [["lastHalfAvgCadence"], ["last_half_avg_cadence"], ["lastHalf", "avgCadence"], ["last_half", "avg_cadence"]]);
  const firstHalfPacePer100mSec = getNestedNumber(sources, [["firstHalfPacePer100mSec"], ["first_half_pace_per_100m_sec"], ["firstHalf", "avgPacePer100mSec"], ["first_half", "avg_pace_per_100m_sec"]]);
  const lastHalfPacePer100mSec = getNestedNumber(sources, [["lastHalfPacePer100mSec"], ["last_half_pace_per_100m_sec"], ["lastHalf", "avgPacePer100mSec"], ["last_half", "avg_pace_per_100m_sec"]]);
  const firstHalfStrokeRate = getNestedNumber(sources, [["firstHalfStrokeRate"], ["first_half_stroke_rate"], ["firstHalf", "strokeRate"], ["first_half", "stroke_rate"]]);
  const lastHalfStrokeRate = getNestedNumber(sources, [["lastHalfStrokeRate"], ["last_half_stroke_rate"], ["lastHalf", "strokeRate"], ["last_half", "stroke_rate"]]);

  const splitMetrics: SplitMetrics = {};
  if (firstHalfAvgHr !== null) splitMetrics.firstHalfAvgHr = firstHalfAvgHr;
  if (lastHalfAvgHr !== null) splitMetrics.lastHalfAvgHr = lastHalfAvgHr;
  if (firstHalfAvgPower !== null) splitMetrics.firstHalfAvgPower = firstHalfAvgPower;
  if (lastHalfAvgPower !== null) splitMetrics.lastHalfAvgPower = lastHalfAvgPower;
  if (firstHalfPaceSPerKm !== null) splitMetrics.firstHalfPaceSPerKm = firstHalfPaceSPerKm;
  if (lastHalfPaceSPerKm !== null) splitMetrics.lastHalfPaceSPerKm = lastHalfPaceSPerKm;
  if (firstHalfAvgCadence !== null) (splitMetrics as SplitMetrics & Record<string, number>).firstHalfAvgCadence = firstHalfAvgCadence;
  if (lastHalfAvgCadence !== null) (splitMetrics as SplitMetrics & Record<string, number>).lastHalfAvgCadence = lastHalfAvgCadence;
  if (firstHalfPacePer100mSec !== null) (splitMetrics as SplitMetrics & Record<string, number>).firstHalfPacePer100mSec = firstHalfPacePer100mSec;
  if (lastHalfPacePer100mSec !== null) (splitMetrics as SplitMetrics & Record<string, number>).lastHalfPacePer100mSec = lastHalfPacePer100mSec;
  if (firstHalfStrokeRate !== null) (splitMetrics as SplitMetrics & Record<string, number>).firstHalfStrokeRate = firstHalfStrokeRate;
  if (lastHalfStrokeRate !== null) (splitMetrics as SplitMetrics & Record<string, number>).lastHalfStrokeRate = lastHalfStrokeRate;

  return Object.keys(splitMetrics).length > 0 ? splitMetrics : null;
}
