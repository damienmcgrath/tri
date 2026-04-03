import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildExtraCompletedActivities, hasConfirmedPlannedSessionLink, loadCompletedActivities, localIsoDate } from "@/lib/activities/completed-activities";
import { getAthleteContextSnapshot, type AthleteContextSnapshot } from "@/lib/athlete-context";
import { parsePersistedExecutionReview, type PersistedExecutionReview } from "@/lib/execution-review";
import { getCoachModel, getCoachRequestTimeoutMs, getOpenAIClient, extractJsonObject, clip } from "@/lib/openai";
import { getSessionDisplayName } from "@/lib/training/session";
import { buildExecutionResultForSession, shouldRefreshExecutionResultFromActivity } from "@/lib/workouts/session-execution";
import { asMetricsRecord, getMetricsV2Laps, getMetricsV2PaceZones, getMetricsV2HrZones, getNestedNumber as getMetricsNestedNumber, getNestedString, getNestedValue } from "@/lib/workouts/metrics-v2";
import { addDays, weekRangeLabel } from "@/lib/date-utils";

export const WEEKLY_DEBRIEF_GENERATION_VERSION = 6;

/** @deprecated Use clip() from lib/openai.ts — this alias exists only for schema transform compatibility. */
const truncateStr = clip;

const weeklyDebriefEvidenceItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).transform((s) => truncateStr(s, 160)),
  detail: z.string().min(1).transform((s) => truncateStr(s, 280)),
  kind: z.enum(["session", "activity"]),
  href: z.string().min(1),
  supportType: z.enum(["fact", "observation", "carry_forward"])
});

export type WeeklyDebriefEvidenceItem = z.infer<typeof weeklyDebriefEvidenceItemSchema>;

const weeklyDebriefEvidenceGroupSchema = z.object({
  claim: z.string().min(1).transform((s) => truncateStr(s, 160)),
  detail: z.string().min(1).transform((s) => truncateStr(s, 280)),
  supports: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1).transform((s) => truncateStr(s, 160)),
    href: z.string().min(1),
    kind: z.enum(["session", "activity"]),
    reason: z.string().min(1).transform((s) => truncateStr(s, 200))
  })).min(1).max(5)
});

export type WeeklyDebriefEvidenceGroup = z.infer<typeof weeklyDebriefEvidenceGroupSchema>;

const weeklyDebriefFactsSchema = z.object({
  weekLabel: z.string().min(1),
  weekRange: z.string().min(1),
  title: z.string().min(1).max(120),
  statusLine: z.string().min(1).max(160),
  primaryTakeawayTitle: z.string().min(1).max(120),
  primaryTakeawayDetail: z.string().min(1).max(240),
  plannedSessions: z.number().int().min(0),
  completedPlannedSessions: z.number().int().min(0).default(0),
  completedSessions: z.number().int().min(0),
  addedSessions: z.number().int().min(0).default(0),
  skippedSessions: z.number().int().min(0),
  remainingSessions: z.number().int().min(0),
  keySessionsCompleted: z.number().int().min(0),
  keySessionsMissed: z.number().int().min(0).default(0),
  keySessionsTotal: z.number().int().min(0),
  plannedMinutes: z.number().int().min(0),
  completedPlannedMinutes: z.number().int().min(0).default(0),
  completedMinutes: z.number().int().min(0),
  skippedMinutes: z.number().int().min(0),
  extraMinutes: z.number().int().min(0),
  completionPct: z.number().int().min(0).max(999),
  dominantSport: z.string().min(1),
  keySessionStatus: z.string().min(1).max(160),
  metrics: z.array(z.object({
    label: z.string().min(1).max(60),
    value: z.string().min(1).max(80),
    detail: z.string().min(1).max(100).nullable().optional().default(null),
    tone: z.enum(["neutral", "positive", "muted", "caution"])
  })).min(3).max(6),
  factualBullets: z.array(z.string().min(1).max(160)).min(2).max(4),
  confidenceNote: z.string().min(1).max(220).nullable(),
  narrativeSource: z.enum(["ai", "fallback", "legacy_unknown"]).default("legacy_unknown"),
  artifactStateLabel: z.enum(["final", "provisional"]).default("provisional"),
  artifactStateNote: z.string().min(1).max(200).nullable().default(null),
  provisionalReviewCount: z.number().int().min(0).default(0),
  weekShape: z.enum(["normal", "partial_reflection", "disrupted"]),
  reflectionsSparse: z.boolean()
});

export type WeeklyDebriefFacts = z.infer<typeof weeklyDebriefFactsSchema>;

const weeklyDebriefNarrativeSchema = z.object({
  executiveSummary: z.string().min(1).max(420),
  highlights: z.array(z.string().min(1).max(220)).min(3).max(3),
  observations: z.array(z.string().min(1).max(220)).min(1).max(3),
  carryForward: z.array(z.string().min(1).max(280)).min(2).max(2)
});

export type WeeklyDebriefNarrative = z.infer<typeof weeklyDebriefNarrativeSchema>;

const weeklyDebriefCoachShareSchema = z.object({
  headline: z.string().min(1).max(120),
  summary: z.string().min(1).max(320),
  wins: z.array(z.string().min(1).max(180)).min(1).max(3),
  concerns: z.array(z.string().min(1).max(180)).min(1).max(3),
  carryForward: z.array(z.string().min(1).max(280)).min(2).max(2)
});

export type WeeklyDebriefCoachShare = z.infer<typeof weeklyDebriefCoachShareSchema>;

const weeklyDebriefArtifactSchema = z.object({
  weekStart: z.string().date(),
  weekEnd: z.string().date(),
  status: z.enum(["ready", "stale", "failed"]),
  sourceUpdatedAt: z.string().datetime(),
  generatedAt: z.string().datetime(),
  generationVersion: z.number().int().positive(),
  facts: weeklyDebriefFactsSchema,
  narrative: weeklyDebriefNarrativeSchema,
  coachShare: weeklyDebriefCoachShareSchema,
  evidence: z.array(weeklyDebriefEvidenceItemSchema).max(24),
  evidenceGroups: z.array(weeklyDebriefEvidenceGroupSchema).max(6),
  feedback: z.object({
    helpful: z.boolean().nullable(),
    accurate: z.boolean().nullable(),
    note: z.string().nullable(),
    updatedAt: z.string().datetime().nullable()
  })
});

export type WeeklyDebriefArtifact = z.infer<typeof weeklyDebriefArtifactSchema>;

const weeklyDebriefReadinessSchema = z.object({
  isReady: z.boolean(),
  reason: z.string().min(1).max(220),
  unlockedBy: z.enum(["end_of_week", "effective_completion", "insufficient_signal"]),
  resolvedKeySessions: z.number().int().min(0),
  totalKeySessions: z.number().int().min(0),
  resolvedMinutes: z.number().int().min(0),
  plannedMinutes: z.number().int().min(0)
});

export type WeeklyDebriefReadiness = z.infer<typeof weeklyDebriefReadinessSchema>;

type WeeklyDebriefSession = {
  id: string;
  athlete_id?: string | null;
  user_id?: string | null;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  intent_category?: string | null;
  session_role?: "key" | "supporting" | "recovery" | "optional" | null;
  notes: string | null;
  status: "planned" | "completed" | "skipped";
  duration_minutes: number | null;
  updated_at: string | null;
  created_at: string;
  execution_result?: Record<string, unknown> | null;
  is_key?: boolean | null;
};

