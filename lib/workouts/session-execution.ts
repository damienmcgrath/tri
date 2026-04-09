import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnoseCompletedSession, type PlannedTargetBand, type SessionDiagnosis, type SessionDiagnosisInput, type SplitMetrics } from "@/lib/coach/session-diagnosis";
import { getAthleteContextSnapshot } from "@/lib/athlete-context";
import { buildExecutionEvidence, generateCoachVerdict, refreshObservedPatterns, toPersistedExecutionReview, type PersistedExecutionReview } from "@/lib/execution-review";
import { getMetricsV2Laps, getNestedNumber as getMetricsNestedNumber } from "@/lib/workouts/metrics-v2";

type SessionExecutionSessionRow = {
  id: string;
  athlete_id?: string;
  user_id: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  target?: string | null;
  notes?: string | null;
  intent_category?: string | null;
  session_name?: string | null;
  session_role?: string | null;
  status?: "planned" | "completed" | "skipped" | null;
};

type SessionExecutionActivityRow = {
  id: string;
  sport_type: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec?: number | null;
  laps_count?: number | null;
  parse_summary?: Record<string, unknown> | null;
  metrics_v2?: Record<string, unknown> | null;
};

type PersistedExecutionResult = PersistedExecutionReview;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getNumber(source: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function getNestedNumber(sources: Array<Record<string, unknown> | null | undefined>, keyPaths: string[][]) {
  for (const source of sources) {
    for (const path of keyPaths) {
      let cursor: unknown = source;
      for (const key of path) {
        if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(key in cursor)) {
          cursor = null;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[key];
      }
      if (typeof cursor === "number" && Number.isFinite(cursor)) return cursor;
    }
  }
  return null;
}

function sumZoneDurations(zones: unknown[] | undefined) {
  if (!Array.isArray(zones)) return null;
  return zones.reduce<number>((sum, zone) => sum + (getNumber(asRecord(zone), ["durationSec", "duration_sec"]) ?? 0), 0);
}

function deriveCompletedIntervals(activity: SessionExecutionActivityRow) {
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

function deriveTimeAboveTargetPct(args: {
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

function parsePlannedIntervals(text: string | null | undefined) {
  if (!text) return null;
  const normalized = text.toLowerCase();
  const xMatch = normalized.match(/\b(\d{1,2})\s*x\s*\d/);
  if (xMatch) return Number(xMatch[1]);
  const repsMatch = normalized.match(/\b(\d{1,2})\s*(reps|intervals|laps)\b/);
  if (repsMatch) return Number(repsMatch[1]);
  return null;
}

export function parseTargetBands(text: string | null | undefined): PlannedTargetBand | null {
  if (!text) return null;
  const targetBands: PlannedTargetBand = {};
  const normalized = text.toLowerCase();

  const hrRange = normalized.match(/(?:hr|heart rate)?\s*(\d{2,3})\s*[-–]\s*(\d{2,3})\s*bpm?/i);
  if (hrRange) {
    targetBands.hr = { min: Number(hrRange[1]), max: Number(hrRange[2]) };
  }

  const powerRange = normalized.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})\s*w\b/i);
  if (powerRange) {
    targetBands.power = { min: Number(powerRange[1]), max: Number(powerRange[2]) };
  }

  // Single power value: "at 210W", "@ 210W", "~210W"
  if (!targetBands.power) {
    const singlePower = normalized.match(/(?:[@≈~]|at|around)\s*(\d{2,4})\s*w\b/i);
    if (singlePower) {
      const value = Number(singlePower[1]);
      targetBands.power = { min: value, max: value };
    }
  }

  // Swim pace: "1:50-2:00/100m", "1:50–2:00 per 100m", "1:50-2:00 /100"
  const paceRange100m = normalized.match(/(\d):(\d{2})\s*[-–]\s*(\d):(\d{2})\s*(?:\/|\s*per\s*)100\s*m?/);
  if (paceRange100m) {
    const minSec = Number(paceRange100m[1]) * 60 + Number(paceRange100m[2]);
    const maxSec = Number(paceRange100m[3]) * 60 + Number(paceRange100m[4]);
    targetBands.pace100m = { min: minSec, max: maxSec };
  }

  // Swim pace: "≤1:55/100m" or "@ 1:55/100m" (single pace value → treat as max)
  if (!targetBands.pace100m) {
    const singlePace100m = normalized.match(/(?:[@≤<]|at|under|around)\s*(\d):(\d{2})\s*(?:\/|\s*per\s*)100\s*m?/);
    if (singlePace100m) {
      const sec = Number(singlePace100m[1]) * 60 + Number(singlePace100m[2]);
      targetBands.pace100m = { max: sec };
    }
  }

  return Object.keys(targetBands).length > 0 ? targetBands : null;
}

function deriveAvgPaceSecPerKm(activity: SessionExecutionActivityRow) {
  if (activity.sport_type === "swim") return null;
  const parseSummary = asRecord(activity.parse_summary);
  const parsedPace = getNumber(parseSummary, ["avgPaceSecPerKm", "avg_pace_sec_per_km"]);
  if (parsedPace !== null) return parsedPace;
  if (!activity.duration_sec || !activity.distance_m || activity.distance_m <= 0) return null;
  return Number((activity.duration_sec / (activity.distance_m / 1000)).toFixed(2));
}

function deriveWeekAdjustment(diagnosis: SessionDiagnosis) {
  if (diagnosis.intentMatchStatus === "matched_intent") {
    return "Keep the next key session as planned and use the same execution approach.";
  }

  if (diagnosis.recommendedNextAction.toLowerCase().includes("easy") || diagnosis.whyItMatters.toLowerCase().includes("fatigue")) {
    return "Keep the week steady and protect recovery before adding more intensity.";
  }

  if (diagnosis.recommendedNextAction.toLowerCase().includes("repeat")) {
    return "Repeat the intent before progressing the load, and keep the rest of the week as planned.";
  }

  return "Keep the rest of the week stable and focus on executing the next similar session more cleanly.";
}

function extractSplitMetrics(activity: SessionExecutionActivityRow): SplitMetrics | null {
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

function asExecutionResult(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function shouldRefreshExecutionResultFromActivity(
  executionResult: Record<string, unknown> | null | undefined,
  activity: SessionExecutionActivityRow
) {
  const current = asExecutionResult(executionResult);
  if (!current) return true;

  const metrics = asRecord(activity.metrics_v2);
  const splitMetrics = extractSplitMetrics(activity);
  const normalizedPower = getMetricsNestedNumber(metrics, [["power", "normalizedPower"], ["power", "normalized_power"]]);
  const variabilityIndex =
    getMetricsNestedNumber(metrics, [["power", "variabilityIndex"], ["power", "variability_index"]]) ??
    getNumber(metrics, ["variabilityIndex", "variability_index"]);
  const trainingStressScore = getMetricsNestedNumber(metrics, [["load", "trainingStressScore"], ["load", "training_stress_score"]]);
  const avgCadence =
    getMetricsNestedNumber(metrics, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]]) ??
    getNumber(metrics, ["avgCadence", "avg_cadence"]);
  const elevationGainM = getMetricsNestedNumber(metrics, [["elevation", "gainM"], ["elevation", "gain_m"]]);
  const avgStrokeRateSpm = getMetricsNestedNumber(metrics, [["stroke", "avgStrokeRateSpm"], ["stroke", "avg_stroke_rate_spm"]]);
  const avgSwolf = getMetricsNestedNumber(metrics, [["stroke", "avgSwolf"], ["stroke", "avg_swolf"]]);
  const poolLengthM = getMetricsNestedNumber(metrics, [["pool", "poolLengthM"], ["pool", "pool_length_m"]]);
  const hrZones = (asRecord(metrics?.zones)?.hr as unknown[] | undefined) ?? (asRecord(metrics?.zones)?.heartRate as unknown[] | undefined);
  const paceZones = asRecord(metrics?.zones)?.pace as unknown[] | undefined;
  const hasHrZones = Array.isArray(hrZones) && hrZones.length > 0;
  const hasPaceZones = Array.isArray(paceZones) && paceZones.length > 0;
  const hasLapStructure = getMetricsV2Laps(activity.metrics_v2).some((lap) => (lap.distanceM ?? 0) > 0);

  if (normalizedPower !== null && getNumber(current, ["normalizedPower", "normalized_power"]) === null) return true;
  if (variabilityIndex !== null && getNumber(current, ["variabilityIndex", "variability_index"]) === null) return true;
  if (trainingStressScore !== null && getNumber(current, ["trainingStressScore", "training_stress_score"]) === null) return true;
  if (avgCadence !== null && getNumber(current, ["avgCadence", "avg_cadence"]) === null) return true;
  if (elevationGainM !== null && getNumber(current, ["elevationGainM", "elevation_gain_m"]) === null) return true;
  if (avgStrokeRateSpm !== null && getNumber(current, ["avgStrokeRateSpm", "avg_stroke_rate_spm"]) === null) return true;
  if (avgSwolf !== null && getNumber(current, ["avgSwolf", "avg_swolf"]) === null) return true;
  if (poolLengthM !== null && getNumber(current, ["poolLengthM", "pool_length_m"]) === null) return true;
  if (hasHrZones && getNumber(current, ["hrZoneTimeSec", "hr_zone_time_sec"]) === null) return true;
  if (hasPaceZones && getNumber(current, ["paceZoneTimeSec", "pace_zone_time_sec"]) === null) return true;

  if (splitMetrics) {
    const hasSplitMetricsInResult = [
      getNumber(current, ["firstHalfAvgHr", "first_half_avg_hr"]),
      getNumber(current, ["lastHalfAvgHr", "last_half_avg_hr"]),
      getNumber(current, ["firstHalfAvgPower", "first_half_avg_power"]),
      getNumber(current, ["lastHalfAvgPower", "last_half_avg_power"]),
      getNumber(current, ["firstHalfPaceSPerKm", "first_half_pace_s_per_km"]),
      getNumber(current, ["lastHalfPaceSPerKm", "last_half_pace_s_per_km"]),
      getNumber(current, ["firstHalfPacePer100mSec", "first_half_pace_per_100m_sec"]),
      getNumber(current, ["lastHalfPacePer100mSec", "last_half_pace_per_100m_sec"]),
      getNumber(current, ["firstHalfStrokeRate", "first_half_stroke_rate"]),
      getNumber(current, ["lastHalfStrokeRate", "last_half_stroke_rate"])
    ].some((value) => value !== null);

    if (!hasSplitMetricsInResult) return true;
  }

  if (activity.sport_type === "swim" && hasLapStructure && getNumber(current, ["lengthCount", "length_count"]) === null) {
    return true;
  }

  // If the activity has laps with power data but the result has no avgIntervalPower,
  // refresh so we can derive work-interval power for threshold sessions.
  const lapsWithPower = getMetricsV2Laps(activity.metrics_v2).filter(
    (lap) => lap.avgPower != null && lap.avgPower > 0 && lap.durationSec != null && lap.durationSec > 0
  );
  if (lapsWithPower.length >= 2 && getNumber(current, ["avgIntervalPower", "avg_interval_power"]) === null) {
    return true;
  }

  return false;
}

function buildDiagnosisInput(session: SessionExecutionSessionRow, activity: SessionExecutionActivityRow): SessionDiagnosisInput {
  const metrics = asRecord(activity.metrics_v2);
  const parseSummary = asRecord(activity.parse_summary);
  const plannedIntervals = parsePlannedIntervals(session.target ?? session.type);
  const targetBands = parseTargetBands(session.target);
  const completedIntervals = deriveCompletedIntervals(activity);

  const intervalCompletionPct =
    getNumber(metrics, ["intervalCompletionPct", "interval_completion_pct"]) ??
    getNumber(parseSummary, ["intervalCompletionPct", "interval_completion_pct"]) ??
    (plannedIntervals && completedIntervals ? Number((Math.min(1, completedIntervals / plannedIntervals)).toFixed(2)) : null);

  const timeAboveTargetPct = deriveTimeAboveTargetPct({ targetBands, activity });
  const avgIntervalPower = deriveWorkIntervalAvgPower({ activity, targetBands, plannedIntervals });

  const variabilityIndex =
    getNumber(metrics, ["variabilityIndex", "variability_index"]) ??
    getNestedNumber([metrics], [["power", "variabilityIndex"], ["power", "variability_index"]]);

  const normalizedPower =
    getMetricsNestedNumber(metrics, [["power", "normalizedPower"], ["power", "normalized_power"]]);
  const trainingStressScore =
    getMetricsNestedNumber(metrics, [["load", "trainingStressScore"], ["load", "training_stress_score"]]);
  const aerobicTrainingEffect =
    getMetricsNestedNumber(metrics, [["load", "aerobicTrainingEffect"], ["load", "aerobic_training_effect"], ["load", "trainingEffect"], ["load", "training_effect"]]);
  const anaerobicTrainingEffect =
    getMetricsNestedNumber(metrics, [["load", "anaerobicTrainingEffect"], ["load", "anaerobic_training_effect"]]);
  const intensityFactor =
    getMetricsNestedNumber(metrics, [["power", "intensityFactor"], ["power", "intensity_factor"]]);
  const totalWorkKj =
    getMetricsNestedNumber(metrics, [["power", "totalWorkKj"], ["power", "total_work_kj"]]);
  const avgCadence =
    getMetricsNestedNumber(metrics, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]]) ??
    getNumber(metrics, ["avgCadence", "avg_cadence"]);
  const maxCadence =
    getMetricsNestedNumber(metrics, [["cadence", "maxCadence"], ["cadence", "max_cadence"]]) ??
    getNumber(metrics, ["maxCadence", "max_cadence"]);
  const bestPaceSPerKm =
    getMetricsNestedNumber(metrics, [["pace", "bestPaceSecPerKm"], ["pace", "best_pace_sec_per_km"]]);
  const normalizedGradedPaceSPerKm =
    getMetricsNestedNumber(metrics, [["pace", "normalizedGradedPaceSecPerKm"], ["pace", "normalized_graded_pace_sec_per_km"]]);
  const avgPacePer100mSec =
    getMetricsNestedNumber(metrics, [["pace", "avgPacePer100mSec"], ["pace", "avg_pace_per_100m_sec"]]) ??
    activity.avg_pace_per_100m_sec ??
    null;
  const bestPacePer100mSec =
    getMetricsNestedNumber(metrics, [["pace", "bestPacePer100mSec"], ["pace", "best_pace_per_100m_sec"]]);
  const avgStrokeRateSpm =
    getMetricsNestedNumber(metrics, [["stroke", "avgStrokeRateSpm"], ["stroke", "avg_stroke_rate_spm"]]);
  const maxStrokeRateSpm =
    getMetricsNestedNumber(metrics, [["stroke", "maxStrokeRateSpm"], ["stroke", "max_stroke_rate_spm"]]);
  const avgSwolf =
    getMetricsNestedNumber(metrics, [["stroke", "avgSwolf"], ["stroke", "avg_swolf"]]);
  const elevationGainM =
    getMetricsNestedNumber(metrics, [["elevation", "gainM"], ["elevation", "gain_m"]]);
  const elevationLossM =
    getMetricsNestedNumber(metrics, [["elevation", "lossM"], ["elevation", "loss_m"]]);
  const poolLengthM =
    getMetricsNestedNumber(metrics, [["pool", "poolLengthM"], ["pool", "pool_length_m"]]);
  const lengthCount =
    getMetricsNestedNumber(metrics, [["pool", "lengthCount"], ["pool", "length_count"]]);
  const hrZoneTimeSec = sumZoneDurations(
    (asRecord(metrics?.zones)?.hr as unknown[] | undefined) ?? (asRecord(metrics?.zones)?.heartRate as unknown[] | undefined)
  );
  const paceZoneTimeSec = sumZoneDurations(asRecord(metrics?.zones)?.pace as unknown[] | undefined);
  const maxHr =
    getMetricsNestedNumber(metrics, [["heartRate", "maxHr"], ["heart_rate", "max_hr"]]) ??
    getNumber(parseSummary, ["maxHr", "max_hr"]);
  const maxPower =
    getMetricsNestedNumber(metrics, [["power", "maxPower"], ["power", "max_power"]]) ??
    getNumber(parseSummary, ["maxPower", "max_power"]);

  return {
    planned: {
      sport: (session.sport as SessionDiagnosisInput["planned"]["sport"]) ?? "other",
      plannedDurationSec: session.duration_minutes ? session.duration_minutes * 60 : null,
      intentCategory: session.intent_category ?? session.type,
      targetBands,
      plannedIntervals
    },
    actual: {
      durationSec: activity.duration_sec,
      avgHr: activity.avg_hr,
      avgPower: activity.avg_power,
      avgIntervalPower,
      avgPaceSPerKm: deriveAvgPaceSecPerKm(activity),
      variabilityIndex,
      timeAboveTargetPct,
      intervalCompletionPct,
      completedIntervals,
      splitMetrics: extractSplitMetrics(activity),
      metrics: {
        avg_hr: activity.avg_hr ?? null,
        avg_power: activity.avg_power ?? null,
        normalized_power: normalizedPower,
        variability_index: variabilityIndex,
        training_stress_score: trainingStressScore,
        aerobic_training_effect: aerobicTrainingEffect,
        anaerobic_training_effect: anaerobicTrainingEffect,
        intensity_factor: intensityFactor,
        total_work_kj: totalWorkKj,
        avg_cadence: avgCadence,
        max_cadence: maxCadence,
        best_pace_s_per_km: bestPaceSPerKm,
        normalized_graded_pace_s_per_km: normalizedGradedPaceSPerKm,
        avg_pace_per_100m_sec: avgPacePer100mSec,
        best_pace_per_100m_sec: bestPacePer100mSec,
        avg_stroke_rate_spm: avgStrokeRateSpm,
        max_stroke_rate_spm: maxStrokeRateSpm,
        avg_swolf: avgSwolf,
        elevation_gain_m: elevationGainM,
        elevation_loss_m: elevationLossM,
        pool_length_m: poolLengthM,
        length_count: lengthCount,
        hr_zone_time_sec: hrZoneTimeSec,
        pace_zone_time_sec: paceZoneTimeSec,
        max_hr: maxHr,
        max_power: maxPower
      }
    }
  };
}

