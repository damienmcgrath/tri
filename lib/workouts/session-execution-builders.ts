import type { SessionDiagnosis, SessionDiagnosisInput } from "@/lib/coach/session-diagnosis";
import { buildExecutionEvidence, toPersistedExecutionReview } from "@/lib/execution-review";
import { getMetricsV2Laps, getNestedNumber as getMetricsNestedNumber } from "@/lib/workouts/metrics-v2";
import {
  asExecutionResult,
  asRecord,
  getNestedNumber,
  getNumber,
  sumZoneDurations,
  type PersistedExecutionResult,
  type SessionExecutionActivityRow,
  type SessionExecutionSessionRow
} from "./session-execution-helpers";
import {
  deriveAvgPaceSecPerKm,
  deriveCompletedIntervals,
  deriveTimeAboveTargetPct,
  deriveWorkIntervalAvgPower,
  extractSplitMetrics
} from "./session-execution-metrics";
import { parsePlannedIntervals, parseTargetBands } from "./session-execution-targets";

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

    // Cadence halves were added after the original split-metric fields. Legacy
    // results may already carry HR/pace halves but lack cadence halves, which
    // means the aggregate check above would short-circuit and the prompt
    // context would never get the new signal. Trigger a refresh when the
    // activity has cadence halves but the stored result does not.
    const extended = splitMetrics as Record<string, number>;
    const activityHasCadenceHalves =
      typeof extended.firstHalfAvgCadence === "number" &&
      typeof extended.lastHalfAvgCadence === "number";
    if (activityHasCadenceHalves) {
      const resultHasCadenceHalves =
        getNumber(current, ["firstHalfAvgCadence", "first_half_avg_cadence"]) !== null &&
        getNumber(current, ["lastHalfAvgCadence", "last_half_avg_cadence"]) !== null;
      if (!resultHasCadenceHalves) return true;
    }
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

export function buildDiagnosisInput(session: SessionExecutionSessionRow, activity: SessionExecutionActivityRow): SessionDiagnosisInput {
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
    componentScores: diagnosis.componentScores,
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
      nonObviousInsight:
        "Not enough comparative history or extended signals in this preview path to surface a cross-session finding.",
      teach: null,
      comparableReference: null,
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
