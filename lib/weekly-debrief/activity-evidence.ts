import { asMetricsRecord, getMetricsV2HrZones, getMetricsV2PaceZones, getNestedNumber as getMetricsNestedNumber, getNestedString, getNestedValue } from "@/lib/workouts/metrics-v2";
import { buildExtraCompletedActivities } from "@/lib/activities/completed-activities";
import type { WeeklyDebriefActivity, WeeklyDebriefActivityEvidence } from "./types";
import { compactZoneEvidence, compactLapEvidence, compactMetricBlock } from "./format";

export function buildActivityEvidenceEntry(args: {
  activity: WeeklyDebriefActivity;
  label: string;
  context: "linked_session" | "extra_activity";
  sessionId?: string;
}) {
  const metrics = asMetricsRecord(args.activity.metrics_v2);
  const quality = asMetricsRecord(getNestedValue(metrics, ["quality"]));
  const qualityWarnings = Array.isArray(quality?.warnings)
    ? quality.warnings.filter((value): value is string => typeof value === "string")
    : [];
  const hrZones = compactZoneEvidence(getMetricsV2HrZones(args.activity.metrics_v2));
  const paceZones = compactZoneEvidence(getMetricsV2PaceZones(args.activity.metrics_v2));
  const laps = compactLapEvidence(args.activity);

  const base: WeeklyDebriefActivityEvidence = {
    context: args.context,
    label: args.label,
    sport: args.activity.sport_type,
    activityId: args.activity.id,
    sessionId: args.sessionId,
    summary: {
      durationSec: args.activity.duration_sec ?? null,
      distanceM: args.activity.distance_m ?? null,
      avgHr: args.activity.avg_hr ?? null,
      avgPower: args.activity.avg_power ?? null,
      qualityWarnings
    }
  };

  if (args.activity.sport_type === "run") {
    base.run = compactMetricBlock({
      pace: {
        avgPaceSecPerKm: getMetricsNestedNumber(metrics, [["pace", "avgPaceSecPerKm"], ["pace", "avg_pace_sec_per_km"]]),
        bestPaceSecPerKm: getMetricsNestedNumber(metrics, [["pace", "bestPaceSecPerKm"], ["pace", "best_pace_sec_per_km"]]),
        normalizedGradedPaceSecPerKm: getMetricsNestedNumber(metrics, [["pace", "normalizedGradedPaceSecPerKm"], ["pace", "normalized_graded_pace_sec_per_km"]])
      },
      heartRate: {
        avgHr: getMetricsNestedNumber(metrics, [["heartRate", "avgHr"], ["heart_rate", "avg_hr"]]) ?? args.activity.avg_hr ?? null,
        maxHr: getMetricsNestedNumber(metrics, [["heartRate", "maxHr"], ["heart_rate", "max_hr"]])
      },
      cadence: {
        avgCadence: getMetricsNestedNumber(metrics, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]]),
        maxCadence: getMetricsNestedNumber(metrics, [["cadence", "maxCadence"], ["cadence", "max_cadence"]])
      },
      elevation: {
        gainM: getMetricsNestedNumber(metrics, [["elevation", "gainM"], ["elevation", "gain_m"]]),
        lossM: getMetricsNestedNumber(metrics, [["elevation", "lossM"], ["elevation", "loss_m"]])
      },
      load: {
        trainingStressScore: getMetricsNestedNumber(metrics, [["load", "trainingStressScore"], ["load", "training_stress_score"]]),
        aerobicTrainingEffect: getMetricsNestedNumber(metrics, [["load", "aerobicTrainingEffect"], ["load", "aerobic_training_effect"]]),
        anaerobicTrainingEffect: getMetricsNestedNumber(metrics, [["load", "anaerobicTrainingEffect"], ["load", "anaerobic_training_effect"]])
      },
      splits: {
        firstHalfAvgHr: getMetricsNestedNumber(metrics, [["splits", "firstHalfAvgHr"], ["halves", "firstHalfAvgHr"]]),
        lastHalfAvgHr: getMetricsNestedNumber(metrics, [["splits", "lastHalfAvgHr"], ["halves", "lastHalfAvgHr"]]),
        hrDriftPct: getMetricsNestedNumber(metrics, [["splits", "hrDriftPct"], ["halves", "hrDriftPct"]]),
        firstHalfPaceSPerKm: getMetricsNestedNumber(metrics, [["splits", "firstHalfPaceSPerKm"], ["halves", "firstHalfPaceSPerKm"]]),
        lastHalfPaceSPerKm: getMetricsNestedNumber(metrics, [["splits", "lastHalfPaceSPerKm"], ["halves", "lastHalfPaceSPerKm"]]),
        paceFadePct: getMetricsNestedNumber(metrics, [["splits", "paceFadePct"], ["halves", "paceFadePct"]]),
        firstHalfAvgCadence: getMetricsNestedNumber(metrics, [["splits", "firstHalfAvgCadence"], ["halves", "firstHalfAvgCadence"]]),
        lastHalfAvgCadence: getMetricsNestedNumber(metrics, [["splits", "lastHalfAvgCadence"], ["halves", "lastHalfAvgCadence"]])
      },
      zones: {
        hr: hrZones.slice(0, 4),
        pace: paceZones.slice(0, 4)
      },
      laps
    });
  } else if (args.activity.sport_type === "swim") {
    base.swim = compactMetricBlock({
      pace: {
        avgPacePer100mSec: getMetricsNestedNumber(metrics, [["pace", "avgPacePer100mSec"], ["pace", "avg_pace_per_100m_sec"]]),
        bestPacePer100mSec: getMetricsNestedNumber(metrics, [["pace", "bestPacePer100mSec"], ["pace", "best_pace_per_100m_sec"]])
      },
      stroke: {
        avgStrokeRateSpm: getMetricsNestedNumber(metrics, [["stroke", "avgStrokeRateSpm"], ["stroke", "avg_stroke_rate_spm"]]),
        maxStrokeRateSpm: getMetricsNestedNumber(metrics, [["stroke", "maxStrokeRateSpm"], ["stroke", "max_stroke_rate_spm"]]),
        avgSwolf: getMetricsNestedNumber(metrics, [["stroke", "avgSwolf"], ["stroke", "avg_swolf"]]),
        strokeType: getNestedString(metrics, [["stroke", "strokeType"], ["stroke", "stroke_type"]])
      },
      load: {
        trainingEffect: getMetricsNestedNumber(metrics, [["load", "aerobicTrainingEffect"], ["load", "trainingEffect"], ["load", "training_effect"]])
      },
      pool: {
        poolLengthM: getMetricsNestedNumber(metrics, [["pool", "poolLengthM"], ["pool", "pool_length_m"]]),
        lengthCount: getMetricsNestedNumber(metrics, [["pool", "lengthCount"], ["pool", "length_count"]])
      },
      splits: {
        firstHalfPacePer100mSec: getMetricsNestedNumber(metrics, [["splits", "firstHalfPacePer100mSec"], ["halves", "firstHalfPacePer100mSec"]]),
        lastHalfPacePer100mSec: getMetricsNestedNumber(metrics, [["splits", "lastHalfPacePer100mSec"], ["halves", "lastHalfPacePer100mSec"]]),
        paceFadePct: getMetricsNestedNumber(metrics, [["splits", "paceFadePct"], ["halves", "paceFadePct"]]),
        firstHalfStrokeRate: getMetricsNestedNumber(metrics, [["splits", "firstHalfStrokeRate"], ["halves", "firstHalfStrokeRate"]]),
        lastHalfStrokeRate: getMetricsNestedNumber(metrics, [["splits", "lastHalfStrokeRate"], ["halves", "lastHalfStrokeRate"]])
      },
      zones: {
        pace: paceZones.slice(0, 4)
      },
      laps
    });
  } else if (args.activity.sport_type === "bike") {
    base.bike = compactMetricBlock({
      power: {
        normalizedPower: getMetricsNestedNumber(metrics, [["power", "normalizedPower"], ["power", "normalized_power"]]),
        intensityFactor: getMetricsNestedNumber(metrics, [["power", "intensityFactor"], ["power", "intensity_factor"]]),
        variabilityIndex: getMetricsNestedNumber(metrics, [["power", "variabilityIndex"], ["power", "variability_index"]])
      },
      load: {
        trainingStressScore: getMetricsNestedNumber(metrics, [["load", "trainingStressScore"], ["load", "training_stress_score"]])
      },
      cadence: {
        avgCadence: getMetricsNestedNumber(metrics, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]])
      },
      zones: {
        hr: hrZones.slice(0, 4)
      },
      laps
    });
  } else {
    base.other = compactMetricBlock({
      activityType: getNestedString(metrics, [["activity", "normalizedType"], ["activity", "normalized_type"]]),
      load: {
        trainingStressScore: getMetricsNestedNumber(metrics, [["load", "trainingStressScore"], ["load", "training_stress_score"]])
      },
      laps
    });
  }

  return base;
}