export function buildExecutionResultForSession(session: SessionExecutionSessionRow, activity: SessionExecutionActivityRow): PersistedExecutionResult {
  const diagnosisInput = buildDiagnosisInput(session, activity);
  const { diagnosis, evidence } = buildExecutionEvidence({
    athleteId: session.athlete_id ?? session.user_id,
    sessionId: session.id,
    sessionTitle: session.session_name ?? session.type,
    sessionRole: session.session_role,
    plannedStructure: [session.target, session.notes].filter(Boolean).join(" | ") || null,
    diagnosisInput
  });

  return toPersistedExecutionReview({
    linkedActivityId: activity.id,
    evidence,
    narrativeSource: "fallback",
    verdict: {
      sessionVerdict: {
        headline: diagnosis.intentMatchStatus === "matched_intent" ? "Intent landed" : diagnosis.intentMatchStatus === "missed_intent" ? "Intent came up short" : "Intent partially landed",
        summary: diagnosis.executionScoreSummary,
        intentMatch: evidence.rulesSummary.intentMatch,
        executionCost: evidence.rulesSummary.executionCost,
        confidence: diagnosis.diagnosisConfidence,
        nextCall:
          diagnosis.intentMatchStatus === "matched_intent"
            ? "move_on"
            : diagnosis.intentMatchStatus === "missed_intent"
              ? "repeat_session"
              : "proceed_with_caution"
      },
      explanation: {
        whatHappened: diagnosis.executionSummary,
        whyItMatters: diagnosis.whyItMatters,
        whatToDoNextTime: diagnosis.recommendedNextAction,
        whatToDoThisWeek: deriveWeekAdjustment(diagnosis)
      },
      uncertainty: {
        label: diagnosis.diagnosisConfidence === "high" ? "confident_read" : diagnosis.evidenceCount > 0 ? "early_read" : "insufficient_data",
        detail:
          diagnosis.diagnosisConfidence === "high"
            ? "This read is grounded in enough execution evidence to use with confidence."
            : "This is a useful early read, but some execution detail is still missing.",
        missingEvidence: evidence.missingEvidence
      },
      citedEvidence: [
        {
          claim: diagnosis.executionScoreSummary,
          support: evidence.detectedIssues.flatMap((issue) => issue.supportingMetrics).slice(0, 4)
        }
      ]
    }
  });
}

