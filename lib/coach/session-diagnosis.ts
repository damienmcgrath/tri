import {
  evaluateEasyEndurance,
  evaluateLongEndurance,
  evaluateRecovery,
  evaluateSwimStrength,
  evaluateThreshold,
  evaluateUnknown,
  toIntentBucket
} from "./session-diagnosis-algorithm";
import {
  computeComponentScores,
  deriveExecutionScore,
  getConfidence,
  getExecutionScoreBand
} from "./session-diagnosis-scoring";
import { getNextAction, getSummary, getWhyItMatters } from "./session-diagnosis-formatters";

export type Sport = "swim" | "bike" | "run" | "strength" | "other";

export type IntentMatchStatus = "matched_intent" | "partial_intent" | "missed_intent";
export type DiagnosisConfidence = "high" | "medium" | "low";
export type ExecutionScoreBand = "On target" | "Solid" | "Partial match" | "Missed intent";

export type PlannedTargetBand = {
  hr?: { min?: number; max?: number };
  power?: { min?: number; max?: number };
  pace?: { min?: number; max?: number };
  /** Swim pace target in seconds per 100 m (e.g. 115 = 1:55/100m) */
  pace100m?: { min?: number; max?: number };
};

export type PlannedSessionDiagnosisInput = {
  sport?: Sport;
  plannedDurationSec?: number | null;
  intentCategory?: string | null;
  targetBands?: PlannedTargetBand | null;
  plannedIntervals?: number | null;
};

export type SplitMetrics = {
  firstHalfAvgHr?: number;
  lastHalfAvgHr?: number;
  firstHalfAvgPower?: number;
  lastHalfAvgPower?: number;
  firstHalfPaceSPerKm?: number;
  lastHalfPaceSPerKm?: number;
};

export type CompletedSessionDiagnosisInput = {
  durationSec?: number | null;
  avgHr?: number | null;
  avgPower?: number | null;
  /** Duration-weighted average power from work-interval laps only (excludes warm-up/cool-down/recovery). */
  avgIntervalPower?: number | null;
  avgPaceSPerKm?: number | null;
  variabilityIndex?: number | null;
  timeAboveTargetPct?: number | null;
  intervalCompletionPct?: number | null;
  completedIntervals?: number | null;
  splitMetrics?: SplitMetrics | null;
  metrics?: Record<string, number | null | undefined>;
};

export type SessionDiagnosisInput = {
  planned: PlannedSessionDiagnosisInput;
  actual: CompletedSessionDiagnosisInput;
  sessionTss?: number | null;
};

export type ComponentScore = {
  score: number;
  weight: number;
  detail: string;
  /** True when the score was capped below its natural value due to missing evidence. */
  capped?: boolean;
  /** Natural (pre-cap) score. Used by UI to render an uncertainty band from score → cap limit. */
  uncappedScore?: number;
};

export type ComponentScores = {
  intentMatch: ComponentScore;
  pacingExecution: ComponentScore;
  completion: ComponentScore;
  recoveryCompliance: ComponentScore;
  composite: number;
  dataCompletenessPct: number;
  missingCriticalData: string[];
  /** Name of the dominant intensity metric for this session when it was missing (e.g. "HR", "power"). */
  missingDominantMetric?: string | null;
};

export type SessionDiagnosis = {
  intentMatchStatus: IntentMatchStatus;
  executionScore: number | null;
  executionScoreBand: ExecutionScoreBand | null;
  executionScoreSummary: string;
  executionSummary: string;
  whyItMatters: string;
  recommendedNextAction: string;
  diagnosisConfidence: DiagnosisConfidence;
  executionScoreProvisional: boolean;
  detectedIssues: IssueKey[];
  evidenceCount: number;
  componentScores: ComponentScores | null;
};

export type IntentBucket =
  | "easy_endurance"
  | "recovery"
  | "threshold_quality"
  | "long_endurance"
  | "swim_strength"
  | "unknown";

export type IssueKey =
  | "too_hard"
  | "too_variable"
  | "high_hr"
  | "late_drift"
  | "under_target"
  | "over_target"
  | "incomplete_reps"
  | "shortened"
  | "inconsistent_execution"
  | "started_too_hard"
  | "faded_late"
  | "sparse_data";

export type DiagnosisDraft = {
  status: IntentMatchStatus;
  issues: IssueKey[];
  evidenceCount: number;
};

export function diagnoseCompletedSession(input: SessionDiagnosisInput): SessionDiagnosis {
  const bucket = toIntentBucket(input.planned);

  const draft =
    bucket === "easy_endurance"
      ? evaluateEasyEndurance(input)
      : bucket === "recovery"
        ? evaluateRecovery(input)
        : bucket === "threshold_quality"
          ? evaluateThreshold(input)
          : bucket === "long_endurance"
            ? evaluateLongEndurance(input)
            : bucket === "swim_strength"
              ? evaluateSwimStrength(input)
              : evaluateUnknown(input);

  const components = computeComponentScores(input, draft, bucket);
  // Provisional only when evidence is genuinely thin: <2 evidence items OR
  // data completeness below 60%. A fully-telemetered session should not be
  // labelled provisional just because its evidence count sits at the low end.
  const isProvisional = components
    ? draft.evidenceCount < 2 || components.dataCompletenessPct < 0.6
    : draft.evidenceCount < 2;
  const score = components
    ? { score: components.composite, band: getExecutionScoreBand(components.composite), provisional: isProvisional }
    : deriveExecutionScore(bucket, draft);
  const summary = getSummary(draft.status, draft.issues, bucket);

  return {
    intentMatchStatus: draft.status,
    executionScore: score.score,
    executionScoreBand: score.band,
    executionScoreSummary: summary,
    executionSummary: summary,
    whyItMatters: getWhyItMatters(draft.status, draft.issues, bucket),
    recommendedNextAction: getNextAction(draft.status, draft.issues, bucket),
    diagnosisConfidence: getConfidence(draft.evidenceCount),
    executionScoreProvisional: score.provisional,
    detectedIssues: [...new Set(draft.issues)],
    evidenceCount: draft.evidenceCount,
    componentScores: components
  };
}