type WeeklyDebriefActivity = {
  id: string;
  upload_id: string | null;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  schedule_status: "scheduled" | "unscheduled";
  is_unplanned: boolean;
  metrics_v2?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

type WeeklyDebriefLink = {
  completed_activity_id: string;
  planned_session_id?: string | null;
  confirmation_status?: "suggested" | "confirmed" | "rejected" | null;
  created_at?: string | null;
};

type WeeklyDebriefCheckIn = {
  fatigueScore: number | null;
  stressScore: number | null;
  motivationScore: number | null;
  weekNotes: string | null;
};

type WeeklyDebriefInputs = {
  sessions: WeeklyDebriefSession[];
  activities: WeeklyDebriefActivity[];
  links: WeeklyDebriefLink[];
  athleteContext: AthleteContextSnapshot | null;
  checkIn: WeeklyDebriefCheckIn | null;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  todayIso: string;
};

type WeeklyDebriefSourceInputs = {
  sessions: Array<Pick<WeeklyDebriefSession, "id" | "date" | "sport" | "notes" | "status" | "duration_minutes" | "updated_at" | "created_at" | "is_key" | "session_role">>;
  activities: WeeklyDebriefActivity[];
  links: WeeklyDebriefLink[];
  weeklyCheckinUpdatedAt: string | null;
  timeZone: string;
  weekStart: string;
  weekEnd: string;
  todayIso: string;
};

type WeeklyDebriefSourceState = {
  readiness: WeeklyDebriefReadiness;
  sourceUpdatedAt: string;
};

type WeeklyDebriefSessionSummary = {
  id: string;
  label: string;
  date: string;
  sport: string;
  durationMinutes: number;
  status: "completed" | "planned" | "skipped";
  isKey: boolean;
  review: PersistedExecutionReview | null;
  completedMinutes: number;
};

type WeeklyDebriefComputed = {
  readiness: WeeklyDebriefReadiness;
  facts: WeeklyDebriefFacts;
  narrative: WeeklyDebriefNarrative;
  coachShare: WeeklyDebriefCoachShare;
  evidence: WeeklyDebriefEvidenceItem[];
  evidenceGroups: WeeklyDebriefEvidenceGroup[];
  sourceUpdatedAt: string;
};

type WeeklyDebriefActivityEvidence = {
  context: "linked_session" | "extra_activity";
  label: string;
  sport: string;
  activityId: string;
  sessionId?: string;
  summary: {
    durationSec: number | null;
    distanceM: number | null;
    avgHr: number | null;
    avgPower: number | null;
    qualityWarnings: string[];
  };
  run?: Record<string, unknown>;
  swim?: Record<string, unknown>;
  bike?: Record<string, unknown>;
  other?: Record<string, unknown>;
};

type WeeklyDebriefRecord = {
  week_start: string;
  week_end: string;
  status: "ready" | "stale" | "failed";
  source_updated_at: string;
  generated_at: string;
  generation_version: number;
  facts: unknown;
  narrative: unknown;
  coach_share: unknown;
  helpful: boolean | null;
  accurate: boolean | null;
  feedback_note: string | null;
  feedback_updated_at: string | null;
};

export type WeeklyDebriefSnapshot =
  | {
      readiness: WeeklyDebriefReadiness;
      artifact: WeeklyDebriefArtifact | null;
      stale: boolean;
      sourceUpdatedAt: string;
      weekStart: string;
      weekEnd: string;
    }
  | {
      readiness: WeeklyDebriefReadiness;
      artifact: null;
      stale: false;
      sourceUpdatedAt: string;
      weekStart: string;
      weekEnd: string;
    };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMinutes(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function compactZoneEvidence(zones: ReturnType<typeof getMetricsV2HrZones | typeof getMetricsV2PaceZones>) {
  return zones
    .filter((zone) => zone.durationSec > 0)
    .map((zone) => ({
      zone: zone.zone,
      durationSec: zone.durationSec,
      pctOfSession: zone.pctOfSession,
      heartRateMin: zone.heartRateMin ?? null,
      heartRateMax: zone.heartRateMax ?? null,
      paceMin: zone.paceMin ?? null,
      paceMax: zone.paceMax ?? null
    }))
    .slice(0, 6);
}

function toCompactLap(lap: ReturnType<typeof getMetricsV2Laps>[number]) {
  return {
    index: lap.index,
    durationSec: lap.durationSec,
    distanceM: lap.distanceM,
    avgHr: lap.avgHr,
    avgCadence: lap.avgCadence,
    avgPaceSecPerKm: lap.avgPaceSecPerKm ?? null,
    avgPacePer100mSec: lap.avgPacePer100mSec ?? null,
    avgStrokeRateSpm: lap.avgStrokeRateSpm ?? null,
    avgSwolf: lap.avgSwolf ?? null,
    restSec: lap.restSec ?? null,
    elevationGainM: lap.elevationGainM ?? null,
    elevationLossM: lap.elevationLossM ?? null,
    trigger: lap.trigger,
    isRest: lap.isRest ?? null
  };
}

function compactRunLapEvidence(activity: WeeklyDebriefActivity) {
  const laps = getMetricsV2Laps(activity.metrics_v2);
  const sorted = [...laps].sort((a, b) => {
    const distanceDelta = (b.distanceM ?? 0) - (a.distanceM ?? 0);
    if (distanceDelta !== 0) return distanceDelta;
    return (b.durationSec ?? 0) - (a.durationSec ?? 0);
  });
  const selected = [
    sorted[0],
    sorted[Math.max(0, Math.floor(sorted.length / 2) - 1)],
    sorted[sorted.length - 1]
  ].filter((lap, index, all): lap is NonNullable<typeof lap> => Boolean(lap) && all.indexOf(lap) === index);
  return selected.map(toCompactLap).slice(0, 4);
}

function compactSwimLapEvidence(activity: WeeklyDebriefActivity) {
  const laps = getMetricsV2Laps(activity.metrics_v2);
  const workLaps = laps.filter((lap) => (lap.distanceM ?? 0) > 0);
  const restLaps = laps.filter((lap) => lap.isRest === true || (lap.restSec ?? 0) > 0);
  const selected = [
    ...workLaps.slice(0, 4),
    ...restLaps.slice(0, 2)
  ].filter((lap, index, all) => all.indexOf(lap) === index);
  return selected.map(toCompactLap).slice(0, 6);
}

function compactBikeLapEvidence(activity: WeeklyDebriefActivity) {
  return getMetricsV2Laps(activity.metrics_v2)
    .slice(0, 4)
    .map(toCompactLap);
}

function compactGenericLapEvidence(activity: WeeklyDebriefActivity) {
  return getMetricsV2Laps(activity.metrics_v2)
    .slice(0, 4)
    .map(toCompactLap);
}

function compactLapEvidence(activity: WeeklyDebriefActivity) {
  if (activity.sport_type === "run") return compactRunLapEvidence(activity);
  if (activity.sport_type === "swim") return compactSwimLapEvidence(activity);
  if (activity.sport_type === "bike") return compactBikeLapEvidence(activity);
  return compactGenericLapEvidence(activity);
}

function trimNullishEntries<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (entry === null || typeof entry === "undefined") return [];
      if (Array.isArray(entry)) return entry.length > 0 ? [[key, entry]] : [];
      if (typeof entry === "object") {
        const cleaned = trimNullishEntries(entry as Record<string, unknown>);
        return Object.keys(cleaned).length > 0 ? [[key, cleaned]] : [];
      }
      return [[key, entry]];
    })
  );
}

function compactMetricBlock<T extends Record<string, unknown>>(value: T) {
  return trimNullishEntries(value);
}

function buildActivityEvidenceEntry(args: {
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

function describeExtraActivityLoad(activity: ReturnType<typeof buildExtraCompletedActivities>[number]) {
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

function getHardestExtraActivity(extraActivities: ReturnType<typeof buildExtraCompletedActivities>) {
  return [...extraActivities].sort((a, b) => {
    const scoreA = (a.trainingStressScore ?? 0) + (a.hrDriftPct ?? 0) * 100 + (a.paceFadePct ?? 0) * 100 + a.durationMinutes;
    const scoreB = (b.trainingStressScore ?? 0) + (b.hrDriftPct ?? 0) * 100 + (b.paceFadePct ?? 0) * 100 + b.durationMinutes;
    return scoreB - scoreA;
  })[0] ?? null;
}

function isSkippedByTag(notes: string | null | undefined) {
  return /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(notes ?? "");
}

function inferSessionStatus(session: WeeklyDebriefSession, completionLedger: Record<string, number>) {
  if (session.status === "completed" || session.status === "skipped") {
    return session.status;
  }

  if (isSkippedByTag(session.notes)) {
    return "skipped" as const;
  }

  const key = `${session.date}:${session.sport}`;
  const count = completionLedger[key] ?? 0;
  if (count > 0) {
    completionLedger[key] = count - 1;
    return "completed" as const;
  }

  return "planned" as const;
}

function getConfidenceNote(inputs: WeeklyDebriefInputs) {
  return null;
}

function buildArtifactState(args: { provisionalReviewCount: number }) {
  if (args.provisionalReviewCount > 0) {
    return {
      label: "provisional" as const,
      note: "This debrief is provisional and may update before the week is final."
    };
  }

  return {
    label: "final" as const,
    note: null
  };
}

export function computeWeeklyDebriefReadiness(args: {
  todayIso: string;
  weekStart: string;
  weekEnd: string;
  plannedMinutes: number;
  resolvedMinutes: number;
  totalKeySessions: number;
  resolvedKeySessions: number;
}) {
  const isEndOfWeek = args.todayIso >= args.weekEnd;
  const hasAnyContent = args.plannedMinutes > 0 || args.resolvedMinutes > 0;
  const effectiveCompletionReady =
    args.plannedMinutes > 0 &&
    args.resolvedMinutes >= Math.round(args.plannedMinutes * 0.7) &&
    args.totalKeySessions === args.resolvedKeySessions;

  if (!hasAnyContent) {
    return weeklyDebriefReadinessSchema.parse({
      isReady: false,
      reason: "No planned or completed sessions this week — nothing to debrief yet.",
      unlockedBy: "insufficient_signal",
      resolvedKeySessions: args.resolvedKeySessions,
      totalKeySessions: args.totalKeySessions,
      resolvedMinutes: args.resolvedMinutes,
      plannedMinutes: args.plannedMinutes
    });
  }

  if (isEndOfWeek) {
    return weeklyDebriefReadinessSchema.parse({
      isReady: true,
      reason: "The training week has ended, so the debrief is ready to review.",
      unlockedBy: "end_of_week",
      resolvedKeySessions: args.resolvedKeySessions,
      totalKeySessions: args.totalKeySessions,
      resolvedMinutes: args.resolvedMinutes,
      plannedMinutes: args.plannedMinutes
    });
  }

  if (effectiveCompletionReady) {
    return weeklyDebriefReadinessSchema.parse({
      isReady: true,
      reason: "Enough of the week is resolved to make the debrief meaningful.",
      unlockedBy: "effective_completion",
      resolvedKeySessions: args.resolvedKeySessions,
      totalKeySessions: args.totalKeySessions,
      resolvedMinutes: args.resolvedMinutes,
      plannedMinutes: args.plannedMinutes
    });
  }

  return weeklyDebriefReadinessSchema.parse({
    isReady: false,
    reason:
      args.totalKeySessions > args.resolvedKeySessions
        ? "Not enough signal yet. Finish or explicitly resolve the remaining key session before we summarize the week."
        : "Not enough signal yet. The debrief unlocks once more of the planned week is completed or explicitly skipped.",
    unlockedBy: "insufficient_signal",
    resolvedKeySessions: args.resolvedKeySessions,
    totalKeySessions: args.totalKeySessions,
    resolvedMinutes: args.resolvedMinutes,
    plannedMinutes: args.plannedMinutes
  });
}

export function classifyWeeklyDebriefWeekShape(args: {
  plannedSessions: number;
  completedSessions: number;
  skippedSessions: number;
  reflectionsSparse: boolean;
  completionPct: number;
}) {
  if (args.skippedSessions >= Math.max(2, Math.ceil(args.plannedSessions * 0.3)) || args.completionPct < 65) {
    return "disrupted" as const;
  }

  if (args.reflectionsSparse) {
    return "partial_reflection" as const;
  }

  return "normal" as const;
}

function buildDeterministicNarrative(args: {
  facts: WeeklyDebriefFacts;
  topHighlights: string[];
  observations: string[];
  carryForward: string[];
}) {
  const highlights = [
    ...args.topHighlights,
    args.facts.keySessionsTotal > 0 && args.facts.keySessionsCompleted === args.facts.keySessionsTotal
      ? "The priority sessions set the tone for the week rather than forcing catch-up later."
      : null,
    args.facts.skippedSessions <= 1
      ? "The broader week kept its shape instead of unraveling across multiple sessions."
      : null,
    args.facts.addedSessions > 0 && args.facts.skippedSessions === 0
      ? "Added work stayed additive rather than replacing the planned structure."
      : null,
    args.facts.weekShape === "disrupted"
      ? "Even with some disruption, the week still showed what held and where it loosened."
      : "The stronger sessions are worth repeating next week."
  ].filter((value, index, all) => value && all.indexOf(value) === index).slice(0, 3);

  return weeklyDebriefNarrativeSchema.parse({
    executiveSummary:
      args.facts.weekShape === "partial_reflection" && args.facts.confidenceNote
        ? `${args.facts.primaryTakeawayDetail} ${args.facts.confidenceNote}`
        : args.facts.primaryTakeawayDetail,
    highlights,
    observations: args.observations.slice(0, Math.max(1, Math.min(3, args.observations.length))),
    carryForward: args.carryForward.slice(0, 2)
  });
}

function buildCoachShare(args: { facts: WeeklyDebriefFacts; narrative: WeeklyDebriefNarrative }) {
  const clip = (value: string, max: number) => value.trim().slice(0, max);
  return weeklyDebriefCoachShareSchema.parse({
    headline: clip(args.facts.title, 120),
    summary: clip(args.narrative.executiveSummary, 320),
    wins: args.narrative.highlights.slice(0, 3).map((item) => clip(item, 180)),
    concerns: args.narrative.observations.slice(0, 3).map((item) => clip(item, 180)),
    carryForward: args.narrative.carryForward.slice(0, 2).map((item) => clip(item, 280))
  });
}

// extractJsonObject is now imported from @/lib/openai

function coerceNarrativeString(value: unknown, maxLength: number) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const candidate =
      (typeof record.text === "string" && record.text) ||
      (typeof record.summary === "string" && record.summary) ||
      (typeof record.detail === "string" && record.detail) ||
      (typeof record.observation === "string" && record.observation) ||
      (typeof record.highlight === "string" && record.highlight) ||
      (typeof record.title === "string" && record.title) ||
      (typeof record.label === "string" && record.label) ||
      (typeof record.claim === "string" && record.claim) ||
      null;

    if (candidate) {
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
    }
  }

  return null;
}

function coerceNarrativeList(value: unknown, maxItems: number, maxItemLength: number) {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((entry) => coerceNarrativeString(entry, maxItemLength))
    .filter((entry): entry is string => Boolean(entry));

  return items.slice(0, maxItems);
}

function normalizeNarrativePayload(payload: unknown) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};

  return {
    executiveSummary: coerceNarrativeString(record.executiveSummary, 420),
    highlights: coerceNarrativeList(record.highlights, 3, 220),
    observations: coerceNarrativeList(record.observations, 3, 220),
    carryForward: coerceNarrativeList(record.carryForward, 2, 280)
  };
}