export function describeExtraActivityLoad(activity: ReturnType<typeof buildExtraCompletedActivities>[number]) {
  const parts: string[] = [];
  if (activity.trainingStressScore !== null) parts.push(`${Math.round(activity.trainingStressScore)} TSS`);
  if (activity.intensityFactor !== null) parts.push(`IF ${activity.intensityFactor.toFixed(2)}`);
  if (activity.normalizedPower !== null) parts.push(`NP ${Math.round(activity.normalizedPower)} w`);
  if (activity.sport === "run" && activity.hrDriftPct !== null) parts.push(`HR drift ${Math.round(activity.hrDriftPct * 100)}%`);
  if (activity.sport === "run" && activity.elevationGainM !== null) parts.push(`${Math.round(activity.elevationGainM)} m climb`);
  if (activity.sport === "swim" && activity.avgPacePer100mSec !== null) {
    const rounded = Math.round(activity.avgPacePer100mSec);
    parts.push(`pace ${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}/100m`);
  }
  if (activity.sport === "swim" && activity.avgStrokeRateSpm !== null) parts.push(`${Math.round(activity.avgStrokeRateSpm)} spm`);
  if (activity.sport === "swim" && activity.avgSwolf !== null) parts.push(`SWOLF ${Math.round(activity.avgSwolf)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function getHardestExtraActivity(extraActivities: ReturnType<typeof buildExtraCompletedActivities>) {
  return [...extraActivities].sort((a, b) => {
    const scoreA = (a.trainingStressScore ?? 0) + (a.hrDriftPct ?? 0) * 100 + (a.paceFadePct ?? 0) * 100 + a.durationMinutes;
    const scoreB = (b.trainingStressScore ?? 0) + (b.hrDriftPct ?? 0) * 100 + (b.paceFadePct ?? 0) * 100 + b.durationMinutes;
    return scoreB - scoreA;
  })[0] ?? null;
}
