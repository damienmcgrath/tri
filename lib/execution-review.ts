import "openai/shims/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getCoachModel, getCoachRequestTimeoutMs, getOpenAIClient, extractJsonObject, asObject, asString, asStringArray, clip } from "@/lib/openai";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { diagnoseCompletedSession, type SessionDiagnosisInput, type Sport } from "@/lib/coach/session-diagnosis";

export type ExecutionEvidence = {
  sessionId: string;
  athleteId: string;
  sport: Sport;
  planned: {
    title: string;
    intentCategory: string | null;
    durationSec: number | null;
    targetBands: {
      hr?: { min?: number; max?: number };
      power?: { min?: number; max?: number };
      pace?: { min?: number; max?: number };
    } | null;
    plannedIntervals: number | null;
    plannedStructure: string | null;
    sessionRole: "key" | "supporting" | "recovery" | "unknown";
  };
  actual: {
    durationSec: number | null;
    avgHr: number | null;
    avgPower: number | null;
    avgPaceSPerKm: number | null;
    timeAboveTargetPct: number | null;
    intervalCompletionPct: number | null;
    variabilityIndex: number | null;
    normalizedPower?: number | null;
    trainingStressScore?: number | null;
    intensityFactor?: number | null;
    totalWorkKj?: number | null;
    avgCadence?: number | null;
    avgPacePer100mSec?: number | null;
    bestPacePer100mSec?: number | null;
    avgStrokeRateSpm?: number | null;
    maxStrokeRateSpm?: number | null;
    avgSwolf?: number | null;
    elevationGainM?: number | null;
    elevationLossM?: number | null;
    poolLengthM?: number | null;
    lengthCount?: number | null;
    hrZoneTimeSec?: number | null;
    paceZoneTimeSec?: number | null;
    maxHr?: number | null;
    maxPower?: number | null;
    maxCadence?: number | null;
    bestPaceSPerKm?: number | null;
    normalizedGradedPaceSPerKm?: number | null;
    aerobicTrainingEffect?: number | null;
    anaerobicTrainingEffect?: number | null;
    splitMetrics: {
      firstHalfAvgHr?: number;
      lastHalfAvgHr?: number;
      firstHalfAvgPower?: number;
      lastHalfAvgPower?: number;
      firstHalfPaceSPerKm?: number;
      lastHalfPaceSPerKm?: number;
      firstHalfAvgCadence?: number;
      lastHalfAvgCadence?: number;
      firstHalfPacePer100mSec?: number;
      lastHalfPacePer100mSec?: number;
      firstHalfStrokeRate?: number;
      lastHalfStrokeRate?: number;
    } | null;
    sportSpecific?: {
      run?: {
        avgPaceSPerKm: number | null;
        bestPaceSPerKm: number | null;
        normalizedGradedPaceSPerKm: number | null;
        avgHr: number | null;
        maxHr: number | null;
        hrZoneTimeSec: number | null;
        paceZoneTimeSec: number | null;
        avgCadence: number | null;
        maxCadence: number | null;
        elevationGainM: number | null;
        elevationLossM: number | null;
        trainingStressScore: number | null;
        aerobicTrainingEffect: number | null;
        anaerobicTrainingEffect: number | null;
        splitMetrics: ExecutionEvidence["actual"]["splitMetrics"];
      } | null;
      swim?: {
        avgPacePer100mSec: number | null;
        bestPacePer100mSec: number | null;
        avgStrokeRateSpm: number | null;
        maxStrokeRateSpm: number | null;
        avgSwolf: number | null;
        poolLengthM: number | null;
        lengthCount: number | null;
        paceZoneTimeSec: number | null;
        trainingStressScore: number | null;
        aerobicTrainingEffect: number | null;
        anaerobicTrainingEffect: number | null;
        splitMetrics: ExecutionEvidence["actual"]["splitMetrics"];
      } | null;
      bike?: {
        avgPower: number | null;
        normalizedPower: number | null;
        maxPower: number | null;
        intensityFactor: number | null;
        variabilityIndex: number | null;
        totalWorkKj: number | null;
        avgCadence: number | null;
        maxCadence: number | null;
        avgHr: number | null;
        maxHr: number | null;
        hrZoneTimeSec: number | null;
        trainingStressScore: number | null;
        aerobicTrainingEffect: number | null;
        anaerobicTrainingEffect: number | null;
        splitMetrics: ExecutionEvidence["actual"]["splitMetrics"];
      } | null;
      strength?: {
        durationSec: number | null;
        intervalCompletionPct: number | null;
        avgHr: number | null;
        maxHr: number | null;
        timeAboveTargetPct: number | null;
        trainingStressScore: number | null;
        aerobicTrainingEffect: number | null;
        anaerobicTrainingEffect: number | null;
      } | null;
    } | null;
  };
  detectedIssues: Array<{
    code: string;
    severity: "low" | "moderate" | "high";
    supportingMetrics: string[];
  }>;
  missingEvidence: string[];
  rulesSummary: {
    intentMatch: "on_target" | "partial" | "missed";
    executionScore: number | null;
    executionScoreBand: "On target" | "Solid" | "Partial match" | "Missed intent" | null;
    confidence: "high" | "medium" | "low";
    provisional: boolean;
    evidenceCount: number;
    executionCost: "low" | "moderate" | "high" | "unknown";
  };
};

export type CoachVerdict = {
  sessionVerdict: {
    headline: string;
    summary: string;
    intentMatch: "on_target" | "partial" | "missed";
    executionCost: "low" | "moderate" | "high" | "unknown";
    confidence: "high" | "medium" | "low";
    nextCall: "move_on" | "proceed_with_caution" | "repeat_session" | "protect_recovery" | "adjust_next_key_session";
  };
  explanation: {
    sessionIntent?: string;
    whatHappened: string;
    whyItMatters: string;
    oneThingToChange?: string;
    whatToDoNextTime: string;
    whatToDoThisWeek: string;
  };
  uncertainty: {
    label: "confident_read" | "early_read" | "insufficient_data";
    detail: string;
    missingEvidence: string[];
  };
  citedEvidence: Array<{
    claim: string;
    support: string[];
  }>;
};

export type WeeklyExecutionBrief = {
  weekHeadline: string;
  weekSummary: string;
  keyPositive: string | null;
  keyRisk: string | null;
  nextWeekDecision: string;
  trend: {
    reviewedCount: number;
    onTargetCount: number;
    partialCount: number;
    missedCount: number;
    provisionalCount: number;
  };
  sessionsNeedingAttention: Array<{
    sessionId: string;
    sessionName: string;
    scoreHeadline: string;
    reason: string;
  }>;
  confidenceNote: string | null;
};