function hydrateNarrativePayload(
  normalized: ReturnType<typeof normalizeNarrativePayload>,
  fallback: WeeklyDebriefNarrative
) {
  return {
    executiveSummary: normalized.executiveSummary ?? fallback.executiveSummary,
    highlights: normalized.highlights.length > 0 ? normalized.highlights : fallback.highlights.slice(0, 3),
    observations: normalized.observations.length > 0 ? normalized.observations : fallback.observations.slice(0, 3),
    carryForward: normalized.carryForward.length > 0 ? normalized.carryForward : fallback.carryForward.slice(0, 2)
  };
}

async function generateNarrative(args: {
  facts: WeeklyDebriefFacts;
  evidence: WeeklyDebriefEvidenceItem[];
  activityEvidence: WeeklyDebriefActivityEvidence[];
  athleteContext: AthleteContextSnapshot | null;
  checkIn: WeeklyDebriefCheckIn | null;
  deterministicFallback: WeeklyDebriefNarrative;
  recentFeedback?: Array<{ weekStart: string; helpful: boolean | null; accurate: boolean | null; note: string | null }>;
}) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      narrative: args.deterministicFallback,
      source: "fallback" as const
    };
  }

  try {
    const client = getOpenAIClient();

    // Build calibration note from recent feedback
    let calibrationNote = "";
    if (args.recentFeedback && args.recentFeedback.length > 0) {
      const inaccurateCount = args.recentFeedback.filter((f) => f.accurate === false).length;
      const unhelpfulCount = args.recentFeedback.filter((f) => f.helpful === false).length;
      const notes = args.recentFeedback.filter((f) => f.note).map((f) => f.note);
      if (inaccurateCount > 0 || unhelpfulCount > 0) {
        calibrationNote = ` CALIBRATION: The athlete rated ${inaccurateCount} of the last ${args.recentFeedback.length} debriefs as inaccurate and ${unhelpfulCount} as unhelpful. Be more conservative in claims and stick closer to the data.`;
        if (notes.length > 0) {
          calibrationNote += ` Athlete notes: ${notes.slice(0, 2).join("; ")}.`;
        }
      }
    }

    const timeoutMs = getCoachRequestTimeoutMs();
    const response = await client.responses.create(
      {
        model: getCoachModel(),
        instructions:
          "You write Weekly Debrief copy for endurance athletes. Use only the provided facts and evidence. Be calm, precise, coach-like, and proportionate to evidence. Read the sport-specific activityEvidence closely: for runs, prioritize splits, HR drift, pace fade, elevation, and zone context over lap-by-lap narration; for swims, prioritize rep structure, rest, pool context, stroke metrics, and second-half fade over generic summary; for rides, prioritize power, load, cadence, and execution control. Distinguish facts, observations, and carry-forward suggestions. Avoid hype, diagnosis, and certainty beyond the data. carryForward items must be complete, self-contained sentences — do not end mid-thought. Each carryForward item has a 280-character limit; use the full space when needed but always end with a complete sentence. Return valid JSON only with executiveSummary, highlights, observations, carryForward." + calibrationNote,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  facts: args.facts,
                  evidence: args.evidence,
                  activityEvidence: args.activityEvidence,
                  athleteContext: args.athleteContext ? {
                    weeklyState: args.athleteContext.weeklyState,
                    declared: {
                      weeklyConstraints: args.athleteContext.declared.weeklyConstraints,
                      limiters: args.athleteContext.declared.limiters.slice(0, 3).map((limiter) => limiter.value)
                    }
                  } : null,
                  checkIn: args.checkIn ? {
                    fatigue: args.checkIn.fatigueScore,
                    stress: args.checkIn.stressScore,
                    motivation: args.checkIn.motivationScore,
                    notes: args.checkIn.weekNotes
                  } : null,
                  recentFeedback: args.recentFeedback ?? null,
                })
              }
            ]
          }
        ]
      },
      { timeout: timeoutMs }
    );
    const text = response.output_text?.trim();
    if (!text) {
      console.warn("[weekly-debrief] Falling back to deterministic narrative: empty model output");
      return {
        narrative: args.deterministicFallback,
        source: "fallback" as const
      };
    }
    const payload = extractJsonObject(text);
    if (!payload) {
      console.warn("[weekly-debrief] Falling back to deterministic narrative: could not parse model output as JSON");
      return {
        narrative: args.deterministicFallback,
        source: "fallback" as const
      };
    }
    const parsed = weeklyDebriefNarrativeSchema.safeParse(
      hydrateNarrativePayload(normalizeNarrativePayload(payload), args.deterministicFallback)
    );
    if (!parsed.success) {
      console.warn("[weekly-debrief] Falling back to deterministic narrative: model JSON failed schema validation", parsed.error.flatten());
      return {
        narrative: args.deterministicFallback,
        source: "fallback" as const
      };
    }
    return {
      narrative: parsed.data,
      source: "ai" as const
    };
  } catch (error) {
    console.warn("[weekly-debrief] Falling back to deterministic narrative: model request failed", error);
    return {
      narrative: args.deterministicFallback,
      source: "fallback" as const
    };
  }
}

function getSourceUpdatedAt(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => a.localeCompare(b))
    .at(-1) ?? new Date().toISOString();
}

function normalizeTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString();
}

function normalizePersistedFacts(rawFacts: unknown): Record<string, unknown> {
  const facts = (rawFacts && typeof rawFacts === "object" ? rawFacts : {}) as Record<string, unknown>;
  const legacyStateLabel = facts.artifactStateLabel;
  const keySessionStatus = typeof facts.keySessionStatus === "string" ? facts.keySessionStatus : "";
  const statusLine = typeof facts.statusLine === "string" ? facts.statusLine : "";
  const factualBullets = Array.isArray(facts.factualBullets) ? facts.factualBullets.filter((value): value is string => typeof value === "string") : [];

  return {
    ...facts,
    primaryTakeawayTitle:
      typeof facts.primaryTakeawayTitle === "string" && facts.primaryTakeawayTitle.trim().length > 0
        ? facts.primaryTakeawayTitle
        : keySessionStatus || "What defined the week",
    primaryTakeawayDetail:
      typeof facts.primaryTakeawayDetail === "string" && facts.primaryTakeawayDetail.trim().length > 0
        ? facts.primaryTakeawayDetail
        : statusLine || factualBullets[0] || "This debrief was saved before the latest Weekly Debrief format.",
    artifactStateLabel: legacyStateLabel === "saved" ? "final" : legacyStateLabel
  };
}

function normalizePersistedArtifact(record: WeeklyDebriefRecord, effectiveStatus: "ready" | "stale" | "failed") {
  const normalizedFacts = normalizePersistedFacts(record.facts);

  const artifact = weeklyDebriefArtifactSchema.parse({
    weekStart: record.week_start,
    weekEnd: record.week_end,
    status: effectiveStatus,
    sourceUpdatedAt: normalizeTimestamp(record.source_updated_at),
    generatedAt: normalizeTimestamp(record.generated_at),
    generationVersion: record.generation_version,
    facts: normalizedFacts,
    narrative: record.narrative,
    coachShare: record.coach_share,
    evidence: Array.isArray((normalizedFacts as { evidence?: unknown })?.evidence) ? (normalizedFacts as { evidence: WeeklyDebriefEvidenceItem[] }).evidence : [],
    evidenceGroups: Array.isArray((normalizedFacts as { evidenceGroups?: unknown })?.evidenceGroups) ? (normalizedFacts as { evidenceGroups: WeeklyDebriefEvidenceGroup[] }).evidenceGroups : [],
    feedback: {
      helpful: record.helpful ?? null,
      accurate: record.accurate ?? null,
      note: record.feedback_note ?? null,
      updatedAt: normalizeTimestamp(record.feedback_updated_at)
    }
  });

  return {
    ...artifact,
    evidence: Array.isArray((normalizedFacts as { evidence?: unknown })?.evidence) ? weeklyDebriefEvidenceItemSchema.array().parse((normalizedFacts as { evidence: unknown }).evidence) : [],
    evidenceGroups: Array.isArray((normalizedFacts as { evidenceGroups?: unknown })?.evidenceGroups) ? weeklyDebriefEvidenceGroupSchema.array().parse((normalizedFacts as { evidenceGroups: unknown }).evidenceGroups) : []
  };
}

