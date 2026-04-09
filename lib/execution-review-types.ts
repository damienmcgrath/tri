import { z } from "zod";
import type { Sport } from "@/lib/coach/session-diagnosis";

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
    /** Duration-weighted average power from work-interval laps only. */
    avgIntervalPower?: number | null;
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
    sessionIntent?: string | null;
    whatHappened: string;
    whyItMatters: string;
    oneThingToChange?: string | null;
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
  avgIntervalPower?: number | null;
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

export const coachVerdictSchema = z.object({
  sessionVerdict: z.object({
    headline: z.string().min(1).max(160),
    summary: z.string().min(1).max(500),
    intentMatch: z.enum(["on_target", "partial", "missed"]),
    executionCost: z.enum(["low", "moderate", "high", "unknown"]),
    confidence: z.enum(["high", "medium", "low"]),
    nextCall: z.enum(["move_on", "proceed_with_caution", "repeat_session", "protect_recovery", "adjust_next_key_session"])
  }),
  explanation: z.object({
    sessionIntent: z.string().min(1).max(300).nullable().optional(),
    whatHappened: z.string().min(1).max(500),
    whyItMatters: z.string().min(1).max(500),
    oneThingToChange: z.string().min(1).max(500).nullable().optional(),
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

export const COACH_VERDICT_EXAMPLE: CoachVerdict = {
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

export const COACH_VERDICT_JSON_EXAMPLE = JSON.stringify(COACH_VERDICT_EXAMPLE, null, 2);