export type PersistedExecutionReview = {
  version: 2;
  linkedActivityId: string | null;
  deterministic: ExecutionEvidence;
  verdict: CoachVerdict | null;
  narrativeSource: "ai" | "fallback" | "legacy_unknown";
  weeklyImpact: {
    suggestedWeekAction: string;
    suggestedNextCall: "move_on" | "proceed_with_caution" | "repeat_session" | "protect_recovery" | "adjust_next_key_session";
  } | null;
  createdAt: string;
  updatedAt: string;
  status: "matched_intent" | "partial_intent" | "missed_intent";
  intentMatchStatus: "matched_intent" | "partial_intent" | "missed_intent";
  executionScore: number | null;
  executionScoreBand: "On target" | "Solid" | "Partial match" | "Missed intent" | null;
  executionScoreSummary: string;
  executionSummary: string;
  summary: string;
  whyItMatters: string;
  recommendedNextAction: string;
  diagnosisConfidence: "high" | "medium" | "low";
  executionScoreProvisional: boolean;
  suggestedWeekAdjustment: string;
  evidence: string[];
  durationCompletion: number | null;
  intervalCompletionPct: number | null;
  timeAboveTargetPct: number | null;
  avgHr: number | null;
  avgPower: number | null;
  normalizedPower: number | null;
  trainingStressScore: number | null;
  intensityFactor: number | null;
  totalWorkKj: number | null;
  avgCadence: number | null;
  avgPacePer100mSec?: number | null;
  bestPacePer100mSec?: number | null;
  avgStrokeRateSpm?: number | null;
  maxStrokeRateSpm?: number | null;
  avgSwolf?: number | null;
  elevationGainM?: number | null;
  elevationLossM?: number | null;
  poolLengthM?: number | null;
  lengthCount?: number | null;
  hrZoneTimeSec?: number | null;
  paceZoneTimeSec?: number | null;
  maxHr: number | null;
  maxPower: number | null;
  firstHalfAvgHr: number | null;
  lastHalfAvgHr: number | null;
  firstHalfPaceSPerKm: number | null;
  lastHalfPaceSPerKm: number | null;
  firstHalfAvgCadence?: number | null;
  lastHalfAvgCadence?: number | null;
  firstHalfPacePer100mSec?: number | null;
  lastHalfPacePer100mSec?: number | null;
  firstHalfStrokeRate?: number | null;
  lastHalfStrokeRate?: number | null;
  executionCost: "low" | "moderate" | "high" | "unknown";
  missingEvidence: string[];
};

const coachVerdictSchema = z.object({
  sessionVerdict: z.object({
    headline: z.string().min(1).max(160),
    summary: z.string().min(1).max(500),
    intentMatch: z.enum(["on_target", "partial", "missed"]),
    executionCost: z.enum(["low", "moderate", "high", "unknown"]),
    confidence: z.enum(["high", "medium", "low"]),
    nextCall: z.enum(["move_on", "proceed_with_caution", "repeat_session", "protect_recovery", "adjust_next_key_session"])
  }),
  explanation: z.object({
    sessionIntent: z.string().min(1).max(300).optional(),
    whatHappened: z.string().min(1).max(500),
    whyItMatters: z.string().min(1).max(500),
    oneThingToChange: z.string().min(1).max(500).optional(),
    whatToDoNextTime: z.string().min(1).max(500),
    whatToDoThisWeek: z.string().min(1).max(500)
  }),
  uncertainty: z.object({
    label: z.enum(["confident_read", "early_read", "insufficient_data"]),
    detail: z.string().min(1).max(500),
    missingEvidence: z.array(z.string().min(1)).max(8)
  }),
  citedEvidence: z.array(z.object({
    claim: z.string().min(1).max(200),
    support: z.array(z.string().min(1).max(180)).max(4)
  })).max(4)
});

const COACH_VERDICT_EXAMPLE: CoachVerdict = {
  sessionVerdict: {
    headline: "Intent partially landed",
    summary: "The session hit some of the intended stimulus, but late fade and incomplete work kept it from fully landing.",
    intentMatch: "partial",
    executionCost: "moderate",
    confidence: "medium",
    nextCall: "proceed_with_caution"
  },
  explanation: {
    sessionIntent: "Threshold intervals to push lactate clearance at race-relevant intensity.",
    whatHappened: "Intensity stayed 5% below target through the first 4 reps, then faded. The last 2 reps were incomplete.",
    whyItMatters: "That means the session delivered some useful stimulus, but not the precise version the week was counting on.",
    oneThingToChange: "NEXT threshold intervals: hold 165-175 bpm for all 6 reps. Success: complete the full set without fade. Start 2% easier on rep 1.",
    whatToDoNextTime: "Start the first work block a touch easier so you can hold form and finish the full set.",
    whatToDoThisWeek: "Keep the next key session on the calendar, but avoid forcing progression if fatigue is still lingering."
  },
  uncertainty: {
    label: "early_read",
    detail: "This read is useful, but it is still limited by missing split or interval detail.",
    missingEvidence: ["split comparison"]
  },
  citedEvidence: [
    {
      claim: "Late fade showed up in the second half.",
      support: ["Second-half pace slowed versus the first half", "Interval completion was below plan"]
    }
  ]
};

const COACH_VERDICT_JSON_EXAMPLE = JSON.stringify(COACH_VERDICT_EXAMPLE, null, 2);

function toIntentMatch(status: "matched_intent" | "partial_intent" | "missed_intent") {
  if (status === "matched_intent") return "on_target" as const;
  if (status === "missed_intent") return "missed" as const;
  return "partial" as const;
}

function toLegacyStatus(status: "on_target" | "partial" | "missed") {
  if (status === "on_target") return "matched_intent" as const;
  if (status === "missed") return "missed_intent" as const;
  return "partial_intent" as const;
}

function deriveMissingEvidence(input: SessionDiagnosisInput) {
  const missing: string[] = [];
  if (!input.actual.durationSec) missing.push("completed duration");
  if (input.planned.plannedIntervals && input.actual.intervalCompletionPct === null && input.actual.completedIntervals === null) missing.push("interval completion");
  if (!input.actual.avgHr && !input.actual.avgPower && !input.actual.avgPaceSPerKm) missing.push("intensity data");
  if (!input.actual.splitMetrics || Object.keys(input.actual.splitMetrics).length === 0) missing.push("split comparison");
  return missing;
}

function getIssueSeverity(code: string) {
  if (["too_hard", "incomplete_reps", "faded_late", "started_too_hard"].includes(code)) return "high" as const;
  if (["high_hr", "under_target", "over_target", "shortened", "late_drift"].includes(code)) return "moderate" as const;
  return "low" as const;
}