function buildWeekTitle(args: {
  completedPlannedSessions: number;
  plannedSessions: number;
  keySessionsLanded: number;
  keySessionsMissed: number;
  keySessionsTotal: number;
  skippedSessions: number;
  addedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  latestIssueLabel: string | null;
}) {
  if (args.keySessionsTotal === 0) {
    if (args.weekShape === "disrupted") {
      return args.latestIssueLabel
        ? `A mixed week, with drift most visible in ${args.latestIssueLabel.toLowerCase()}`
        : "A mixed week, with quality fading later on";
    }

    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return "A steady week, with extra work layered around it";
    }

    if (args.skippedSessions > 0) {
      return "A mostly intact week, with one visible wobble";
    }

    return "A steady consistency week";
  }

  if (args.weekShape === "disrupted") {
    return args.keySessionsLanded > 0
      ? "A disrupted week, with some of the main work preserved"
      : "A disrupted week, with the main work partly missed";
  }

  if (args.keySessionsTotal > 0 && args.keySessionsLanded === args.keySessionsTotal) {
    if (args.skippedSessions > 0) {
      return "The main work landed, with a few lower-priority misses";
    }
    if (args.addedSessions > 0) {
      return "The main work landed, with a little extra training added";
    }
    return "The main work landed across a steady week";
  }

  if (args.keySessionsMissed > 0) {
    return "A mixed week, with one meaningful gap in the main work";
  }

  if (args.skippedSessions > 0) {
    return "A mixed week with a couple of late changes";
  }

  if (args.completedPlannedSessions >= Math.ceil(args.plannedSessions * 0.8)) {
    return "A steady week with most of the planned work in place";
  }

  return "A flexible week that stayed broadly on course";
}

function buildStatusLine(args: {
  completedPlannedSessions: number;
  plannedSessions: number;
  keySessionsLanded: number;
  keySessionsMissed: number;
  keySessionsTotal: number;
  skippedSessions: number;
  addedSessions: number;
  latestIssueLabel: string | null;
  strongestExecutionLabel: string | null;
  weekShape: "normal" | "partial_reflection" | "disrupted";
}) {
  if (args.keySessionsTotal === 0) {
    if (args.latestIssueLabel) {
      return `Most of the week structure held, with the clearest drift showing up in ${args.latestIssueLabel}.`;
    }
    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return "Extra work changed the shape of the week, but the planned structure still mostly held.";
    }
    if (args.strongestExecutionLabel) {
      return `${args.strongestExecutionLabel} gave the clearest picture of how the week was landing.`;
    }
    if (args.weekShape === "disrupted") {
      return "The week stayed readable, but execution quality loosened more than the schedule alone suggests.";
    }
    return "The week was defined more by overall consistency than by one priority session.";
  }

  if (args.keySessionsLanded === args.keySessionsTotal && args.latestIssueLabel) {
    return `The priority structure held, but the clearest quality drift showed up in ${args.latestIssueLabel}.`;
  }
  if (args.keySessionsLanded === args.keySessionsTotal) {
    return args.addedSessions > 0
      ? "The priority structure held, and the added work stayed secondary to it."
      : "The priority structure held and execution stayed broadly intact across the week.";
  }
  if (args.keySessionsMissed > 0) {
    return args.latestIssueLabel
      ? `${args.latestIssueLabel} was the clearest point where the week's priority structure stopped landing cleanly.`
      : "One gap in the priority work shaped the rest of the week more than the surrounding sessions did.";
  }
  return `${args.completedPlannedSessions} of ${args.plannedSessions} planned sessions landed, with enough shape left to learn from the week.`;
}

function buildPrimaryTakeaway(args: {
  keySessionsTotal: number;
  keySessionsCompleted: number;
  keySessionsMissed: number;
  skippedSessions: number;
  addedSessions: number;
  lateWeekSkippedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
  completedPlannedSessions: number;
  plannedSessions: number;
}) {
  if (args.keySessionsTotal === 0) {
    if (args.strongestExecutionSession && args.latestIssueSession && args.strongestExecutionSession.id !== args.latestIssueSession.id) {
      return {
        title: "The week had one clear strength and one clear wobble",
        detail: `${args.strongestExecutionSession.label} was the best-executed session of the week, while ${args.latestIssueSession.label} was where the week loosened most.`
      };
    }

    if (args.latestIssueSession) {
      return {
        title: "One session explained most of the drift",
        detail: `${args.latestIssueSession.label} was the clearest point where execution quality fell away, more than the rest of the week.`
      };
    }

    if (args.strongestExecutionSession) {
      return {
        title: "Quality came through in one representative session",
        detail: `${args.strongestExecutionSession.label} best captured how the week was landing overall.`
      };
    }

    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return {
        title: "Consistency held, even with a little extra work",
        detail: "No one session dominated the week; the main read is that the overall structure held while a little extra work was layered on."
      };
    }
  }

  if (args.keySessionsTotal > 0) {
    if (args.keySessionsCompleted === args.keySessionsTotal) {
      if (args.skippedSessions > 0) {
        return {
          title: "The main work held",
          detail: "The priority sessions landed, and most of the disruption stayed outside the work the week depended on."
        };
      }

      if (args.addedSessions > 0) {
        return {
          title: "The main work set the week",
          detail: "The priority sessions landed first, and the added work stayed secondary to the planned structure."
        };
      }

      return {
        title: "The main work set the tone",
        detail: "The priority sessions landed and the rest of the week stayed close to the intended structure."
      };
    }

    if (args.keySessionsMissed > 0) {
      return {
        title: "One key gap shaped the week",
        detail: args.latestIssueSession?.label
          ? `${args.latestIssueSession.label} was the clearest point where the week's main structure stopped feeling fully intact.`
          : "The biggest story of the week was the priority work that did not fully land."
      };
    }
  }

  if (args.addedSessions > 0 && args.skippedSessions === 0) {
    return {
      title: "Consistency held, with extra work around it",
      detail: "No single session defined the week; the main story was that the planned structure held while a little extra work was layered on."
    };
  }

  if (args.lateWeekSkippedSessions > 0) {
    return {
      title: "Most of the week held until late drift",
      detail: "The opening structure stayed intact, but the back half of the week loosened more than the start."
    };
  }

  if (args.skippedSessions > 0) {
    return {
      title: "A few changes shaped the week",
      detail: "Without one designated priority session, the main story was where the planned structure slipped and what still held around it."
    };
  }

  if (args.completedPlannedSessions >= Math.ceil(args.plannedSessions * 0.8)) {
    return {
      title: "Consistency defined the week",
      detail: "No single session outweighed the rest; the value came from keeping the week's structure in place across multiple days."
    };
  }

  return {
    title: "The structure mattered more than any one session",
    detail: args.weekShape === "disrupted"
      ? "The week is better understood as a block with a few loose edges than as one standout session."
      : "This was more about the overall rhythm of the week than about a single headline workout."
  };
}

