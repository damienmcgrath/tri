import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getCoachModel, getOpenAIClient } from "@/lib/openai";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { diagnoseCompletedSession, type SessionDiagnosisInput, type Sport } from "@/lib/coach/session-diagnosis";
import {
  MISSING_EVIDENCE_REASONS,
  type EvidenceQualityState,
  type MissingEvidenceReason,
  type ReviewOutcomeState
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
    whatHappened: z.string().min(1).max(500),
    whyItMatters: z.string().min(1).max(500),
    whatToDoNextTime: z.string().min(1).max(500),
    whatToDoThisWeek: z.string().min(1).max(500)
  }),
  uncertainty: z.object({
    label: z.enum(["confident_read", "early_read", "insufficient_data"]),
    detail: z.string().min(1).max(500),
    missingEvidence: z.array(z.enum(MISSING_EVIDENCE_REASONS)).max(8)
  }),
  citedEvidence: z.array(z.object({
    claim: z.string().min(1).max(200),
    support: z.array(z.string().min(1).max(180)).max(4)
  })).max(4)
});

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
  const missing: MissingEvidenceReason[] = [];
  if (input.planned.plannedIntervals && input.actual.intervalCompletionPct === null && input.actual.completedIntervals === null) {
    missing.push("no_interval_structure_match");
  }
  if (!input.actual.avgHr && !input.actual.avgPower && !input.actual.avgPaceSPerKm) {
    missing.push("summary_only_upload");
  }
  if (!input.actual.splitMetrics || Object.keys(input.actual.splitMetrics).length === 0) {
    missing.push("no_split_data");
  }
  if (!input.planned.targetBands || Object.keys(input.planned.targetBands).length === 0) {
    missing.push("missing_target_zones");
  }
  return missing;
}

function getIssueSeverity(code: string) {
  if (["too_hard", "incomplete_reps", "faded_late", "started_too_hard"].includes(code)) return "high" as const;
  if (["high_hr", "under_target", "over_target", "shortened", "late_drift"].includes(code)) return "moderate" as const;
  return "low" as const;
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
  return points.slice(0, 4);
}

function toReviewOutcomeState(intentMatch: "on_target" | "partial" | "missed"): ReviewOutcomeState {
  if (intentMatch === "on_target") return "on_target";
  if (intentMatch === "missed") return "missed_intent";
  return "partial_match";
}

function deriveReviewConfidence(evidence: ExecutionEvidence): EvidenceQualityState {
  const supportingSignals = [
    evidence.actual.durationSec !== null,
    evidence.actual.intervalCompletionPct !== null || evidence.planned.plannedIntervals === null,
    evidence.actual.timeAboveTargetPct !== null || evidence.actual.avgHr !== null || evidence.actual.avgPower !== null,
    Boolean(evidence.actual.splitMetrics && Object.keys(evidence.actual.splitMetrics).length > 0)
  ].filter(Boolean).length;

  if (supportingSignals >= 3) return "high";
  if (supportingSignals >= 2) return "medium";
  return "low";
}

