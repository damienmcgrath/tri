import type { Sport } from "@/lib/coach/session-diagnosis";
import type {
  EvidenceQualityState,
  MissingEvidenceReason,
  ReviewOutcomeState
} from "@/lib/training/semantics";

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
    splitMetrics: {
      firstHalfAvgHr?: number;
      lastHalfAvgHr?: number;
      firstHalfAvgPower?: number;
      lastHalfAvgPower?: number;
      firstHalfPaceSPerKm?: number;
      lastHalfPaceSPerKm?: number;
    } | null;
  };
  detectedIssues: Array<{
    code: string;
    severity: "low" | "moderate" | "high";
    supportingMetrics: string[];
  }>;
  missingEvidence: MissingEvidenceReason[];
  rulesSummary: {
    intentMatch: "on_target" | "partial" | "missed";
    executionScore: number | null;
    executionScoreBand: "On target" | "Partial match" | "Missed intent" | null;
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
    whatHappened: string;
    whyItMatters: string;
    whatToDoNextTime: string;
    whatToDoThisWeek: string;
  };
  uncertainty: {
    label: "confident_read" | "early_read" | "insufficient_data";
    detail: string;
    missingEvidence: MissingEvidenceReason[];
  };
  citedEvidence: Array<{
    claim: string;
    support: string[];
  }>;
};

export type PersistedReviewMetric = {
  label: string;
  planned: string;
  actual: string;
  note?: string;
  tone: "neutral" | "success" | "warning" | "attention";
};

export type PersistedReviewSummary = {
  headline: string;
  summary: string;
  outcome: ReviewOutcomeState;
  confidence: EvidenceQualityState;
  evidenceQuality: EvidenceQualityState;
  primaryGap: string;
  keyIssues: string[];
  intendedStimulus: string;
  actualExecution: string;
  didStimulusLand: "yes" | "partially" | "no";
  recommendation: string;
  weekRecommendation: string;
  effectOnWeek: "small" | "moderate" | "significant";
  stimulusImpact: "low" | "medium" | "high";
  missingEvidenceReasons: MissingEvidenceReason[];
  metrics: PersistedReviewMetric[];
};

export type PersistedExecutionReview = {
  version: 2;
  linkedActivityId: string | null;
  deterministic: ExecutionEvidence;
  verdict: CoachVerdict | null;
  weeklyImpact: {
    suggestedWeekAction: string;
    suggestedNextCall: "move_on" | "proceed_with_caution" | "repeat_session" | "protect_recovery" | "adjust_next_key_session";
  } | null;
  createdAt: string;
  updatedAt: string;
  status: "matched_intent" | "partial_intent" | "missed_intent";
  intentMatchStatus: "matched_intent" | "partial_intent" | "missed_intent";
  executionScore: number | null;
  executionScoreBand: "On target" | "Partial match" | "Missed intent" | null;
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
  firstHalfAvgHr: number | null;
  lastHalfAvgHr: number | null;
  firstHalfPaceSPerKm: number | null;
  lastHalfPaceSPerKm: number | null;
  executionCost: "low" | "moderate" | "high" | "unknown";
  missingEvidence: MissingEvidenceReason[];
  review_summary?: PersistedReviewSummary;
};

export function parsePersistedExecutionReview(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.version === 2 && payload.deterministic && typeof payload.deterministic === "object") {
    return payload as PersistedExecutionReview;
  }
  return null;
}