function buildPositiveHighlights(args: {
  keySessionsTotal: number;
  keySessionsCompleted: number;
  skippedSessions: number;
  addedSessions: number;
  lateWeekSkippedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
  hardestExtraActivity: ReturnType<typeof buildExtraCompletedActivities>[number] | null;
}) {
  const highlights = [
    args.strongestExecutionSession
      ? `${args.strongestExecutionSession.label} was the best-executed session of the week.`
      : null,
    args.keySessionsTotal > 0 && args.keySessionsCompleted === args.keySessionsTotal
      ? "The priority sessions landed without the rest of the week needing to bend around them."
      : null,
    args.skippedSessions <= 1
      ? "The week kept its shape without quality slipping across multiple sessions."
      : args.lateWeekSkippedSessions > 0
        ? "The disruption stayed more contained than a fully unraveled week."
        : null,
    args.addedSessions > 0 && args.skippedSessions === 0
      ? "Extra work stayed additive rather than replacing the main week."
      : null,
    args.hardestExtraActivity && (args.hardestExtraActivity.trainingStressScore ?? 0) >= 70 && args.skippedSessions === 0
      ? `${capitalize(args.hardestExtraActivity.sport)} extra work added meaningful load without replacing the plan.`
      : null,
    args.weekShape === "disrupted"
      ? "Even with some messiness, the stronger sessions still showed what is worth protecting."
      : null
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  return highlights.slice(0, 3);
}

function getDominantSport(sportMinutes: Map<string, number>) {
  const winner = [...sportMinutes.entries()].sort((a, b) => b[1] - a[1])[0];
  return winner?.[1] ? capitalize(winner[0]) : "Mixed";
}

function buildFallbackEvidenceSummaries(sessionSummaries: WeeklyDebriefSessionSummary[], extraActivities: ReturnType<typeof buildExtraCompletedActivities>) {
  const evidence: WeeklyDebriefEvidenceItem[] = [];

  for (const session of sessionSummaries) {
    if (session.status !== "completed" && session.status !== "skipped") continue;
    const review = session.review;
    evidence.push({
      id: session.id,
      label: session.label,
      detail: truncateStr(
        review?.executionSummary ??
        (session.status === "skipped" ? "This planned session was explicitly skipped." : `${formatMinutes(session.completedMinutes)} completed.`),
        280),
      kind: "session",
      href: `/sessions/${session.id}`,
      supportType: review ? "observation" : "fact"
    });
  }

  for (const activity of extraActivities.slice(0, 4)) {
    const loadDetail = describeExtraActivityLoad(activity);
    evidence.push({
      id: activity.id,
      label: `${capitalize(activity.sport)} extra workout`,
      detail: truncateStr(`${formatMinutes(activity.durationMinutes)} of unscheduled work was added to the week.${loadDetail ? ` ${loadDetail}.` : ""}`, 280),
      kind: "activity",
      href: `/sessions/activity/${activity.id}`,
      supportType: "fact"
    });
  }

  return evidence.slice(0, 18);
}

function buildEvidenceGroups(args: {
  facts: WeeklyDebriefFacts;
  sessionSummaries: WeeklyDebriefSessionSummary[];
  extraActivities: ReturnType<typeof buildExtraCompletedActivities>;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
  lateWeekSkippedSessions: number;
  weekStart: string;
}) {
  const completedSessions = args.sessionSummaries.filter((session) => session.status === "completed");
  const completedKeySessions = completedSessions.filter((session) => session.isKey);
  const skippedSessions = args.sessionSummaries.filter((session) => session.status === "skipped");
  const longestCompleted = [...completedSessions].sort((a, b) => b.completedMinutes - a.completedMinutes);

  const sessionSupport = (session: WeeklyDebriefSessionSummary, reason: string) => ({
    id: session.id,
    label: session.label,
    href: `/sessions/${session.id}`,
    kind: "session" as const,
    reason
  });

  const activitySupport = (activity: ReturnType<typeof buildExtraCompletedActivities>[number], reason: string) => ({
    id: activity.id,
    label: `${capitalize(activity.sport)} extra workout`,
    href: `/sessions/activity/${activity.id}`,
    kind: "activity" as const,
    reason
  });

  const uniqueSupports = <T extends { kind: "session" | "activity"; id: string }>(supports: T[]) =>
    supports.filter((support, index, all) => all.findIndex((candidate) => candidate.kind === support.kind && candidate.id === support.id) === index);

  const groups: WeeklyDebriefEvidenceGroup[] = [];

  const primarySupports = args.facts.keySessionsTotal > 0
    ? [
        ...completedKeySessions.slice(0, 2).map((session) => sessionSupport(session, "This was part of the week's priority work.")),
        ...skippedSessions.filter((session) => session.isKey).slice(0, 1).map((session) => sessionSupport(session, "This missing key session changed the week's shape.")),
        ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This added work changed the week's shape without replacing the plan.")) : [])
      ]
    : [
        ...longestCompleted.slice(0, 2).map((session) => sessionSupport(session, "This helped hold the week's planned structure together.")),
        ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This added work changed the week's overall shape.")) : []),
        ...skippedSessions.slice(0, 1).map((session) => sessionSupport(session, "This missed session explains where the week loosened."))
      ];

  if (primarySupports.length > 0) {
    groups.push({
      claim: args.facts.primaryTakeawayTitle,
      detail: args.facts.primaryTakeawayDetail,
      supports: uniqueSupports(primarySupports).slice(0, 4)
    });
  }

  const stabilitySupports = [
    ...(args.strongestExecutionSession ? [sessionSupport(args.strongestExecutionSession, "This session best represents the week's strongest execution quality.")] : []),
    ...completedKeySessions.slice(0, 2).filter((session) => session.id !== args.strongestExecutionSession?.id).map((session) => sessionSupport(session, "This session helped preserve the week's quality.")),
    ...longestCompleted.slice(0, 2).map((session) => sessionSupport(session, "This session helped keep the planned rhythm in place.")),
    ...(args.facts.addedSessions > 0 && args.facts.skippedSessions === 0
      ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This extra work stayed additive rather than replacing the plan."))
      : [])
  ];

  if (stabilitySupports.length > 0) {
    groups.push({
      claim: args.strongestExecutionSession ? "Where execution quality was strongest" : "What held the week together",
      detail: args.strongestExecutionSession
        ? `${args.strongestExecutionSession.label} gave the clearest read on the week's strongest execution.`
        : args.facts.keySessionsTotal > 0 && args.facts.keySessionsCompleted === args.facts.keySessionsTotal
          ? "The priority work landed, and the rest of the week still had enough structure around it."
          : "These sessions best explain what held the week together.",
      supports: uniqueSupports(stabilitySupports).slice(0, 4)
    });
  }

  const noticeSupports = [
    ...(args.latestIssueSession ? [sessionSupport(args.latestIssueSession, "This was the clearest point where execution drift showed up.")] : []),
    ...skippedSessions.filter((session) => !args.latestIssueSession || session.id !== args.latestIssueSession.id).slice(0, args.lateWeekSkippedSessions > 0 ? 2 : 1).map((session) =>
      sessionSupport(
        session,
        session.date >= addDays(args.weekStart, 4)
          ? "This miss contributed to the late-week drift."
          : "This miss contributed to where the week loosened."
      )
    ),
    ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This extra session changed the week's shape and is worth reading in context.")) : [])
  ];

  if (noticeSupports.length > 0) {
    groups.push({
      claim: "Where execution drift showed up",
      detail: args.latestIssueSession
        ? `The clearest drift showed up around ${args.latestIssueSession.label}.`
        : args.lateWeekSkippedSessions > 0
          ? "Most of the disruption was concentrated in the back half of the week."
          : "These sessions best explain where the week diverged from the intended shape.",
      supports: uniqueSupports(noticeSupports).slice(0, 4)
    });
  }

  return groups.slice(0, 3);
}

function buildDeterministicSuggestions(args: {
  weekShape: "normal" | "partial_reflection" | "disrupted";
  athleteContext: AthleteContextSnapshot | null;
  keySessionsMissed: number;
  lateSkippedSessions: number;
  addedSessions: number;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  keySessionsTotal: number;
  hardestExtraActivity: ReturnType<typeof buildExtraCompletedActivities>[number] | null;
}) {
  const carry: string[] = [];
  if (args.latestIssueSession?.label) {
    carry.push(`Take a calmer first half into the next ${args.latestIssueSession.label.toLowerCase()}.`);
  } else if (args.keySessionsMissed > 0) {
    carry.push("Protect the main session before adding anything extra.");
  } else if (args.keySessionsTotal === 0) {
    carry.push("Keep the sessions that are landing cleanly as the anchor points of the week.");
  } else {
    carry.push("Keep the same spacing around the main work.");
  }

  if (args.lateSkippedSessions > 0) {
    carry.push("Protect the back half of the week from spillover.");
  } else if (args.hardestExtraActivity && (args.hardestExtraActivity.trainingStressScore ?? 0) >= 70) {
    carry.push("Treat the hardest extra session as real load before adding anything else around it.");
  } else if (args.addedSessions > 0) {
    carry.push("Only add extra work after the planned sessions are already done.");
  } else if (args.athleteContext?.weeklyState.note) {
    carry.push("Carry one useful cue from your note into the next harder session.");
  } else if (args.weekShape === "disrupted") {
    carry.push("Keep next week simple rather than trying to repay missed work.");
  } else {
    carry.push("Keep easy work controlled ahead of the harder day.");
  }

  return carry.slice(0, 2);
}

function buildDeterministicObservations(args: {
  reflectionsSparse: boolean;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  lateSkippedSessions: number;
  skippedSessions: number;
  addedSessions: number;
  keySessionsMissed: number;
  reviewedSessionsCount: number;
  hardestExtraActivity: ReturnType<typeof buildExtraCompletedActivities>[number] | null;
}) {
  const observations: string[] = [];
  if (args.latestIssueSession?.label) {
    observations.push(`The clearest drift showed up in ${args.latestIssueSession.label}, rather than across the whole week.`);
  }
  if (args.keySessionsMissed > 0) {
    observations.push("The most meaningful drift touched one of the week's priority sessions.");
  } else if (args.lateSkippedSessions > 0) {
    observations.push("Most of the disruption was contained to the back half of the week.");
  } else if (args.skippedSessions > 0) {
    observations.push("The misses were present, but they did not spread across the whole structure.");
  }
  if (args.addedSessions > 0) {
    observations.push("Added work changed the shape of the week and is worth reading alongside the planned sessions, not separately from them.");
  }
  if (args.hardestExtraActivity && (args.hardestExtraActivity.trainingStressScore ?? 0) >= 70) {
    observations.push(`${capitalize(args.hardestExtraActivity.sport)} extra work was a meaningful load addition, not just extra minutes.`);
  } else if (args.hardestExtraActivity?.sport === "run" && ((args.hardestExtraActivity.hrDriftPct ?? 0) >= 0.05 || (args.hardestExtraActivity.paceFadePct ?? 0) >= 0.04)) {
    observations.push("The added run looked costly enough to matter for recovery, not just for volume.");
  } else if (args.hardestExtraActivity?.sport === "swim" && (args.hardestExtraActivity.avgPacePer100mSec ?? 0) > 0) {
    observations.push("The added swim looked more like supportive aerobic work than random extra minutes.");
  }
  if (args.reviewedSessionsCount === 0 && observations.length === 0) {
    observations.push("This week reads more through overall rhythm than through one standout session.");
  }

  return observations.slice(0, 3);
}

export function buildWeeklyDebriefFacts(input: WeeklyDebriefInputs) {
  const completionLedger = input.sessions.reduce<Record<string, number>>((acc, session) => {
    if (session.status !== "completed") return acc;
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const confirmedLinks = input.links.filter(hasConfirmedPlannedSessionLink);
  const activitiesIndex = new Map(input.activities.map((a) => [a.id, a]));
  const sessionsIndex = new Map(input.sessions.map((s) => [s.id, s]));
  const linkedActivityBySessionId = new Map<string, WeeklyDebriefActivity>();
  const linkedSessionByActivityId = new Map<string, WeeklyDebriefSession>();
  for (const link of confirmedLinks) {
    if (!link.planned_session_id || linkedActivityBySessionId.has(link.planned_session_id)) continue;
    const activity = activitiesIndex.get(link.completed_activity_id);
    const session = sessionsIndex.get(link.planned_session_id);
    if (activity) {
      linkedActivityBySessionId.set(link.planned_session_id, activity);
      if (session) linkedSessionByActivityId.set(activity.id, session);
    }
  }

  const sessionSummaries: WeeklyDebriefSessionSummary[] = input.sessions
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    .map((session) => {
      const status = inferSessionStatus(session, completionLedger);
      const label = getSessionDisplayName({
        sessionName: session.session_name ?? session.type,
        subtype: session.subtype ?? session.workout_type ?? session.type,
        discipline: session.sport
      });
      const linkedActivity = linkedActivityBySessionId.get(session.id);
      const refreshedExecutionResult = linkedActivity && shouldRefreshExecutionResultFromActivity(session.execution_result ?? null, {
        id: linkedActivity.id,
        sport_type: linkedActivity.sport_type,
        duration_sec: linkedActivity.duration_sec,
        distance_m: linkedActivity.distance_m,
        avg_hr: linkedActivity.avg_hr,
        avg_power: linkedActivity.avg_power,
        metrics_v2: linkedActivity.metrics_v2 ?? null
      })
        ? buildExecutionResultForSession(
            {
              id: session.id,
              athlete_id: session.athlete_id ?? undefined,
              user_id: session.user_id ?? session.athlete_id ?? "unknown-athlete",
              sport: session.sport,
              type: session.type,
              duration_minutes: session.duration_minutes ?? null,
              intent_category: session.intent_category ?? null,
              session_name: session.session_name ?? session.type,
              session_role: session.session_role ?? null,
              status: session.status ?? "planned"
            },
            {
              id: linkedActivity.id,
              sport_type: linkedActivity.sport_type,
              duration_sec: linkedActivity.duration_sec,
              distance_m: linkedActivity.distance_m,
              avg_hr: linkedActivity.avg_hr,
              avg_power: linkedActivity.avg_power,
              metrics_v2: linkedActivity.metrics_v2 ?? null
            }
          )
        : session.execution_result ?? null;
      const review = parsePersistedExecutionReview(refreshedExecutionResult);
      return {
        id: session.id,
        label,
        date: session.date,
        sport: session.sport,
        durationMinutes: Math.max(0, session.duration_minutes ?? 0),
        status,
        isKey: Boolean(session.is_key) || session.session_role?.toLowerCase() === "key",
        review,
        completedMinutes: status === "completed" ? Math.max(0, session.duration_minutes ?? 0) : 0
      };
    });
  const linkedActivityIds = new Set(confirmedLinks.map((link) => link.completed_activity_id));
  const durationByActivityId = new Map(
    input.activities.map((activity) => [activity.id, Math.round((activity.duration_sec ?? 0) / 60)])
  );

  for (const session of sessionSummaries) {
    const linkedMinutes = confirmedLinks
      .filter((link) => link.planned_session_id === session.id)
      .reduce((sum, link) => sum + (durationByActivityId.get(link.completed_activity_id) ?? 0), 0);
    if (linkedMinutes > 0) {
      session.completedMinutes = linkedMinutes;
    }
  }

  const weekEndExclusive = addDays(input.weekEnd, 1);
  const extraActivities = buildExtraCompletedActivities({
    activities: input.activities,
    links: input.links,
    timeZone: input.timeZone,
    weekStart: input.weekStart,
    weekEndExclusive
  });

  const plannedSessions = sessionSummaries.length;
  const completedPlannedSessions = sessionSummaries.filter((session) => session.status === "completed").length;
  const addedSessions = extraActivities.length;
  const completedSessions = completedPlannedSessions + addedSessions;
  const skippedSessions = sessionSummaries.filter((session) => session.status === "skipped").length;
  const remainingSessions = sessionSummaries.filter((session) => session.status === "planned").length;
  const keySessions = sessionSummaries.filter((session) => session.isKey);
  const keySessionsCompleted = keySessions.filter((session) => session.status === "completed").length;
  const keySessionsMissed = keySessions.filter((session) => session.status === "skipped").length;
  // Use actual activity minutes for completed sessions (same as the dashboard main card) so the
  // generated artifact and the readiness card always report the same effective planned total.
  const plannedMinutes = sessionSummaries.reduce(
    (sum, session) => sum + (session.status === "completed" ? session.completedMinutes : session.durationMinutes),
    0
  );
  const completedPlannedMinutes = sessionSummaries.reduce((sum, session) => sum + session.completedMinutes, 0);
  const completedMinutes = completedPlannedMinutes + extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const skippedMinutes = sessionSummaries.filter((session) => session.status === "skipped").reduce((sum, session) => sum + session.durationMinutes, 0);
  const resolvedMinutes = completedMinutes + skippedMinutes;
  const extraMinutes = extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const completionPct = plannedMinutes === 0 ? 0 : Math.round((resolvedMinutes / plannedMinutes) * 100);
  const reflectionsSparse = !input.athleteContext?.weeklyState.note?.trim();
  const weekShape = classifyWeeklyDebriefWeekShape({
    plannedSessions,
    completedSessions,
    skippedSessions,
    reflectionsSparse,
    completionPct
  });

  const sportMinutes = sessionSummaries.reduce((acc, session) => {
    acc.set(session.sport, (acc.get(session.sport) ?? 0) + session.completedMinutes);
    return acc;
  }, new Map<string, number>());
  for (const activity of extraActivities) {
    sportMinutes.set(activity.sport, (sportMinutes.get(activity.sport) ?? 0) + activity.durationMinutes);
  }

  const readiness = computeWeeklyDebriefReadiness({
    todayIso: input.todayIso,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    plannedMinutes,
    resolvedMinutes,
    totalKeySessions: keySessions.length,
    resolvedKeySessions: keySessionsCompleted
  });

  const reviewedSessions = sessionSummaries.filter((session) => Boolean(session.review));
  const hardestExtraActivity = getHardestExtraActivity(extraActivities);
  const activityEvidence = [
    ...sessionSummaries
      .map((session) => {
        const linkedActivity = linkedActivityBySessionId.get(session.id);
        if (!linkedActivity) return null;
        return buildActivityEvidenceEntry({
          activity: linkedActivity,
          label: session.label,
          context: "linked_session",
          sessionId: session.id
        });
      })
      .filter((item): item is WeeklyDebriefActivityEvidence => item !== null),
    ...extraActivities
      .map((extra) => {
        const source = input.activities.find((activity) => activity.id === extra.id);
        if (!source) return null;
        return buildActivityEvidenceEntry({
          activity: source,
          label: `${capitalize(extra.sport)} extra workout`,
          context: "extra_activity",
          sessionId: linkedSessionByActivityId.get(source.id)?.id
        });
      })
      .filter((item): item is WeeklyDebriefActivityEvidence => item !== null)
  ].slice(0, 10);
  const strongestExecutionSession =
    reviewedSessions
      .filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "on_target")
      .sort((a, b) => (b.review?.executionScore ?? -1) - (a.review?.executionScore ?? -1))[0] ??
    [...reviewedSessions].sort((a, b) => (b.review?.executionScore ?? -1) - (a.review?.executionScore ?? -1))[0] ??
    null;
  const provisionalReviewCount = reviewedSessions.filter((session) => session.review?.executionScoreProvisional).length;
  const latestIssueSession = reviewedSessions
    .filter((session) => session.review?.deterministic.rulesSummary.intentMatch !== "on_target")
    .sort((a, b) => (a.review?.executionScore ?? 100) - (b.review?.executionScore ?? 100))[0] ?? null;
  const finalTitle = buildWeekTitle({
    completedPlannedSessions,
    plannedSessions,
    keySessionsLanded: keySessionsCompleted,
    keySessionsMissed,
    keySessionsTotal: keySessions.length,
    skippedSessions,
    addedSessions,
    weekShape,
    latestIssueLabel: latestIssueSession?.label ?? null
  });
  const statusLine = buildStatusLine({
    completedPlannedSessions,
    plannedSessions,
    keySessionsLanded: keySessionsCompleted,
    keySessionsMissed,
    keySessionsTotal: keySessions.length,
    skippedSessions,
    addedSessions,
    latestIssueLabel: latestIssueSession?.label ?? null,
    strongestExecutionLabel: strongestExecutionSession?.label ?? null,
    weekShape
  });
  const lateWeekSkippedSessions = sessionSummaries.filter(
    (session) => session.status === "skipped" && session.date >= addDays(input.weekStart, 4)
  ).length;
  const primaryTakeaway = buildPrimaryTakeaway({
    keySessionsTotal: keySessions.length,
    keySessionsCompleted,
    keySessionsMissed,
    skippedSessions,
    addedSessions,
    lateWeekSkippedSessions,
    weekShape,
    latestIssueSession,
    strongestExecutionSession,
    completedPlannedSessions,
    plannedSessions
  });
  const artifactState = buildArtifactState({
    provisionalReviewCount
  });

  const factualBullets = [
    `${completedPlannedSessions} of ${plannedSessions} planned sessions were completed.`,
    reviewedSessions.length > 0
      ? latestIssueSession
        ? `The clearest drift showed up in ${latestIssueSession.label}.`
        : strongestExecutionSession
          ? `${strongestExecutionSession.label} gave the strongest execution read.`
          : `${reviewedSessions.length} sessions were reviewed for execution quality.`
      : keySessions.length > 0 && keySessionsCompleted === keySessions.length
        ? `All key sessions landed.`
        : keySessions.length > 0
          ? `${keySessionsCompleted} of ${keySessions.length} key sessions landed.`
          : "The week is best read through overall structure rather than one priority session.",
    skippedSessions > 0
      ? `${skippedSessions} planned ${skippedSessions === 1 ? "session was" : "sessions were"} missed.`
      : addedSessions > 0
        ? `${addedSessions} extra ${addedSessions === 1 ? "session was" : "sessions were"} added.`
        : `${formatMinutes(completedMinutes)} of training was completed.`,
    extraMinutes > 0
      ? hardestExtraActivity && describeExtraActivityLoad(hardestExtraActivity)
        ? `${formatMinutes(extraMinutes)} was added outside the original plan, led by ${describeExtraActivityLoad(hardestExtraActivity)} of extra ${hardestExtraActivity.sport} load.`
        : `${formatMinutes(extraMinutes)} was added outside the original plan.`
      : `${formatMinutes(completedMinutes)} was completed against ${formatMinutes(plannedMinutes)} planned.`
  ].filter((value, index, all) => value && all.indexOf(value) === index).slice(0, 4);

  const positiveHighlights = buildPositiveHighlights({
    keySessionsTotal: keySessions.length,
    keySessionsCompleted,
    skippedSessions,
    addedSessions,
    lateWeekSkippedSessions,
    weekShape,
    strongestExecutionSession,
    hardestExtraActivity
  });

  const observations = buildDeterministicObservations({
    reflectionsSparse,
    latestIssueSession,
    lateSkippedSessions: lateWeekSkippedSessions,
    skippedSessions,
    addedSessions,
    keySessionsMissed,
    reviewedSessionsCount: reviewedSessions.length,
    hardestExtraActivity
  });
  const carryForward = buildDeterministicSuggestions({
    weekShape,
    athleteContext: input.athleteContext,
    keySessionsMissed,
    lateSkippedSessions: lateWeekSkippedSessions,
    addedSessions,
    latestIssueSession,
    keySessionsTotal: keySessions.length,
    hardestExtraActivity
  });

  const qualityOnTargetCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "on_target").length;
  const qualityPartialCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "partial").length;
  const qualityMissedCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "missed").length;
  const metrics = [
    {
      label: "Completed",
      value: `${completedPlannedSessions}/${plannedSessions}`,
      detail:
        skippedSessions > 0 || addedSessions > 0
          ? `${completedPlannedSessions} completed${skippedSessions > 0 ? ` • ${skippedSessions} missed` : ""}${addedSessions > 0 ? ` • ${addedSessions} added` : ""}`
          : `${completedPlannedSessions} completed`,
      tone: skippedSessions === 0 ? "positive" as const : "neutral" as const
    },
    {
      label: "Time",
      value: `${formatMinutes(completedMinutes)} / ${formatMinutes(plannedMinutes)}`,
      detail:
        addedSessions > 0
          ? `${formatMinutes(completedMinutes)} done • includes ${formatMinutes(extraMinutes)} added work${hardestExtraActivity && describeExtraActivityLoad(hardestExtraActivity) ? ` • ${describeExtraActivityLoad(hardestExtraActivity)}` : ""}`
          : `${formatMinutes(completedMinutes)} done`,
      tone: completionPct >= 90 ? "positive" as const : completionPct >= 70 ? "neutral" as const : "caution" as const
    },
    ...(reviewedSessions.length > 0 ? [{
      label: "Sessions on target",
      value: `${qualityOnTargetCount}/${reviewedSessions.length} on target`,
      detail: qualityPartialCount > 0 || qualityMissedCount > 0 ? `${qualityPartialCount} partial · ${qualityMissedCount} off` : null,
      tone: qualityMissedCount > 0 ? "caution" as const : qualityOnTargetCount > 0 ? "positive" as const : "neutral" as const
    }] : []),
    ...(strongestExecutionSession ? [{
      label: "Strongest execution",
      value: strongestExecutionSession.label,
      detail: strongestExecutionSession.review?.deterministic.rulesSummary.intentMatch === "on_target" ? "Stayed closest to target" : strongestExecutionSession.review?.executionScoreBand ?? null,
      tone: "positive" as const
    }] : []),
    ...((latestIssueSession || skippedSessions > 0 || addedSessions > 0) ? [{
      label: latestIssueSession ? "Biggest drift" : "Week shape",
      value: latestIssueSession ? latestIssueSession.label : skippedSessions > 0 ? `${skippedSessions} missed` : `${addedSessions} added`,
      detail: latestIssueSession ? null : skippedSessions > 0 ? "Back-half looseness" : "Added work changed the shape",
      tone: latestIssueSession || skippedSessions > 0 ? "caution" as const : "muted" as const
    }] : [])
  ];

  const draftFacts = weeklyDebriefFactsSchema.parse({
      weekLabel: `Week of ${input.weekStart}`,
      weekRange: weekRangeLabel(input.weekStart),
      title: finalTitle,
      statusLine,
      primaryTakeawayTitle: primaryTakeaway.title,
      primaryTakeawayDetail: primaryTakeaway.detail,
      plannedSessions,
      completedPlannedSessions,
      completedSessions,
      addedSessions,
      skippedSessions,
      remainingSessions,
      keySessionsCompleted,
      keySessionsMissed,
      keySessionsTotal: keySessions.length,
      plannedMinutes,
      completedPlannedMinutes,
      completedMinutes,
      skippedMinutes,
      extraMinutes,
      completionPct,
      dominantSport: getDominantSport(sportMinutes),
      keySessionStatus: keySessions.length > 0 ? "Priority sessions influenced the week." : "Consistency and execution quality explained the week better than one priority session.",
      metrics,
      factualBullets,
      confidenceNote: getConfidenceNote(input),
      narrativeSource: "legacy_unknown",
      artifactStateLabel: artifactState.label,
      artifactStateNote: artifactState.note,
      provisionalReviewCount,
      weekShape,
      reflectionsSparse
    });

  const deterministicNarrative = buildDeterministicNarrative({
    facts: draftFacts,
    topHighlights: positiveHighlights,
    observations,
    carryForward
  });

  const evidence = buildFallbackEvidenceSummaries(sessionSummaries, extraActivities);
  const facts = weeklyDebriefFactsSchema.parse({
    ...draftFacts,
    completionPct: clamp(completionPct, 0, 999),
    primaryTakeawayTitle: primaryTakeaway.title,
    primaryTakeawayDetail: primaryTakeaway.detail
  });
  const evidenceGroups = buildEvidenceGroups({
    facts,
    sessionSummaries,
    extraActivities,
    latestIssueSession,
    strongestExecutionSession,
    lateWeekSkippedSessions,
    weekStart: input.weekStart
  });

  return {
    readiness,
    facts,
    deterministicNarrative,
    evidence,
    activityEvidence,
    evidenceGroups,
    sourceUpdatedAt: getSourceUpdatedAt([
      ...input.sessions.map((session) => session.updated_at ?? session.created_at),
      ...input.activities.map((activity) => activity.updated_at ?? activity.created_at ?? activity.start_time_utc),
      ...input.links.map((link) => link.created_at ?? null),
      input.athleteContext?.weeklyState.updatedAt
    ])
  };
}