async function loadSessionAndActivity(supabase: SupabaseClient, userId: string, sessionId: string, activityId: string) {
  const [{ data: session, error: sessionError }, { data: activity, error: activityError }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id,athlete_id,user_id,sport,type,duration_minutes,target,notes,intent_category,session_name,session_role,status")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("completed_activities")
      .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
      .eq("id", activityId)
      .eq("user_id", userId)
      .maybeSingle()
  ]);

  if (sessionError) throw new Error(sessionError.message);
  if (activityError) throw new Error(activityError.message);
  if (!session) throw new Error("Session not found while syncing execution result.");
  if (!activity) throw new Error("Activity not found while syncing execution result.");

  return {
    session: session as SessionExecutionSessionRow,
    activity: activity as SessionExecutionActivityRow
  };
}

export async function syncSessionExecutionFromActivityLink(args: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  activityId: string;
}) {
  const { session, activity } = await loadSessionAndActivity(args.supabase, args.userId, args.sessionId, args.activityId);
  const diagnosisInput = buildDiagnosisInput(session, activity);
  let athleteContext = null;
  try {
    athleteContext = await getAthleteContextSnapshot(args.supabase, session.athlete_id ?? args.userId);
  } catch {
    athleteContext = null;
  }
  const { evidence } = buildExecutionEvidence({
    athleteId: session.athlete_id ?? args.userId,
    sessionId: session.id,
    sessionTitle: session.session_name ?? session.type,
    sessionRole: session.session_role,
    plannedStructure: [session.target, session.notes].filter(Boolean).join(" | ") || null,
    diagnosisInput,
    weeklyState: athleteContext ? { fatigue: athleteContext.weeklyState.fatigue } : null
  });
  const generated = await generateCoachVerdict({
    evidence,
    athleteContext,
    recentReviewedSessions: []
  });
  const executionResult = toPersistedExecutionReview({
    linkedActivityId: activity.id,
    evidence,
    verdict: generated.verdict,
    narrativeSource: generated.source
  });

  const { error } = await args.supabase
    .from("sessions")
    .update({
      status: "completed",
      execution_result: executionResult
    })
    .eq("id", session.id)
    .eq("user_id", args.userId);

  if (error) throw new Error(error.message);

  try {
    await refreshObservedPatterns(args.supabase, session.athlete_id ?? args.userId);
  } catch {
    // Pattern refresh is non-blocking.
  }

  return executionResult;
}