function getActualMetric(input: SessionDiagnosisInput["actual"], key: string) {
  const value = input.metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildSportSpecificEvidence(input: SessionDiagnosisInput): ExecutionEvidence["actual"]["sportSpecific"] {
  const splitMetrics = input.actual.splitMetrics ?? null;
  const avgHr = input.actual.avgHr ?? null;
  const maxHr = getActualMetric(input.actual, "max_hr");
  const trainingStressScore = getActualMetric(input.actual, "training_stress_score");
  const aerobicTrainingEffect = getActualMetric(input.actual, "aerobic_training_effect");
  const anaerobicTrainingEffect = getActualMetric(input.actual, "anaerobic_training_effect");

  switch (input.planned.sport ?? "other") {
    case "run":
      return {
        run: {
          avgPaceSPerKm: input.actual.avgPaceSPerKm ?? null,
          bestPaceSPerKm: getActualMetric(input.actual, "best_pace_s_per_km"),
          normalizedGradedPaceSPerKm: getActualMetric(input.actual, "normalized_graded_pace_s_per_km"),
          avgHr,
          maxHr,
          hrZoneTimeSec: getActualMetric(input.actual, "hr_zone_time_sec"),
          paceZoneTimeSec: getActualMetric(input.actual, "pace_zone_time_sec"),
          avgCadence: getActualMetric(input.actual, "avg_cadence"),
          maxCadence: getActualMetric(input.actual, "max_cadence"),
          elevationGainM: getActualMetric(input.actual, "elevation_gain_m"),
          elevationLossM: getActualMetric(input.actual, "elevation_loss_m"),
          trainingStressScore,
          aerobicTrainingEffect,
          anaerobicTrainingEffect,
          splitMetrics
        }
      };
    case "swim":
      return {
        swim: {
          avgPacePer100mSec: getActualMetric(input.actual, "avg_pace_per_100m_sec"),
          bestPacePer100mSec: getActualMetric(input.actual, "best_pace_per_100m_sec"),
          avgStrokeRateSpm: getActualMetric(input.actual, "avg_stroke_rate_spm"),
          maxStrokeRateSpm: getActualMetric(input.actual, "max_stroke_rate_spm"),
          avgSwolf: getActualMetric(input.actual, "avg_swolf"),
          poolLengthM: getActualMetric(input.actual, "pool_length_m"),
          lengthCount: getActualMetric(input.actual, "length_count"),
          paceZoneTimeSec: getActualMetric(input.actual, "pace_zone_time_sec"),
          trainingStressScore,
          aerobicTrainingEffect,
          anaerobicTrainingEffect,
          splitMetrics
        }
      };
    case "bike":
      return {
        bike: {
          avgPower: input.actual.avgPower ?? null,
          normalizedPower: getActualMetric(input.actual, "normalized_power"),
          maxPower: getActualMetric(input.actual, "max_power"),
          intensityFactor: getActualMetric(input.actual, "intensity_factor"),
          variabilityIndex: input.actual.variabilityIndex ?? null,
          totalWorkKj: getActualMetric(input.actual, "total_work_kj"),
          avgCadence: getActualMetric(input.actual, "avg_cadence"),
          maxCadence: getActualMetric(input.actual, "max_cadence"),
          avgHr,
          maxHr,
          hrZoneTimeSec: getActualMetric(input.actual, "hr_zone_time_sec"),
          trainingStressScore,
          aerobicTrainingEffect,
          anaerobicTrainingEffect,
          splitMetrics
        }
      };
    case "strength":
      return {
        strength: {
          durationSec: input.actual.durationSec ?? null,
          intervalCompletionPct: input.actual.intervalCompletionPct ?? null,
          avgHr,
          maxHr,
          timeAboveTargetPct: input.actual.timeAboveTargetPct ?? null,
          trainingStressScore,
          aerobicTrainingEffect,
          anaerobicTrainingEffect
        }
      };
    default:
      return null;
  }
}

function buildActualEvidence(input: SessionDiagnosisInput): ExecutionEvidence["actual"] {
  return {
    durationSec: input.actual.durationSec ?? null,
    avgHr: input.actual.avgHr ?? null,
    avgPower: input.actual.avgPower ?? null,
    avgPaceSPerKm: input.actual.avgPaceSPerKm ?? null,
    timeAboveTargetPct: input.actual.timeAboveTargetPct ?? null,
    intervalCompletionPct: input.actual.intervalCompletionPct ?? null,
    variabilityIndex: input.actual.variabilityIndex ?? null,
    normalizedPower: getActualMetric(input.actual, "normalized_power"),
    trainingStressScore: getActualMetric(input.actual, "training_stress_score"),
    intensityFactor: getActualMetric(input.actual, "intensity_factor"),
    totalWorkKj: getActualMetric(input.actual, "total_work_kj"),
    avgCadence: getActualMetric(input.actual, "avg_cadence"),
    maxCadence: getActualMetric(input.actual, "max_cadence"),
    bestPaceSPerKm: getActualMetric(input.actual, "best_pace_s_per_km"),
    normalizedGradedPaceSPerKm: getActualMetric(input.actual, "normalized_graded_pace_s_per_km"),
    avgPacePer100mSec: getActualMetric(input.actual, "avg_pace_per_100m_sec"),
    bestPacePer100mSec: getActualMetric(input.actual, "best_pace_per_100m_sec"),
    avgStrokeRateSpm: getActualMetric(input.actual, "avg_stroke_rate_spm"),
    maxStrokeRateSpm: getActualMetric(input.actual, "max_stroke_rate_spm"),
    avgSwolf: getActualMetric(input.actual, "avg_swolf"),
    elevationGainM: getActualMetric(input.actual, "elevation_gain_m"),
    elevationLossM: getActualMetric(input.actual, "elevation_loss_m"),
    poolLengthM: getActualMetric(input.actual, "pool_length_m"),
    lengthCount: getActualMetric(input.actual, "length_count"),
    hrZoneTimeSec: getActualMetric(input.actual, "hr_zone_time_sec"),
    paceZoneTimeSec: getActualMetric(input.actual, "pace_zone_time_sec"),
    maxHr: getActualMetric(input.actual, "max_hr"),
    maxPower: getActualMetric(input.actual, "max_power"),
    aerobicTrainingEffect: getActualMetric(input.actual, "aerobic_training_effect"),
    anaerobicTrainingEffect: getActualMetric(input.actual, "anaerobic_training_effect"),
    splitMetrics: input.actual.splitMetrics ?? null,
    sportSpecific: buildSportSpecificEvidence(input)
  };
}

// asObject, asString, asStringArray, clip are now imported from @/lib/openai

function normalizeNextCall(value: unknown): CoachVerdict["sessionVerdict"]["nextCall"] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "move_on" ||
    normalized === "proceed_with_caution" ||
    normalized === "repeat_session" ||
    normalized === "protect_recovery" ||
    normalized === "adjust_next_key_session"
  ) {
    return normalized;
  }
  if (normalized === "proceed" || normalized === "continue" || normalized === "carry_on") {
    return "proceed_with_caution";
  }
  if (normalized === "moveon" || normalized === "move") {
    return "move_on";
  }
  if (normalized === "repeat") {
    return "repeat_session";
  }
  if (normalized === "recover" || normalized === "protect") {
    return "protect_recovery";
  }
  if (normalized === "adjust_next_session" || normalized === "adjust") {
    return "adjust_next_key_session";
  }
  return null;
}

function normalizeSessionVerdictFields(
  sessionVerdict: Record<string, unknown>,
  defaults?: {
    intentMatch: CoachVerdict["sessionVerdict"]["intentMatch"];
    executionCost: CoachVerdict["sessionVerdict"]["executionCost"];
    nextCall: CoachVerdict["sessionVerdict"]["nextCall"];
  }
): Record<string, unknown> {
  return {
    ...sessionVerdict,
    intentMatch: sessionVerdict.intentMatch ?? defaults?.intentMatch,
    executionCost: sessionVerdict.executionCost ?? defaults?.executionCost,
    nextCall: normalizeNextCall(sessionVerdict.nextCall) ?? sessionVerdict.nextCall ?? defaults?.nextCall
  };
}