async function loadWeeklyDebriefInputs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const activityRangeStart = `${addDays(args.weekStart, -1)}T00:00:00.000Z`;
  const activityRangeEnd = `${addDays(args.weekEnd, 2)}T00:00:00.000Z`;

  const [{ data: sessionsData, error: sessionsError }, activities, { data: linksData, error: linksError }, athleteContext, { data: checkInData }] = await Promise.all([
    args.supabase
      .from("sessions")
      .select("id,athlete_id,user_id,date,sport,type,session_name,subtype,workout_type,intent_category,session_role,notes,status,duration_minutes,updated_at,created_at,execution_result,is_key")
      .or(`athlete_id.eq.${args.athleteId},user_id.eq.${args.athleteId}`)
      .gte("date", args.weekStart)
      .lte("date", args.weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true }),
    loadCompletedActivities({
      supabase: args.supabase,
      userId: args.athleteId,
      rangeStart: activityRangeStart,
      rangeEnd: activityRangeEnd
    }),
    args.supabase
      .from("session_activity_links")
      .select("completed_activity_id,planned_session_id,confirmation_status,created_at")
      .eq("user_id", args.athleteId),
    getAthleteContextSnapshot(args.supabase, args.athleteId),
    args.supabase
      .from("athlete_checkins")
      .select("fatigue_score,stress_score,motivation_score,week_notes")
      .eq("user_id", args.athleteId)
      .eq("week_start", args.weekStart)
      .maybeSingle()
  ]);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }
  if (linksError) {
    throw new Error(linksError.message);
  }

  const checkIn: WeeklyDebriefCheckIn | null = checkInData
    ? {
        fatigueScore: (checkInData as { fatigue_score?: number | null }).fatigue_score ?? null,
        stressScore: (checkInData as { stress_score?: number | null }).stress_score ?? null,
        motivationScore: (checkInData as { motivation_score?: number | null }).motivation_score ?? null,
        weekNotes: (checkInData as { week_notes?: string | null }).week_notes ?? null
      }
    : null;

  return {
    sessions: (sessionsData ?? []) as WeeklyDebriefSession[],
    activities: activities as WeeklyDebriefActivity[],
    links: (linksData ?? []) as WeeklyDebriefLink[],
    athleteContext,
    checkIn,
    timeZone: args.timeZone,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    todayIso: args.todayIso
  } satisfies WeeklyDebriefInputs;
}