function formatDurationSeconds(seconds: number | null) {
  if (!seconds || seconds <= 0) return "—";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function buildReviewMetrics(evidence: ExecutionEvidence): PersistedReviewMetric[] {
  const metrics: PersistedReviewMetric[] = [];
  const durationCompletion =
    evidence.actual.durationSec !== null && evidence.planned.durationSec
      ? Number((evidence.actual.durationSec / evidence.planned.durationSec).toFixed(2))
      : null;

  if (evidence.planned.durationSec || evidence.actual.durationSec) {
    metrics.push({
      label: "Duration",
      planned: formatDurationSeconds(evidence.planned.durationSec),
      actual: formatDurationSeconds(evidence.actual.durationSec),
      note: durationCompletion !== null ? `${formatPercent(durationCompletion)} of planned duration` : undefined,
      tone:
        durationCompletion === null
          ? "neutral"
          : durationCompletion >= 0.9
            ? "success"
            : durationCompletion >= 0.85
              ? "warning"
              : "attention"
    });
  }

  if (evidence.planned.plannedIntervals !== null || evidence.actual.intervalCompletionPct !== null) {
    metrics.push({
      label: "Structure",
      planned: evidence.planned.plannedIntervals !== null ? `${evidence.planned.plannedIntervals} planned blocks` : "Planned blocks",
      actual:
        evidence.planned.plannedIntervals !== null && evidence.actual.intervalCompletionPct !== null
          ? `${Math.round(evidence.actual.intervalCompletionPct * evidence.planned.plannedIntervals)} of ${evidence.planned.plannedIntervals} blocks`
          : formatPercent(evidence.actual.intervalCompletionPct),
      note: evidence.actual.intervalCompletionPct !== null ? `${formatPercent(evidence.actual.intervalCompletionPct)} of the planned structure` : undefined,
      tone:
        evidence.actual.intervalCompletionPct === null
          ? "neutral"
          : evidence.actual.intervalCompletionPct >= 0.9
            ? "success"
            : evidence.actual.intervalCompletionPct >= 0.85
              ? "warning"
              : "attention"
    });
  }

  if (evidence.actual.timeAboveTargetPct !== null) {
    metrics.push({
      label: "Target control",
      planned: "Stay near target",
      actual: `${formatPercent(1 - evidence.actual.timeAboveTargetPct)} within target`,
      note: `${formatPercent(evidence.actual.timeAboveTargetPct)} above target`,
      tone:
        evidence.actual.timeAboveTargetPct <= 0.1
          ? "success"
          : evidence.actual.timeAboveTargetPct <= 0.2
            ? "warning"
            : "attention"
    });
  }

  if (evidence.actual.splitMetrics?.firstHalfAvgHr && evidence.actual.splitMetrics?.lastHalfAvgHr) {
    const drift = evidence.actual.splitMetrics.lastHalfAvgHr / evidence.actual.splitMetrics.firstHalfAvgHr;
    metrics.push({
      label: "Late HR drift",
      planned: "Controlled through the finish",
      actual: `${Math.round(evidence.actual.splitMetrics.lastHalfAvgHr - evidence.actual.splitMetrics.firstHalfAvgHr)} bpm rise`,
      note: `${formatPercent(drift - 1)} drift`,
      tone: drift <= 1.04 ? "success" : drift <= 1.08 ? "warning" : "attention"
    });
  } else if (evidence.actual.splitMetrics?.firstHalfPaceSPerKm && evidence.actual.splitMetrics?.lastHalfPaceSPerKm) {
    const fade = evidence.actual.splitMetrics.lastHalfPaceSPerKm / evidence.actual.splitMetrics.firstHalfPaceSPerKm;
    metrics.push({
      label: "Late-session fade",
      planned: "Hold pace late",
      actual: `${formatPercent(fade - 1)} slower late`,
      tone: fade <= 1.04 ? "success" : fade <= 1.1 ? "warning" : "attention"
    });
  }

  return metrics;
}

function buildPersistedReviewSummary(args: {
  evidence: ExecutionEvidence;
  verdict: CoachVerdict | null;
  suggestedWeekAction: string;
}): PersistedReviewSummary {
  const outcome = toReviewOutcomeState(args.evidence.rulesSummary.intentMatch);
  const confidence = deriveReviewConfidence(args.evidence);
  const metrics = buildReviewMetrics(args.evidence);
  const keyIssues = args.evidence.detectedIssues.map((issue) => issue.code.replaceAll("_", " "));
  const summary =
    args.verdict?.sessionVerdict.summary ??
    (outcome === "on_target"
      ? "The intended session stimulus landed cleanly."
      : outcome === "partial_match"
        ? "The session was completed, but the intended stimulus only partially landed."
        : "The intended session stimulus did not land cleanly enough to count as planned.");

  return {
    headline:
      outcome === "on_target"
        ? "On target"
        : outcome === "partial_match"
          ? "Partial match"
          : "Missed intent",
    summary,
    outcome,
    confidence,
    evidenceQuality: confidence,
    primaryGap:
      args.verdict?.explanation.whatHappened ??
      (keyIssues.length > 0 ? `Primary gap: ${keyIssues[0]}.` : "Execution drifted away from the planned session."),
    keyIssues,
    intendedStimulus: args.evidence.planned.intentCategory ?? args.evidence.planned.title,
    actualExecution: args.verdict?.explanation.whatHappened ?? "Execution evidence is available for review.",
    didStimulusLand: outcome === "on_target" ? "yes" : outcome === "partial_match" ? "partially" : "no",
    recommendation: args.verdict?.explanation.whatToDoNextTime ?? "Use one clear execution cue on the next similar session.",
    weekRecommendation: args.suggestedWeekAction,
    effectOnWeek:
      outcome === "on_target"
        ? "small"
        : outcome === "missed_intent" || args.evidence.rulesSummary.executionCost === "high"
          ? "significant"
          : "moderate",
    stimulusImpact:
      outcome === "on_target"
        ? "low"
        : outcome === "missed_intent"
          ? "high"
          : "medium",
    missingEvidenceReasons: args.evidence.missingEvidence,
    metrics
  };
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
      whatHappened: evidence.detectedIssues.length > 0
        ? `Key execution issues: ${evidence.detectedIssues.slice(0, 2).map((issue) => issue.code.replaceAll("_", " ")).join(", ")}.`
        : "Execution stayed close to the planned session targets.",
      whyItMatters:
        intentMatch === "on_target"
          ? "Matching the planned intent protects the adaptation you wanted from the day and supports the rest of the week."
          : "When execution drifts, the session can stop delivering the precise stimulus the week depends on.",
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
        sessionRole: args.sessionRole === "key" || args.sessionRole === "supporting" || args.sessionRole === "recovery" ? args.sessionRole : "unknown"
      },
      actual: {
        durationSec: args.diagnosisInput.actual.durationSec ?? null,
        avgHr: args.diagnosisInput.actual.avgHr ?? null,
        avgPower: args.diagnosisInput.actual.avgPower ?? null,
        avgPaceSPerKm: args.diagnosisInput.actual.avgPaceSPerKm ?? null,
        timeAboveTargetPct: args.diagnosisInput.actual.timeAboveTargetPct ?? null,
        intervalCompletionPct: args.diagnosisInput.actual.intervalCompletionPct ?? null,
        variabilityIndex: args.diagnosisInput.actual.variabilityIndex ?? null,
        splitMetrics: args.diagnosisInput.actual.splitMetrics ?? null
      },
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
        sessionRole: args.sessionRole === "key" || args.sessionRole === "supporting" || args.sessionRole === "recovery" ? args.sessionRole : "unknown"
      },
      actual: {
        durationSec: args.diagnosisInput.actual.durationSec ?? null,
        avgHr: args.diagnosisInput.actual.avgHr ?? null,
        avgPower: args.diagnosisInput.actual.avgPower ?? null,
        avgPaceSPerKm: args.diagnosisInput.actual.avgPaceSPerKm ?? null,
        timeAboveTargetPct: args.diagnosisInput.actual.timeAboveTargetPct ?? null,
        intervalCompletionPct: args.diagnosisInput.actual.intervalCompletionPct ?? null,
        variabilityIndex: args.diagnosisInput.actual.variabilityIndex ?? null,
        splitMetrics: args.diagnosisInput.actual.splitMetrics ?? null
      },
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
    return deterministicFallback;
  }

  try {
    const client = getOpenAIClient();
    const response = await client.responses.create({
      model: getCoachModel(),
      instructions:
        "You are an endurance coach helping athletes interpret completed workouts. Use only the provided evidence and context. Do not invent metrics, missing facts, or unsupported causes. If evidence is limited, explain that clearly and keep recommendations conservative. Prefer practical next steps over generic motivation. Separate what happened in the session from what it means for the week. Return valid JSON only.",
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
    });
    const text = response.output_text?.trim();
    if (!text) {
      return deterministicFallback;
    }
    const parsed = coachVerdictSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return deterministicFallback;
    }
    if (parsed.data.sessionVerdict.intentMatch !== args.evidence.rulesSummary.intentMatch) {
      return deterministicFallback;
    }
    return parsed.data;
  } catch {
    return deterministicFallback;
  }
}