function normalizeCoachVerdictPayload(
  payload: unknown,
  defaults?: {
    intentMatch: CoachVerdict["sessionVerdict"]["intentMatch"];
    executionCost: CoachVerdict["sessionVerdict"]["executionCost"];
    nextCall: CoachVerdict["sessionVerdict"]["nextCall"];
  }
): unknown {
  const root = asObject(payload);
  if (!root) return payload;

  if ("sessionVerdict" in root || "explanation" in root || "uncertainty" in root || "citedEvidence" in root) {
    const sessionVerdict = asObject(root.sessionVerdict);
    if (!sessionVerdict) return root;
    return {
      ...root,
      sessionVerdict: normalizeSessionVerdictFields(sessionVerdict, defaults)
    };
  }

  for (const key of ["verdict", "review", "coachVerdict", "coach_verdict", "result", "data", "output"]) {
    const candidate = asObject(root[key]);
    if (!candidate) continue;
    if ("sessionVerdict" in candidate || "explanation" in candidate || "uncertainty" in candidate || "citedEvidence" in candidate) {
      const sessionVerdict = asObject(candidate.sessionVerdict);
      return {
        ...candidate,
        sessionVerdict: sessionVerdict
          ? normalizeSessionVerdictFields(sessionVerdict, defaults)
          : candidate.sessionVerdict
      };
    }
  }

  const summary = asString(root.summary);
  const whatHappened = asString(root.whatHappened);
  const whyItMatters = asString(root.interpretation_for_session) ?? asString(root.interpretationForSession);
  const whatToDoThisWeek = asString(root.what_this_means_for_the_week) ?? asString(root.whatThisMeansForTheWeek);
  const practicalNextSteps = asObject(root.practical_next_steps) ?? asObject(root.practicalNextSteps);
  const nextTime =
    asString(practicalNextSteps?.next_session) ??
    asString(practicalNextSteps?.nextSession) ??
    asString(root.next_session) ??
    asString(root.nextSession);
  const thisWeek =
    asString(practicalNextSteps?.this_week) ??
    asString(practicalNextSteps?.thisWeek) ??
    whatToDoThisWeek;
  const uncertaintyBlock = asObject(root.constraints_and_uncertainties) ?? asObject(root.constraintsAndUncertainties);
  const questionsBlock = asObject(root.questions_for_you) ?? asObject(root.questionsForYou);
  const confidence = asString(root.confidence);

  if (summary || whatHappened || whyItMatters || thisWeek || nextTime) {
    const missingEvidence = [
      ...asStringArray(uncertaintyBlock?.missingEvidence),
      ...asStringArray(uncertaintyBlock?.missing_evidence)
    ].slice(0, 8);
    const uncertaintyDetailParts = [
      asString(uncertaintyBlock?.summary),
      asString(uncertaintyBlock?.detail),
      ...asStringArray(questionsBlock?.items),
      ...asStringArray(questionsBlock?.questions)
    ].filter((item): item is string => item !== null);

    return {
      sessionVerdict: {
        headline: clip(summary ?? "Session review", 160),
        summary: clip(summary ?? whatHappened ?? "Execution evidence is available for review.", 500),
        intentMatch: defaults?.intentMatch ?? "partial",
        executionCost: defaults?.executionCost ?? "unknown",
        confidence: confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "medium",
        nextCall: defaults?.nextCall ?? "proceed_with_caution"
      },
      explanation: {
        whatHappened: clip(whatHappened ?? summary ?? "Execution evidence is available for review.", 500),
        whyItMatters: clip(whyItMatters ?? "Use this review conservatively and in the context of the rest of the week.", 500),
        whatToDoNextTime: clip(nextTime ?? "Use one clear execution cue on the next similar session.", 500),
        whatToDoThisWeek: clip(thisWeek ?? "Keep the rest of the week stable and use this review as guidance for the next similar session.", 500)
      },
      uncertainty: {
        label: missingEvidence.length > 0 || uncertaintyDetailParts.length > 0 ? "early_read" : "confident_read",
        detail: clip(
          uncertaintyDetailParts.join(" ").trim() || "This read is grounded in the available execution evidence.",
          500
        ),
        missingEvidence
      },
      citedEvidence: summary
        ? [{
            claim: clip(summary, 200),
            support: [clip(whatHappened ?? whyItMatters ?? summary, 180)]
          }]
        : []
    };
  }

  return payload;
}

function coerceCoachVerdictPayload(
  payload: unknown,
  defaults: {
    intentMatch: CoachVerdict["sessionVerdict"]["intentMatch"];
    executionCost: CoachVerdict["sessionVerdict"]["executionCost"];
    nextCall: CoachVerdict["sessionVerdict"]["nextCall"];
  }
) {
  const normalizedPayload = normalizeCoachVerdictPayload(payload, defaults);
  const parsed = coachVerdictSchema.safeParse(normalizedPayload);
  return {
    normalizedPayload,
    parsed
  };
}

function formatSecondsToDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const totalMin = Math.round(sec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

function formatSecondsToPacePerKm(sec: number): string {
  const totalSec = Math.round(sec);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}/km`;
}

function normalizeUnitString(text: string): string {
  // Replace bare seconds (e.g. "2,239 s", "2239s", "37.5 s") — not s/km
  let result = text.replace(/(\d[\d,]*(?:\.\d+)?)\s*s\b(?!\/km)/g, (_match, numStr: string) => {
    const sec = parseFloat(numStr.replace(/,/g, ""));
    return formatSecondsToDuration(sec);
  });
  // Replace pace in s/km (e.g. "341.63 s/km", "341 s/km")
  result = result.replace(/(\d+(?:\.\d+)?)\s*s\/km/g, (_match, numStr: string) => {
    return formatSecondsToPacePerKm(parseFloat(numStr));
  });
  return result;
}

export function normalizeVerdictUnitsForTest(text: string): string {
  return normalizeUnitString(text);
}

function normalizeVerdictUnits(verdict: CoachVerdict): CoachVerdict {
  const n = normalizeUnitString;
  return {
    ...verdict,
    sessionVerdict: {
      ...verdict.sessionVerdict,
      headline: n(verdict.sessionVerdict.headline),
      summary: n(verdict.sessionVerdict.summary)
    },
    explanation: {
      ...(verdict.explanation.sessionIntent ? { sessionIntent: n(verdict.explanation.sessionIntent) } : {}),
      whatHappened: n(verdict.explanation.whatHappened),
      whyItMatters: n(verdict.explanation.whyItMatters),
      ...(verdict.explanation.oneThingToChange ? { oneThingToChange: n(verdict.explanation.oneThingToChange) } : {}),
      whatToDoNextTime: n(verdict.explanation.whatToDoNextTime),
      whatToDoThisWeek: n(verdict.explanation.whatToDoThisWeek)
    },
    uncertainty: {
      ...verdict.uncertainty,
      detail: n(verdict.uncertainty.detail)
    },
    citedEvidence: verdict.citedEvidence.map((e) => ({
      claim: n(e.claim),
      support: e.support.map(n)
    }))
  };
}

export function coerceCoachVerdictPayloadForTest(
  payload: unknown,
  defaults: {
    intentMatch: CoachVerdict["sessionVerdict"]["intentMatch"];
    executionCost: CoachVerdict["sessionVerdict"]["executionCost"];
    nextCall: CoachVerdict["sessionVerdict"]["nextCall"];
  }
) {
  return coerceCoachVerdictPayload(payload, defaults);
}

function buildCoachVerdictInstructions() {
  return [
    "You are an endurance coach helping athletes interpret completed workouts.",
    "Use only the provided evidence and context.",
    "Do not invent metrics, missing facts, unsupported causes, or unsupported comparisons.",
    "Return exactly one JSON object that matches the required schema below.",
    "Do not wrap the object in keys like data, review, result, output, or verdict.",
    "Do not rename any keys.",
    "Keep enum values exactly as specified.",
    "Keep `citedEvidence` as an array of objects with `claim` and `support` only.",
    "Keep each `support` entry as a plain string, not an object.",
    "If evidence is limited, reflect that in `uncertainty` and keep recommendations conservative.",
    "If you mention shorthand metrics such as IF, VI, SWOLF, TSS, or training effect, explain them in plain athlete-friendly language in the same sentence.",
    "Express durations in minutes (e.g. '37 min', '1 h 15 min'). Never write raw seconds.",
    "Express run pace as min:sec/km (e.g. '5:41/km'). Never write raw seconds per km.",
    "",
    "Prescriptive review rules:",
    "- Speak with direct authority. State findings. Do not hedge.",
    "- Never lead with duration comparison. Evaluate intensity compliance first, pacing second, duration third.",
    "- For interval sessions: evaluate interval quality before mentioning whether all were completed.",
    "- For endurance sessions: evaluate intensity compliance before mentioning duration.",
    "- For 90+ scores: say 'Maintain this approach. Same targets next time.' in oneThingToChange.",
    "- For scores below 90: use the NEXT format: 'NEXT [session type]: [specific target]. [success criterion]. [progression cue].'",
    "- Do not use words like 'appears', 'seems', 'might', 'possibly', 'likely'. State what the data shows.",
    "",
    "Field requirements:",
    "- `sessionVerdict.headline`: short label, max 160 chars.",
    "- `sessionVerdict.summary`: one concise session verdict, max 500 chars.",
    "- `sessionVerdict.intentMatch`: must match the provided deterministic intent result.",
    "- `sessionVerdict.executionCost`: must stay consistent with the provided deterministic execution cost.",
    "- `sessionVerdict.nextCall`: choose one allowed enum only.",
    "- `explanation.sessionIntent` (optional): one sentence on the physiological purpose of this session, max 300 chars.",
    "- `explanation.whatHappened`: factual session read evaluating intensity first, pacing second, duration third. Max 500 chars.",
    "- `explanation.whyItMatters`: what it means for adaptation or the week, max 500 chars.",
    "- `explanation.oneThingToChange` (optional): single concrete instruction using NEXT format, max 500 chars.",
    "- `explanation.whatToDoNextTime`: one practical cue for the next similar session, max 500 chars.",
    "- `explanation.whatToDoThisWeek`: how to handle the rest of this week, max 500 chars.",
    "- `uncertainty.label`: one of `confident_read`, `early_read`, `insufficient_data`.",
    "- `uncertainty.detail`: explain the confidence level plainly, max 500 chars.",
    "- `uncertainty.missingEvidence`: array of missing evidence strings, max 8 items.",
    "- `citedEvidence`: max 4 items.",
    "- `citedEvidence[].claim`: max 200 chars.",
    "- `citedEvidence[].support`: max 4 short support strings, each max 180 chars.",
    "Required output schema example:",
    COACH_VERDICT_JSON_EXAMPLE
  ].join("\n");
}

function deriveExecutionCost(params: {
  timeAboveTargetPct: number | null;
  hrDrift: number | null;
  paceFade: number | null;
  intervalCompletionPct: number | null;
  durationCompletion: number | null;
  fatigue: number | null;
}) {
  let burden = 0;
  if ((params.timeAboveTargetPct ?? 0) >= 0.25) burden += 2;
  if ((params.hrDrift ?? 1) > 1.06) burden += 2;
  if ((params.paceFade ?? 1) > 1.1) burden += 2;
  if ((params.intervalCompletionPct ?? 1) < 0.85) burden += 1;
  if ((params.durationCompletion ?? 1) < 0.9) burden += 1;
  if ((params.fatigue ?? 0) >= 4) burden += 1;
  if (burden >= 5) return "high" as const;
  if (burden >= 2) return "moderate" as const;
  if (burden === 0) return "low" as const;
  return "moderate" as const;
}

function buildEvidenceSummary(evidence: ExecutionEvidence) {
  const points: string[] = [];
  if (evidence.actual.intervalCompletionPct !== null) {
    points.push(`${Math.round(evidence.actual.intervalCompletionPct * 100)}% of planned reps completed`);
  }
  if (evidence.actual.timeAboveTargetPct !== null) {
    points.push(`${Math.round(evidence.actual.timeAboveTargetPct * 100)}% above target`);
  }
  if (evidence.actual.avgHr !== null) {
    points.push(`average HR ${Math.round(evidence.actual.avgHr)} bpm`);
  }
  if (evidence.actual.avgPower !== null) {
    points.push(`average power ${Math.round(evidence.actual.avgPower)} w`);
  }
  if (typeof evidence.actual.normalizedPower === "number") {
    points.push(`normalized power ${Math.round(evidence.actual.normalizedPower)} w`);
  }
  if (typeof evidence.actual.variabilityIndex === "number") {
    points.push(`VI ${evidence.actual.variabilityIndex.toFixed(2)}`);
  }
  if (typeof evidence.actual.trainingStressScore === "number") {
    points.push(`TSS ${Math.round(evidence.actual.trainingStressScore)}`);
  }
  return points.slice(0, 4);
}

function nextCallFromEvidence(intentMatch: "on_target" | "partial" | "missed", executionCost: "low" | "moderate" | "high" | "unknown") {
  if (intentMatch === "on_target" && executionCost === "low") return "move_on" as const;
  if (intentMatch === "missed" && executionCost === "high") return "protect_recovery" as const;
  if (intentMatch === "missed") return "repeat_session" as const;
  if (executionCost === "high") return "adjust_next_key_session" as const;
  return "proceed_with_caution" as const;
}

function buildDeterministicVerdict(evidence: ExecutionEvidence): CoachVerdict {
  const intentMatch = evidence.rulesSummary.intentMatch;
  const nextCall = nextCallFromEvidence(intentMatch, evidence.rulesSummary.executionCost);
  const confidence = evidence.rulesSummary.confidence;
  const summary =
    intentMatch === "on_target"
      ? "The intended training purpose appears to have landed with controlled execution."
      : intentMatch === "missed"
        ? "The session came up short of its intended purpose, so the next call should stay conservative."
        : "Some of the intended stimulus landed, but key parts of the execution were uneven.";
  const uncertaintyLabel =
    confidence === "high"
      ? "confident_read"
      : evidence.rulesSummary.evidenceCount > 0
        ? "early_read"
        : "insufficient_data";

  return {
    sessionVerdict: {
      headline:
        intentMatch === "on_target"
          ? "Intent landed"
          : intentMatch === "missed"
            ? "Intent came up short"
            : "Intent only partially landed",
      summary,
      intentMatch,
      executionCost: evidence.rulesSummary.executionCost,
      confidence,
      nextCall
    },
    explanation: {
      sessionIntent: evidence.planned.intentCategory
        ? `${evidence.planned.intentCategory} — targeting the planned training stimulus for this session.`
        : undefined,
      whatHappened: evidence.detectedIssues.length > 0
        ? `Key execution issues: ${evidence.detectedIssues.slice(0, 2).map((issue) => issue.code.replaceAll("_", " ")).join(", ")}.`
        : "Execution stayed close to the planned session targets.",
      whyItMatters:
        intentMatch === "on_target"
          ? "Matching the planned intent protects the adaptation you wanted from the day and supports the rest of the week."
          : "When execution drifts, the session can stop delivering the precise stimulus the week depends on.",
      oneThingToChange:
        intentMatch === "on_target"
          ? "Maintain this approach. Same targets next time."
          : intentMatch === "missed"
            ? `NEXT ${evidence.planned.intentCategory ?? "session"}: start more conservatively and protect the key work before adding intensity.`
            : `NEXT ${evidence.planned.intentCategory ?? "session"}: tighten control earlier in the session.`,
      whatToDoNextTime:
        intentMatch === "on_target"
          ? "Repeat the same pacing and control on the next similar session."
          : intentMatch === "missed"
            ? "Start more conservatively and protect the key work before adding intensity."
            : "Keep one clear execution cue in mind and tighten control earlier in the session.",
      whatToDoThisWeek:
        nextCall === "protect_recovery"
          ? "Protect recovery and avoid adding extra load off this one session."
          : nextCall === "repeat_session"
            ? "Keep the week steady and consider repeating the intent before progressing."
            : nextCall === "adjust_next_key_session"
              ? "Keep the next key session controlled rather than forcing progression."
              : "Move into the rest of the week as planned."
    },
    uncertainty: {
      label: uncertaintyLabel,
      detail:
        uncertaintyLabel === "confident_read"
          ? "This read is grounded in enough execution evidence to be used with confidence."
          : uncertaintyLabel === "early_read"
            ? "This is a useful early read, but some execution details are still missing."
            : "There is not enough execution detail to support a strong coaching judgment.",
      missingEvidence: evidence.missingEvidence
    },
    citedEvidence: [
      {
        claim:
          intentMatch === "on_target"
            ? "The session mostly matched the planned intent."
            : intentMatch === "missed"
              ? "The session missed the intended training purpose."
              : "The session only partially matched the planned intent.",
        support: buildEvidenceSummary(evidence)
      }
    ]
  };
}

export function buildExecutionEvidence(args: {
  athleteId: string;
  sessionId: string;
  sessionTitle: string;
  sessionRole?: string | null;
  plannedStructure?: string | null;
  diagnosisInput: SessionDiagnosisInput;
  weeklyState?: { fatigue: number | null } | null;
}) {
  const diagnosis = diagnoseCompletedSession(args.diagnosisInput);
  const firstHalfHr = args.diagnosisInput.actual.splitMetrics?.firstHalfAvgHr ?? null;
  const lastHalfHr = args.diagnosisInput.actual.splitMetrics?.lastHalfAvgHr ?? null;
  const firstHalfPace = args.diagnosisInput.actual.splitMetrics?.firstHalfPaceSPerKm ?? null;
  const lastHalfPace = args.diagnosisInput.actual.splitMetrics?.lastHalfPaceSPerKm ?? null;
  const hrDrift = firstHalfHr && lastHalfHr ? lastHalfHr / firstHalfHr : null;
  const paceFade = firstHalfPace && lastHalfPace ? lastHalfPace / firstHalfPace : null;
  const durationCompletion =
    args.diagnosisInput.actual.durationSec && args.diagnosisInput.planned.plannedDurationSec
      ? args.diagnosisInput.actual.durationSec / args.diagnosisInput.planned.plannedDurationSec
      : null;
  const issues = diagnosis.detectedIssues.map((code) => ({
    code,
    severity: getIssueSeverity(code),
    supportingMetrics: buildEvidenceSummary({
      sessionId: args.sessionId,
      athleteId: args.athleteId,
      sport: args.diagnosisInput.planned.sport ?? "other",
      planned: {
        title: args.sessionTitle,
        intentCategory: args.diagnosisInput.planned.intentCategory ?? null,
        durationSec: args.diagnosisInput.planned.plannedDurationSec ?? null,
        targetBands: args.diagnosisInput.planned.targetBands ?? null,
        plannedIntervals: args.diagnosisInput.planned.plannedIntervals ?? null,
        plannedStructure: args.plannedStructure ?? null,
        sessionRole: args.sessionRole === "key" || args.sessionRole === "supporting" || args.sessionRole === "recovery" ? args.sessionRole : "unknown"
      },
      actual: buildActualEvidence(args.diagnosisInput),
      detectedIssues: [],
      missingEvidence: [],
      rulesSummary: {
        intentMatch: "partial",
        executionScore: null,
        executionScoreBand: null,
        confidence: "low",
        provisional: true,
        evidenceCount: 0,
        executionCost: "unknown"
      }
    })
  }));

  const executionCost = deriveExecutionCost({
    timeAboveTargetPct: args.diagnosisInput.actual.timeAboveTargetPct ?? null,
    hrDrift,
    paceFade,
    intervalCompletionPct: args.diagnosisInput.actual.intervalCompletionPct ?? null,
    durationCompletion,
    fatigue: args.weeklyState?.fatigue ?? null
  });

  return {
    diagnosis,
    evidence: {
      sessionId: args.sessionId,
      athleteId: args.athleteId,
      sport: args.diagnosisInput.planned.sport ?? "other",
      planned: {
        title: args.sessionTitle,
        intentCategory: args.diagnosisInput.planned.intentCategory ?? null,
        durationSec: args.diagnosisInput.planned.plannedDurationSec ?? null,
        targetBands: args.diagnosisInput.planned.targetBands ?? null,
        plannedIntervals: args.diagnosisInput.planned.plannedIntervals ?? null,
        plannedStructure: args.plannedStructure ?? null,
        sessionRole: args.sessionRole === "key" || args.sessionRole === "supporting" || args.sessionRole === "recovery" ? args.sessionRole : "unknown"
      },
      actual: buildActualEvidence(args.diagnosisInput),
      detectedIssues: issues,
      missingEvidence: deriveMissingEvidence(args.diagnosisInput),
      rulesSummary: {
        intentMatch: toIntentMatch(diagnosis.intentMatchStatus),
        executionScore: diagnosis.executionScore,
        executionScoreBand: diagnosis.executionScoreBand,
        confidence: diagnosis.diagnosisConfidence,
        provisional: diagnosis.executionScoreProvisional,
        evidenceCount: diagnosis.evidenceCount,
        executionCost
      }
    } satisfies ExecutionEvidence
  };
}

export async function generateCoachVerdict(args: {
  evidence: ExecutionEvidence;
  athleteContext: AthleteContextSnapshot | null;
  recentReviewedSessions: Array<{ sessionId: string; headline: string; intentMatch: string }>;
}) {
  const deterministicFallback = buildDeterministicVerdict(args.evidence);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("[session-review-ai] Falling back to deterministic review: missing OPENAI_API_KEY", {
      sessionId: args.evidence.sessionId
    });
    return { verdict: deterministicFallback, source: "fallback" as const };
  }

  try {
    const client = getOpenAIClient();
    const timeoutMs = getCoachRequestTimeoutMs();
    const startedAt = Date.now();
    const response = await client.responses.create(
      {
        model: getCoachModel(),
        instructions: buildCoachVerdictInstructions(),
        reasoning: { effort: "low" },
        max_output_tokens: 1600,
        text: {
          format: zodTextFormat(coachVerdictSchema, "session_coach_verdict", {
            description: "Structured session review verdict."
          })
        },
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  sessionEvidence: args.evidence,
                  athleteContext: args.athleteContext,
                  recentReviewedSessions: args.recentReviewedSessions
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
      console.warn("[session-review-ai] Falling back to deterministic review: empty model output", {
        sessionId: args.evidence.sessionId,
        incompleteReason: response.incomplete_details?.reason ?? null,
        elapsedMs: Date.now() - startedAt
      });
      return { verdict: deterministicFallback, source: "fallback" as const };
    }
    const parsedJson = extractJsonObject(text);
    if (parsedJson == null) {
      console.warn("[session-review-ai] Falling back to deterministic review: could not parse model output as JSON", {
        sessionId: args.evidence.sessionId,
        incompleteReason: response.incomplete_details?.reason ?? null,
        outputLength: text.length,
        elapsedMs: Date.now() - startedAt,
      });
      return { verdict: deterministicFallback, source: "fallback" as const };
    }

    const { normalizedPayload, parsed } = coerceCoachVerdictPayload(parsedJson, {
      intentMatch: args.evidence.rulesSummary.intentMatch,
      executionCost: args.evidence.rulesSummary.executionCost,
      nextCall: nextCallFromEvidence(args.evidence.rulesSummary.intentMatch, args.evidence.rulesSummary.executionCost)
    });
    if (!parsed.success) {
      const payloadKeys = Object.keys(asObject(parsedJson) ?? {});
      const normalizedKeys = Object.keys(asObject(normalizedPayload) ?? {});
      console.warn("[session-review-ai] Falling back to deterministic review: model JSON failed schema validation", {
        sessionId: args.evidence.sessionId,
        incompleteReason: response.incomplete_details?.reason ?? null,
        elapsedMs: Date.now() - startedAt,
        payloadKeys,
        normalizedKeys,
        formErrors: parsed.error.flatten().formErrors,
        fieldErrors: parsed.error.flatten().fieldErrors
      });
      return { verdict: deterministicFallback, source: "fallback" as const };
    }
    const deterministicConfidence = args.evidence.rulesSummary.confidence;
    if (deterministicConfidence !== "low" && parsed.data.sessionVerdict.intentMatch !== args.evidence.rulesSummary.intentMatch) {
      console.warn("[session-review-ai] Falling back to deterministic review: model intent match disagreed with deterministic diagnosis", {
        sessionId: args.evidence.sessionId,
        elapsedMs: Date.now() - startedAt,
        modelIntentMatch: parsed.data.sessionVerdict.intentMatch,
        deterministicIntentMatch: args.evidence.rulesSummary.intentMatch
      });
      return { verdict: deterministicFallback, source: "fallback" as const };
    }
    return { verdict: normalizeVerdictUnits(parsed.data), source: "ai" as const };
  } catch (error) {
    const timeoutMs = getCoachRequestTimeoutMs();
    const message =
      error instanceof Error && error.message === "Request timed out."
        ? `OpenAI request timed out after ${Math.round(timeoutMs / 1000)}s`
        : error instanceof Error
          ? error.message
          : String(error);
    console.warn("[session-review-ai] Falling back to deterministic review: model request failed", {
      sessionId: args.evidence.sessionId,
      timeoutMs,
      error: message
    });
    return { verdict: deterministicFallback, source: "fallback" as const };
  }
}

export function toPersistedExecutionReview(args: {
  linkedActivityId: string | null;
  evidence: ExecutionEvidence;
  verdict: CoachVerdict | null;
  narrativeSource?: "ai" | "fallback" | "legacy_unknown";
  createdAt?: string;
  updatedAt?: string;
}): PersistedExecutionReview {
  const createdAt = args.createdAt ?? new Date().toISOString();
  const updatedAt = args.updatedAt ?? createdAt;
  const legacyStatus = toLegacyStatus(args.evidence.rulesSummary.intentMatch);
  const nextCall = args.verdict?.sessionVerdict.nextCall ?? nextCallFromEvidence(args.evidence.rulesSummary.intentMatch, args.evidence.rulesSummary.executionCost);
  const suggestedWeekAction = args.verdict?.explanation.whatToDoThisWeek ?? "Keep the rest of the week stable and use this review as guidance for the next similar session.";

  return {
    version: 2,
    linkedActivityId: args.linkedActivityId,
    deterministic: args.evidence,
    verdict: args.verdict,
    narrativeSource: args.narrativeSource ?? (args.verdict ? "fallback" : "legacy_unknown"),
    weeklyImpact: {
      suggestedWeekAction,
      suggestedNextCall: nextCall
    },
    createdAt,
    updatedAt,
    status: legacyStatus,
    intentMatchStatus: legacyStatus,
    executionScore: args.evidence.rulesSummary.executionScore,
    executionScoreBand: args.evidence.rulesSummary.executionScoreBand,
    executionScoreSummary: args.verdict?.sessionVerdict.summary ?? "Execution evidence is available for review.",
    executionSummary: args.verdict?.explanation.whatHappened ?? "Execution evidence is available for review.",
    summary: args.verdict?.sessionVerdict.summary ?? "Execution evidence is available for review.",
    whyItMatters: args.verdict?.explanation.whyItMatters ?? "Use this review conservatively and in the context of the rest of the week.",
    recommendedNextAction: args.verdict?.explanation.whatToDoNextTime ?? "Use one clear execution cue on the next similar session.",
    diagnosisConfidence: args.evidence.rulesSummary.confidence,
    executionScoreProvisional: args.evidence.rulesSummary.provisional,
    suggestedWeekAdjustment: suggestedWeekAction,
    evidence: args.verdict?.citedEvidence.flatMap((item) => item.support).slice(0, 4) ?? buildEvidenceSummary(args.evidence),
    durationCompletion:
      args.evidence.actual.durationSec && args.evidence.planned.durationSec
        ? Number((args.evidence.actual.durationSec / args.evidence.planned.durationSec).toFixed(2))
        : null,
    intervalCompletionPct: args.evidence.actual.intervalCompletionPct,
    timeAboveTargetPct: args.evidence.actual.timeAboveTargetPct,
    avgHr: args.evidence.actual.avgHr,
    avgPower: args.evidence.actual.avgPower,
    normalizedPower: args.evidence.actual.normalizedPower ?? null,
    trainingStressScore: args.evidence.actual.trainingStressScore ?? null,
    intensityFactor: args.evidence.actual.intensityFactor ?? null,
    totalWorkKj: args.evidence.actual.totalWorkKj ?? null,
    avgCadence: args.evidence.actual.avgCadence ?? null,
    avgPacePer100mSec: args.evidence.actual.avgPacePer100mSec ?? null,
    bestPacePer100mSec: args.evidence.actual.bestPacePer100mSec ?? null,
    avgStrokeRateSpm: args.evidence.actual.avgStrokeRateSpm ?? null,
    maxStrokeRateSpm: args.evidence.actual.maxStrokeRateSpm ?? null,
    avgSwolf: args.evidence.actual.avgSwolf ?? null,
    elevationGainM: args.evidence.actual.elevationGainM ?? null,
    elevationLossM: args.evidence.actual.elevationLossM ?? null,
    poolLengthM: args.evidence.actual.poolLengthM ?? null,
    lengthCount: args.evidence.actual.lengthCount ?? null,
    hrZoneTimeSec: args.evidence.actual.hrZoneTimeSec ?? null,
    paceZoneTimeSec: args.evidence.actual.paceZoneTimeSec ?? null,
    maxHr: args.evidence.actual.maxHr ?? null,
    maxPower: args.evidence.actual.maxPower ?? null,
    firstHalfAvgHr: args.evidence.actual.splitMetrics?.firstHalfAvgHr ?? null,
    lastHalfAvgHr: args.evidence.actual.splitMetrics?.lastHalfAvgHr ?? null,
    firstHalfPaceSPerKm: args.evidence.actual.splitMetrics?.firstHalfPaceSPerKm ?? null,
    lastHalfPaceSPerKm: args.evidence.actual.splitMetrics?.lastHalfPaceSPerKm ?? null,
    firstHalfAvgCadence: args.evidence.actual.splitMetrics?.firstHalfAvgCadence ?? null,
    lastHalfAvgCadence: args.evidence.actual.splitMetrics?.lastHalfAvgCadence ?? null,
    firstHalfPacePer100mSec: args.evidence.actual.splitMetrics?.firstHalfPacePer100mSec ?? null,
    lastHalfPacePer100mSec: args.evidence.actual.splitMetrics?.lastHalfPacePer100mSec ?? null,
    firstHalfStrokeRate: args.evidence.actual.splitMetrics?.firstHalfStrokeRate ?? null,
    lastHalfStrokeRate: args.evidence.actual.splitMetrics?.lastHalfStrokeRate ?? null,
    executionCost: args.evidence.rulesSummary.executionCost,
    missingEvidence: args.evidence.missingEvidence
  };
}

export function parsePersistedExecutionReview(payload: Record<string, unknown> | null | undefined): PersistedExecutionReview | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.version === 2 && payload.deterministic && typeof payload.deterministic === "object") {
    const narrativeSource: PersistedExecutionReview["narrativeSource"] =
      payload.narrativeSource === "ai" || payload.narrativeSource === "fallback" || payload.narrativeSource === "legacy_unknown"
        ? payload.narrativeSource
        : "legacy_unknown";
    return {
      ...(payload as unknown as PersistedExecutionReview),
      narrativeSource
    };
  }
  return null;
}

export async function refreshObservedPatterns(supabase: SupabaseClient, athleteId: string) {
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id,date,execution_result")
    .or(`athlete_id.eq.${athleteId},user_id.eq.${athleteId}`)
    .not("execution_result", "is", null)
    .order("date", { ascending: false })
    .limit(30);

  if (error) {
    throw new Error(error.message);
  }

  const support = new Map<string, { label: string; detail: string; sourceSessionIds: string[] }>();
  for (const session of sessions ?? []) {
    const review = parsePersistedExecutionReview(session.execution_result as Record<string, unknown> | null);
    if (!review) continue;
    for (const issue of review.deterministic.detectedIssues) {
      const existing = support.get(issue.code) ?? {
        label: issue.code.replaceAll("_", " "),
        detail: `This pattern has shown up across multiple reviewed sessions: ${issue.code.replaceAll("_", " ")}.`,
        sourceSessionIds: []
      };
      existing.sourceSessionIds.push(session.id);
      support.set(issue.code, existing);
    }
  }

  const repeated = [...support.entries()].filter(([, value]) => value.sourceSessionIds.length >= 2);
  for (const [patternKey, value] of repeated) {
    const supportCount = value.sourceSessionIds.length;
    const confidence = supportCount >= 4 ? "high" : supportCount >= 3 ? "medium" : "low";
    const { error: upsertError } = await supabase.from("athlete_observed_patterns").upsert({
      athlete_id: athleteId,
      pattern_key: patternKey,
      label: value.label,
      detail: value.detail,
      support_count: supportCount,
      confidence,
      last_observed_at: new Date().toISOString(),
      source_session_ids: value.sourceSessionIds
    }, {
      onConflict: "athlete_id,pattern_key"
    });
    if (upsertError) {
      throw new Error(upsertError.message);
    }
  }
}

export async function buildWeeklyExecutionBrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  athleteContext: AthleteContextSnapshot | null;
  extraActivityCount?: number;
}) {
  const { data: sessions, error } = await args.supabase
    .from("sessions")
    .select("id,session_name,type,date,execution_result")
    .or(`athlete_id.eq.${args.athleteId},user_id.eq.${args.athleteId}`)
    .gte("date", args.weekStart)
    .lte("date", args.weekEnd)
    .not("execution_result", "is", null)
    .order("date", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const reviews = (sessions ?? [])
    .map((session) => {
      const review = parsePersistedExecutionReview(session.execution_result as Record<string, unknown> | null);
      if (!review) return null;
      return {
        id: session.id,
        name: (session.session_name ?? session.type ?? "Session").trim(),
        review
      };
    })
    .filter((item): item is { id: string; name: string; review: PersistedExecutionReview } => Boolean(item));

  const reviewedCount = reviews.length;
  const onTargetCount = reviews.filter((item) => item.review.deterministic.rulesSummary.intentMatch === "on_target").length;
  const partialCount = reviews.filter((item) => item.review.deterministic.rulesSummary.intentMatch === "partial").length;
  const missedCount = reviews.filter((item) => item.review.deterministic.rulesSummary.intentMatch === "missed").length;
  const provisionalCount = reviews.filter((item) => item.review.deterministic.rulesSummary.provisional).length;

  const sessionsNeedingAttention = reviews
    .filter((item) => item.review.deterministic.rulesSummary.intentMatch !== "on_target")
    .slice(0, 3)
    .map((item) => ({
      sessionId: item.id,
      sessionName: item.name,
      scoreHeadline: item.review.verdict?.sessionVerdict.headline ?? item.review.executionScoreSummary,
      reason: item.review.verdict?.explanation.whyItMatters ?? item.review.whyItMatters
    }));

  const keyPositive = onTargetCount > 0 ? `${onTargetCount} reviewed session${onTargetCount === 1 ? "" : "s"} are landing on target.` : null;
  const keyRisk = sessionsNeedingAttention[0]?.reason ?? null;
  const nextWeekDecision =
    missedCount > 0
      ? "Keep the next key session controlled and protect recovery rather than adding load."
      : partialCount > 0
        ? "Progress only if the next key session lands cleanly."
        : "Keep the current structure and carry the same execution control into next week.";

  const contextCue = args.athleteContext?.declared.weeklyConstraints[0] ?? args.athleteContext?.declared.limiters[0]?.value ?? null;
  const extraCount = args.extraActivityCount ?? 0;
  const extraNote = extraCount > 0 ? ` ${extraCount} extra session${extraCount === 1 ? "" : "s"} also logged this week.` : "";

  return {
    weekHeadline:
      reviewedCount === 0
        ? extraCount > 0
          ? `${extraCount} extra session${extraCount === 1 ? "" : "s"} logged — reviews building`
          : "Reviews are still building, so keep the week steady"
        : missedCount > 0
          ? "Execution is mostly on track, but one key session came up short"
          : partialCount > 0
            ? "Execution is on track overall, with a few sessions needing attention"
            : "Execution is on track this week",
    weekSummary:
      reviewedCount === 0
        ? `Early uploads are in.${extraNote} Hold the current structure for now, then let the next reviewed sessions sharpen the call.`
        : `${extraCount > 0 ? `${extraCount} extra ${extraCount === 1 ? "session" : "sessions"} also logged this week.` : "Execution reviewed against this week's training intent."}${contextCue ? ` ${contextCue} noted.` : ""}`,
    keyPositive,
    keyRisk,
    nextWeekDecision,
    trend: {
      reviewedCount,
      onTargetCount,
      partialCount,
      missedCount,
      provisionalCount
    },
    sessionsNeedingAttention,
    confidenceNote:
      provisionalCount > 0
        ? `${provisionalCount} review${provisionalCount === 1 ? "" : "s"} are still provisional because evidence is incomplete.`
        : null
  } satisfies WeeklyExecutionBrief;
}