async function loadWeeklyDebriefSourceInputs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const activityRangeStart = `${addDays(args.weekStart, -1)}T00:00:00.000Z`;
  const activityRangeEnd = `${addDays(args.weekEnd, 2)}T00:00:00.000Z`;

  const [
    { data: sessionsData, error: sessionsError },
    activities,
    { data: linksData, error: linksError },
    { data: checkinData, error: checkinError }
  ] = await Promise.all([
    args.supabase
      .from("sessions")
      .select("id,date,sport,notes,status,duration_minutes,updated_at,created_at,is_key,session_role")
      .or(`athlete_id.eq.${args.athleteId},user_id.eq.${args.athleteId}`)
      .gte("date", args.weekStart)
      .lte("date", args.weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true }),
    loadCompletedActivities({
      supabase: args.supabase,
      userId: args.athleteId,
      rangeStart: activityRangeStart,
      rangeEnd: activityRangeEnd
    }),
    args.supabase
      .from("session_activity_links")
      .select("completed_activity_id,planned_session_id,confirmation_status,created_at")
      .eq("user_id", args.athleteId),
    args.supabase
      .from("athlete_checkins")
      .select("updated_at")
      .eq("athlete_id", args.athleteId)
      .eq("week_start", args.weekStart)
      .maybeSingle()
  ]);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }
  if (linksError) {
    throw new Error(linksError.message);
  }
  if (checkinError) {
    throw new Error(checkinError.message);
  }

  return {
    sessions: (sessionsData ?? []) as WeeklyDebriefSourceInputs["sessions"],
    activities: activities as WeeklyDebriefActivity[],
    links: (linksData ?? []) as WeeklyDebriefLink[],
    weeklyCheckinUpdatedAt: checkinData?.updated_at ?? null,
    timeZone: args.timeZone,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    todayIso: args.todayIso
  } satisfies WeeklyDebriefSourceInputs;
}