export async function syncSessionExecutionAfterUnlink(args: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
}) {
  const { data: links, error: linkError } = await args.supabase
    .from("session_activity_links")
    .select("completed_activity_id,confirmation_status,created_at")
    .eq("planned_session_id", args.sessionId)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (linkError) throw new Error(linkError.message);

  const confirmedLink = (links ?? []).find((link) => link.completed_activity_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null));

  if (confirmedLink?.completed_activity_id) {
    return syncSessionExecutionFromActivityLink({
      supabase: args.supabase,
      userId: args.userId,
      sessionId: args.sessionId,
      activityId: confirmedLink.completed_activity_id
    });
  }

  const { error: clearError } = await args.supabase
    .from("sessions")
    .update({
      status: "planned",
      execution_result: null
    })
    .eq("id", args.sessionId)
    .eq("user_id", args.userId);

  if (clearError) throw new Error(clearError.message);

  return null;
}

export async function backfillPendingSessionExecutions(args: {
  supabase: SupabaseClient;
  userId: string;
  limit?: number;
  force?: boolean;
}) {
  console.info("[execution-review-backfill] Starting backfill", {
    userId: args.userId,
    limit: args.limit ?? null,
    force: args.force === true
  });

  const { data: links, error: linkError } = await args.supabase
    .from("session_activity_links")
    .select("planned_session_id,completed_activity_id,confirmation_status,created_at")
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false });

  if (linkError) throw new Error(linkError.message);

  const confirmedLinks = (links ?? []).filter(
    (link) => link.planned_session_id && link.completed_activity_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null)
  );

  console.info("[execution-review-backfill] Loaded links", {
    totalLinks: (links ?? []).length,
    confirmedLinks: confirmedLinks.length
  });

  if (confirmedLinks.length === 0) {
    console.info("[execution-review-backfill] No confirmed links found; nothing to do");
    return { updated: 0, attempted: 0 };
  }

  let candidateLinks = confirmedLinks;

  if (!args.force) {
    const sessionIds = [...new Set(confirmedLinks.map((link) => link.planned_session_id as string))];
    const activityIds = [...new Set(confirmedLinks.map((link) => link.completed_activity_id as string))];
    const { data: sessions, error: sessionError } = await args.supabase
      .from("sessions")
      .select("id,execution_result")
      .eq("user_id", args.userId)
      .in("id", sessionIds);

    if (sessionError) throw new Error(sessionError.message);
    const { data: activities, error: activityError } = await args.supabase
      .from("completed_activities")
      .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
      .eq("user_id", args.userId)
      .in("id", activityIds);

    if (activityError) throw new Error(activityError.message);

    const sessionById = new Map(
      ((sessions ?? []) as Array<{ id: string; execution_result?: Record<string, unknown> | null }>)
        .map((session) => [session.id, session])
    );
    const activityById = new Map(
      ((activities ?? []) as SessionExecutionActivityRow[])
        .map((activity) => [activity.id, activity])
    );

    const selectionLog: Array<{
      sessionId: string;
      activityId: string;
      action: "selected" | "skipped";
      reason: string;
    }> = [];

    candidateLinks = confirmedLinks.filter((link) => {
      const session = sessionById.get(link.planned_session_id as string);
      const activity = activityById.get(link.completed_activity_id as string);
      const sessionId = link.planned_session_id as string;
      const activityId = link.completed_activity_id as string;

      if (!session) {
        selectionLog.push({ sessionId, activityId, action: "skipped", reason: "session_not_found" });
        return false;
      }

      if (!activity) {
        selectionLog.push({ sessionId, activityId, action: "skipped", reason: "activity_not_found" });
        return false;
      }

      if (!session.execution_result) {
        selectionLog.push({ sessionId, activityId, action: "selected", reason: "missing_execution_result" });
        return true;
      }

      const shouldRefresh = shouldRefreshExecutionResultFromActivity(session.execution_result, activity);
      selectionLog.push({
        sessionId,
        activityId,
        action: shouldRefresh ? "selected" : "skipped",
        reason: shouldRefresh ? "stale_execution_result" : "already_fresh"
      });
      return shouldRefresh;
    });

    console.info("[execution-review-backfill] Candidate selection complete", {
      selected: selectionLog.filter((entry) => entry.action === "selected").length,
      skipped: selectionLog.filter((entry) => entry.action === "skipped").length,
      sample: selectionLog.slice(0, 20)
    });
  }

  const dedupedLinks = [...new Map(candidateLinks.map((link) => [link.planned_session_id as string, link])).values()];
  const linksToProcess = typeof args.limit === "number" ? dedupedLinks.slice(0, args.limit) : dedupedLinks;

  console.info("[execution-review-backfill] Prepared batch", {
    candidateLinks: candidateLinks.length,
    dedupedLinks: dedupedLinks.length,
    processing: linksToProcess.length
  });

  let updated = 0;
  for (const link of linksToProcess) {
    const sessionId = link.planned_session_id as string;
    const activityId = link.completed_activity_id as string;
    console.info("[execution-review-backfill] Rebuilding execution review", {
      sessionId,
      activityId
    });

    try {
      await syncSessionExecutionFromActivityLink({
        supabase: args.supabase,
        userId: args.userId,
        sessionId,
        activityId
      });
      updated += 1;
      console.info("[execution-review-backfill] Rebuild complete", {
        sessionId,
        activityId
      });
    } catch (error) {
      console.warn("[execution-review-backfill] Rebuild failed", {
        sessionId,
        activityId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Skip failed sessions so one bad row does not block the rest of the batch.
    }
  }

  console.info("[execution-review-backfill] Backfill finished", {
    updated,
    attempted: linksToProcess.length
  });

  return {
    updated,
    attempted: linksToProcess.length
  };
}

export async function syncExtraActivityExecution(args: {
  supabase: SupabaseClient;
  userId: string;
  activityId: string;
}): Promise<PersistedExecutionReview> {
  const { data: activity, error: activityError } = await args.supabase
    .from("completed_activities")
    .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
    .eq("id", args.activityId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (activityError) throw new Error(activityError.message);
  if (!activity) throw new Error("Activity not found.");

  const syntheticSession: SessionExecutionSessionRow = {
    id: `activity:${activity.id}`,
    user_id: args.userId,
    sport: activity.sport_type,
    type: "Extra workout",
    duration_minutes: activity.duration_sec ? Math.round(activity.duration_sec / 60) : null,
    target: null,
    intent_category: "extra workout",
    session_name: "Extra workout",
    session_role: null,
    status: "completed"
  };

  const diagnosisInput = buildDiagnosisInput(syntheticSession, activity as SessionExecutionActivityRow);

  let athleteContext = null;
  try {
    athleteContext = await getAthleteContextSnapshot(args.supabase, args.userId);
  } catch {
    athleteContext = null;
  }

  const { evidence } = buildExecutionEvidence({
    athleteId: args.userId,
    sessionId: syntheticSession.id,
    sessionTitle: "Extra workout",
    sessionRole: null,
    diagnosisInput,
    weeklyState: athleteContext ? { fatigue: athleteContext.weeklyState.fatigue } : null
  });

  const generated = await generateCoachVerdict({ evidence, athleteContext, recentReviewedSessions: [] });
  const executionResult = toPersistedExecutionReview({
    linkedActivityId: activity.id,
    evidence,
    verdict: generated.verdict,
    narrativeSource: generated.source
  });

  const { error: saveError } = await args.supabase
    .from("completed_activities")
    .update({ execution_result: executionResult })
    .eq("id", activity.id)
    .eq("user_id", args.userId);

  if (saveError) throw new Error(saveError.message);

  return executionResult;
}