export function toPersistedExecutionReview(args: {
  linkedActivityId: string | null;
  evidence: ExecutionEvidence;
  verdict: CoachVerdict | null;
  createdAt?: string;
  updatedAt?: string;
}): PersistedExecutionReview {
  const createdAt = args.createdAt ?? new Date().toISOString();
  const updatedAt = args.updatedAt ?? createdAt;
  const legacyStatus = toLegacyStatus(args.evidence.rulesSummary.intentMatch);
  const nextCall = args.verdict?.sessionVerdict.nextCall ?? nextCallFromEvidence(args.evidence.rulesSummary.intentMatch, args.evidence.rulesSummary.executionCost);
  const suggestedWeekAction = args.verdict?.explanation.whatToDoThisWeek ?? "Keep the rest of the week stable and use this review as guidance for the next similar session.";
  const reviewSummary = buildPersistedReviewSummary({
    evidence: args.evidence,
    verdict: args.verdict,
    suggestedWeekAction
  });

  return {
    version: 2,
    linkedActivityId: args.linkedActivityId,
    deterministic: args.evidence,
    verdict: args.verdict,
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
    firstHalfAvgHr: args.evidence.actual.splitMetrics?.firstHalfAvgHr ?? null,
    lastHalfAvgHr: args.evidence.actual.splitMetrics?.lastHalfAvgHr ?? null,
    firstHalfPaceSPerKm: args.evidence.actual.splitMetrics?.firstHalfPaceSPerKm ?? null,
    lastHalfPaceSPerKm: args.evidence.actual.splitMetrics?.lastHalfPaceSPerKm ?? null,
    executionCost: args.evidence.rulesSummary.executionCost,
    missingEvidence: args.evidence.missingEvidence,
    review_summary: reviewSummary
  };
}

export function parsePersistedExecutionReview(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.version === 2 && payload.deterministic && typeof payload.deterministic === "object") {
    return payload as unknown as PersistedExecutionReview;
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
      scoreHeadline: item.review.review_summary?.headline ?? item.review.verdict?.sessionVerdict.headline ?? item.review.executionScoreSummary,
      reason: item.review.review_summary?.summary ?? item.review.verdict?.explanation.whyItMatters ?? item.review.whyItMatters
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

  return {
    weekHeadline:
      reviewedCount === 0
        ? "Reviews are still building, so keep the week steady"
        : missedCount > 0
          ? "Execution is mostly on track, but one key session came up short"
          : partialCount > 0
            ? "Execution is on track overall, with a few sessions needing attention"
            : "Execution is on track this week",
    weekSummary:
      reviewedCount === 0
        ? "Early uploads are in. Hold the current structure for now, then let the next reviewed sessions sharpen the call."
        : `${onTargetCount} reviewed session${onTargetCount === 1 ? "" : "s"} are on target, ${partialCount} partial, and ${missedCount} missed.${contextCue ? ` Current context: ${contextCue}.` : ""}`,
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
        ? `${provisionalCount} review${provisionalCount === 1 ? "" : "s"} are still early reads because some evidence is missing.`
        : null
  } satisfies WeeklyExecutionBrief;
}