function computeWeeklyDebriefSourceState(input: WeeklyDebriefSourceInputs) {
  const completionLedger = input.sessions.reduce<Record<string, number>>((acc, session) => {
    if (session.status !== "completed") return acc;
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const sessionSummaries = input.sessions
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    .map((session) => ({
      ...session,
      resolvedStatus: inferSessionStatus(session as WeeklyDebriefSession, completionLedger),
      isKey: Boolean(session.is_key) || session.session_role?.toLowerCase() === "key",
      durationMinutes: Math.max(0, session.duration_minutes ?? 0)
    }));

  const confirmedLinks = input.links.filter(hasConfirmedPlannedSessionLink);
  const weekEndExclusive = addDays(input.weekEnd, 1);
  const extraActivities = buildExtraCompletedActivities({
    activities: input.activities,
    links: input.links,
    timeZone: input.timeZone,
    weekStart: input.weekStart,
    weekEndExclusive
  });

  // For completed sessions use actual activity minutes (same as the main card) so both cards show the
  // same effective total.  For skipped/planned sessions keep the planned duration.
  const activitiesById = new Map(input.activities.map((a) => [a.id, a]));
  const getEffectiveMinutes = (session: (typeof sessionSummaries)[number]) => {
    if (session.resolvedStatus !== "completed") return session.durationMinutes;
    const linkedMinutes = confirmedLinks
      .filter((link) => link.planned_session_id === session.id)
      .reduce((minutes, link) => {
        const activity = activitiesById.get(link.completed_activity_id);
        return minutes + Math.round((activity?.duration_sec ?? 0) / 60);
      }, 0);
    return linkedMinutes > 0 ? linkedMinutes : session.durationMinutes;
  };
  const plannedMinutes = sessionSummaries.reduce((sum, session) => sum + getEffectiveMinutes(session), 0);
  const completedMinutes =
    sessionSummaries
      .filter((session) => session.resolvedStatus === "completed")
      .reduce((sum, session) => sum + getEffectiveMinutes(session), 0) +
    extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const skippedMinutes = sessionSummaries
    .filter((session) => session.resolvedStatus === "skipped")
    .reduce((sum, session) => sum + session.durationMinutes, 0);
  const resolvedMinutes = completedMinutes + skippedMinutes;

  const keySessions = sessionSummaries.filter((session) => session.isKey);
  const resolvedKeySessions = keySessions.filter(
    (session) => session.resolvedStatus === "completed" || session.resolvedStatus === "skipped"
  ).length;

  return {
    readiness: computeWeeklyDebriefReadiness({
      todayIso: input.todayIso,
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      plannedMinutes,
      resolvedMinutes,
      totalKeySessions: keySessions.length,
      resolvedKeySessions
    }),
    sourceUpdatedAt: getSourceUpdatedAt([
      ...input.sessions.map((session) => session.updated_at ?? session.created_at),
      ...input.activities.map((activity) => activity.updated_at ?? activity.created_at ?? activity.start_time_utc),
      ...input.links.map((link) => link.created_at ?? null),
      input.weeklyCheckinUpdatedAt
    ])
  } satisfies WeeklyDebriefSourceState;
}

export async function computeWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const inputs = await loadWeeklyDebriefInputs(args);
  const base = buildWeeklyDebriefFacts(inputs);

  // Load recent feedback from previous debriefs for AI calibration
  const { data: feedbackRows } = await args.supabase
    .from("weekly_debriefs")
    .select("week_start, helpful, accurate, feedback_note")
    .eq("athlete_id", args.athleteId)
    .lt("week_start", args.weekStart)
    .or("helpful.is.not.null,accurate.is.not.null")
    .order("week_start", { ascending: false })
    .limit(4);

  const recentFeedback = (feedbackRows ?? []).map((r) => ({
    weekStart: r.week_start as string,
    helpful: r.helpful as boolean | null,
    accurate: r.accurate as boolean | null,
    note: r.feedback_note as string | null,
  }));

  const generated = await generateNarrative({
    facts: base.facts,
    evidence: base.evidence,
    activityEvidence: base.activityEvidence,
    athleteContext: inputs.athleteContext,
    checkIn: inputs.checkIn,
    deterministicFallback: base.deterministicNarrative,
    recentFeedback: recentFeedback.length > 0 ? recentFeedback : undefined,
  });
  const narrative = generated.narrative;
  const facts = weeklyDebriefFactsSchema.parse({
    ...base.facts,
    narrativeSource: generated.source
  });
  const coachShare = buildCoachShare({
    facts,
    narrative
  });

  return {
    readiness: base.readiness,
    facts,
    narrative,
    coachShare,
    evidence: base.evidence,
    evidenceGroups: base.evidenceGroups,
    sourceUpdatedAt: base.sourceUpdatedAt
  } satisfies WeeklyDebriefComputed;
}

export async function persistWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  computed: WeeklyDebriefComputed;
}) {
  if (!args.computed.readiness.isReady) {
    throw new Error("Weekly Debrief cannot be persisted before readiness is met.");
  }

  const generatedAt = new Date().toISOString();
  const factsPayload = {
    ...args.computed.facts,
    evidence: args.computed.evidence,
    evidenceGroups: args.computed.evidenceGroups
  };

  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .upsert({
      athlete_id: args.athleteId,
      user_id: args.athleteId,
      week_start: args.weekStart,
      week_end: args.weekEnd,
      status: "ready",
      source_updated_at: args.computed.sourceUpdatedAt,
      generated_at: generatedAt,
      generation_version: WEEKLY_DEBRIEF_GENERATION_VERSION,
      facts: factsPayload,
      narrative: args.computed.narrative,
      coach_share: args.computed.coachShare
    }, {
      onConflict: "athlete_id,week_start"
    })
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Could not persist weekly debrief.");
  }

  return normalizePersistedArtifact(data as WeeklyDebriefRecord, "ready");
}

export async function getPersistedWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
}) {
  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .eq("athlete_id", args.athleteId)
    .eq("week_start", args.weekStart)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? (data as WeeklyDebriefRecord) : null;
}

export function isWeeklyDebriefStale(args: {
  persisted: Pick<WeeklyDebriefRecord, "generated_at" | "source_updated_at" | "status" | "generation_version"> | null;
  sourceUpdatedAt: string;
}) {
  if (!args.persisted) return false;
  if (args.persisted.status === "failed") return false;
  return args.persisted.generation_version !== WEEKLY_DEBRIEF_GENERATION_VERSION ||
    args.sourceUpdatedAt > args.persisted.generated_at ||
    args.persisted.source_updated_at !== args.sourceUpdatedAt;
}

export async function getWeeklyDebriefSnapshot(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  timeZone: string;
  todayIso: string;
}) {
  const weekEnd = addDays(args.weekStart, 6);
  const sourceState = computeWeeklyDebriefSourceState(await loadWeeklyDebriefSourceInputs({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    timeZone: args.timeZone,
    todayIso: args.todayIso
  }));

  if (!sourceState.readiness.isReady) {
    return {
      readiness: sourceState.readiness,
      artifact: null,
      stale: false,
      sourceUpdatedAt: sourceState.sourceUpdatedAt,
      weekStart: args.weekStart,
      weekEnd
    } satisfies WeeklyDebriefSnapshot;
  }

  const persisted = await getPersistedWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart
  });

  if (!persisted) {
    return {
      readiness: sourceState.readiness,
      artifact: null,
      stale: false,
      sourceUpdatedAt: sourceState.sourceUpdatedAt,
      weekStart: args.weekStart,
      weekEnd
    } satisfies WeeklyDebriefSnapshot;
  }

  const stale = isWeeklyDebriefStale({
    persisted,
    sourceUpdatedAt: sourceState.sourceUpdatedAt
  });
  const effectiveStatus = stale ? "stale" : persisted.status;
  return {
    readiness: sourceState.readiness,
    artifact: normalizePersistedArtifact(persisted, effectiveStatus),
    stale,
    sourceUpdatedAt: sourceState.sourceUpdatedAt,
    weekStart: args.weekStart,
    weekEnd
  } satisfies WeeklyDebriefSnapshot;
}

export async function refreshWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  timeZone: string;
  todayIso: string;
}) {
  const weekEnd = addDays(args.weekStart, 6);
  const computed = await computeWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    timeZone: args.timeZone,
    todayIso: args.todayIso
  });

  if (!computed.readiness.isReady) {
    return {
      readiness: computed.readiness,
      artifact: null
    };
  }

  const artifact = await persistWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    computed
  });

  return {
    readiness: computed.readiness,
    artifact
  };
}

export const weeklyDebriefFeedbackInputSchema = z.object({
  weekStart: z.string().date(),
  helpful: z.boolean().nullable(),
  accurate: z.boolean().nullable(),
  note: z.string().trim().max(400).nullable().optional()
});

export type WeeklyDebriefFeedbackInput = z.infer<typeof weeklyDebriefFeedbackInputSchema>;

export async function saveWeeklyDebriefFeedback(args: {
  supabase: SupabaseClient;
  athleteId: string;
  input: WeeklyDebriefFeedbackInput;
}) {
  const parsed = weeklyDebriefFeedbackInputSchema.parse(args.input);
  const feedbackUpdatedAt = new Date().toISOString();
  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .update({
      helpful: parsed.helpful,
      accurate: parsed.accurate,
      feedback_note: parsed.note ?? null,
      feedback_updated_at: feedbackUpdatedAt
    })
    .eq("athlete_id", args.athleteId)
    .eq("week_start", parsed.weekStart)
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Weekly Debrief must be generated before feedback can be saved.");
  }

  return normalizePersistedArtifact(data as WeeklyDebriefRecord, data.status);
}

export async function getAdjacentWeeklyDebriefs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
}) {
  const [{ data: prevData, error: prevError }, { data: nextData, error: nextError }] = await Promise.all([
    args.supabase
      .from("weekly_debriefs")
      .select("week_start")
      .eq("athlete_id", args.athleteId)
      .lt("week_start", args.weekStart)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    args.supabase
      .from("weekly_debriefs")
      .select("week_start")
      .eq("athlete_id", args.athleteId)
      .gt("week_start", args.weekStart)
      .order("week_start", { ascending: true })
      .limit(1)
      .maybeSingle()
  ]);

  if (prevError) throw new Error(prevError.message);
  if (nextError) throw new Error(nextError.message);

  return {
    previousWeekStart: prevData?.week_start ?? null,
    nextWeekStart: nextData?.week_start ?? null
  };
}
