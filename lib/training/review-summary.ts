import { parsePersistedExecutionReview } from "@/lib/execution-review-shared";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import {
  getEvidenceQualityLabel,
  getMissingEvidenceLabel,
  getReviewOutcomeLabel,
  normalizeReviewOutcomeState,
  type EvidenceQualityState,
  type MissingEvidenceReason,
  type ReviewOutcomeState,
  type StateTone
} from "@/lib/training/semantics";

export type StimulusImpactLevel = "low" | "medium" | "high";
export type EffectOnWeek = "small" | "moderate" | "significant";
export type StimulusLandingState = "yes" | "partially" | "no";

export type IntentVsActualMetric = {
  label: string;
  planned: string;
  actual: string;
  note?: string;
  tone: StateTone;
};

export type NormalizedReviewSummary = {
  outcome: ReviewOutcomeState;
  outcomeLabel: string;
  confidence: EvidenceQualityState;
  confidenceLabel: string;
  evidenceQuality: EvidenceQualityState;
  evidenceQualityLabel: string;
  headline: string;
  summary: string;
  primaryGap: string;
  keyIssues: string[];
  intendedStimulus: string;
  actualExecution: string;
  didStimulusLand: StimulusLandingState;
  recommendation: string;
  weekRecommendation: string;
  stimulusImpact: StimulusImpactLevel;
  effectOnWeek: EffectOnWeek;
  missingEvidenceReasons: MissingEvidenceReason[];
  missingEvidenceLabels: string[];
  confidenceExplanation: string;
  metrics: IntentVsActualMetric[];
};

export type ReviewSummaryInput = {
  sport: string;
  type: string;
  sessionName?: string | null;
  intentCategory?: string | null;
  intentSummary?: string | null;
  target?: string | null;
  durationMinutes?: number | null;
  storedStatus?: "planned" | "completed" | "skipped" | null;
  executionResult?: Record<string, unknown> | null;
  hasLinkedActivity?: boolean;
  isExtra?: boolean;
};

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function formatDuration(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "—";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatDurationSeconds(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return "—";
  return formatDuration(seconds / 60);
}

function getString(source: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function getNumber(source: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeMissingEvidenceReason(value: string): MissingEvidenceReason | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "no_split_data" || normalized.includes("split")) return "no_split_data";
  if (normalized === "no_interval_structure_match" || normalized.includes("interval")) return "no_interval_structure_match";
  if (normalized === "missing_target_zones" || normalized.includes("target") || normalized.includes("zone")) return "missing_target_zones";
  if (normalized === "summary_only_upload" || normalized.includes("summary") || normalized.includes("intensity")) return "summary_only_upload";
  return null;
}

function humanizeIssue(issue: string) {
  return issue
    .replaceAll("_", " ")
    .replace(/\bhr\b/i, "HR")
    .replace(/\bftp\b/i, "FTP")
    .replace(/\bvo2\b/i, "VO2")
    .replace(/^./, (char) => char.toUpperCase());
}

function fallbackIntendedStimulus(input: ReviewSummaryInput) {
  if (input.isExtra) {
    return "Additional load outside the original plan.";
  }

  if (input.intentSummary?.trim()) return input.intentSummary.trim();
  if (input.intentCategory?.trim()) return input.intentCategory.trim();
  if (input.target?.trim()) return input.target.trim();
  return `${getDisciplineMeta(input.sport).label} session intent`;
}

function deriveDidStimulusLand(outcome: ReviewOutcomeState): StimulusLandingState {
  if (outcome === "on_target") return "yes";
  if (outcome === "partial_match") return "partially";
  return "no";
}

function deriveStimulusImpact(outcome: ReviewOutcomeState, keyIssues: string[], isExtra: boolean): StimulusImpactLevel {
  if (isExtra) return keyIssues.length > 0 ? "medium" : "low";
  if (outcome === "on_target") return "low";
  if (outcome === "missed_intent") return "high";
  return keyIssues.length >= 2 ? "high" : "medium";
}

function deriveEffectOnWeek(outcome: ReviewOutcomeState, keyIssues: string[], isKey: boolean, isExtra: boolean): EffectOnWeek {
  if (isExtra && keyIssues.length === 0) return "small";
  if (outcome === "on_target") return "small";
  if (outcome === "missed_intent" && isKey) return "significant";
  if (outcome === "missed_intent" || keyIssues.length >= 2) return "moderate";
  return "small";
}

function deriveEvidenceQuality(metrics: IntentVsActualMetric[], reasons: MissingEvidenceReason[]): EvidenceQualityState {
  if (metrics.length >= 3 && reasons.length <= 1) return "high";
  if (metrics.length >= 2) return "medium";
  return "low";
}

function buildConfidenceExplanation(quality: EvidenceQualityState, reasons: MissingEvidenceReason[]) {
  if (quality === "high") {
    return "Confidence is high because duration, structure, and execution detail all support the read.";
  }

  if (quality === "medium") {
    if (reasons.length === 0) {
      return "This is a useful read from the available data, even if one part of the evidence is still thin.";
    }
    return `Early read, still missing some data: ${reasons.map((reason) => getMissingEvidenceLabel(reason).toLowerCase()).join(", ")}.`;
  }

  if (reasons.length === 0) {
    return "Early read, still missing some data.";
  }

  return `Early read, still missing some data: ${reasons.map((reason) => getMissingEvidenceLabel(reason).toLowerCase()).join(", ")}.`;
}

function buildMetrics(input: ReviewSummaryInput, persisted: Record<string, unknown> | null | undefined) {
  const review = parsePersistedExecutionReview(input.executionResult);
  const plannedDuration = formatDuration(input.durationMinutes ?? null);
  const actualDurationSec =
    review?.deterministic.actual.durationSec ??
    getNumber(persisted, ["actualDurationSec", "actual_duration_sec"]);
  const durationCompletion =
    review?.durationCompletion ??
    getNumber(persisted, ["durationCompletion", "duration_completion"]);
  const intervalCompletion =
    review?.intervalCompletionPct ??
    getNumber(persisted, ["intervalCompletionPct", "interval_completion_pct"]);
  const plannedIntervals = review?.deterministic.planned.plannedIntervals ?? null;
  const timeAboveTarget =
    review?.timeAboveTargetPct ??
    getNumber(persisted, ["timeAboveTargetPct", "time_above_target_pct"]);
  const firstHalfHr = review?.firstHalfAvgHr ?? getNumber(persisted, ["firstHalfAvgHr", "first_half_avg_hr"]);
  const lastHalfHr = review?.lastHalfAvgHr ?? getNumber(persisted, ["lastHalfAvgHr", "last_half_avg_hr"]);
  const firstHalfPace =
    review?.firstHalfPaceSPerKm ?? getNumber(persisted, ["firstHalfPaceSPerKm", "first_half_pace_s_per_km"]);
  const lastHalfPace =
    review?.lastHalfPaceSPerKm ?? getNumber(persisted, ["lastHalfPaceSPerKm", "last_half_pace_s_per_km"]);

  const metrics: IntentVsActualMetric[] = [];

  if (input.durationMinutes || actualDurationSec) {
    metrics.push({
      label: "Duration",
      planned: plannedDuration,
      actual: formatDurationSeconds(actualDurationSec ?? null),
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

  if (plannedIntervals !== null || intervalCompletion !== null) {
    metrics.push({
      label: "Structure",
      planned: plannedIntervals !== null ? `${plannedIntervals} planned blocks` : "Planned blocks",
      actual:
        plannedIntervals !== null && intervalCompletion !== null
          ? `${Math.round(intervalCompletion * plannedIntervals)} of ${plannedIntervals} blocks`
          : intervalCompletion !== null
            ? formatPercent(intervalCompletion)
            : "—",
      note: intervalCompletion !== null ? `${formatPercent(intervalCompletion)} of the planned structure` : undefined,
      tone:
        intervalCompletion === null
          ? "neutral"
          : intervalCompletion >= 0.9
            ? "success"
            : intervalCompletion >= 0.85
              ? "warning"
              : "attention"
    });
  }

  if (timeAboveTarget !== null) {
    metrics.push({
      label: "Target control",
      planned: input.target?.trim() || "Stay near target",
      actual: `${formatPercent(1 - timeAboveTarget)} within target`,
      note: `${formatPercent(timeAboveTarget)} above target`,
      tone: timeAboveTarget <= 0.1 ? "success" : timeAboveTarget <= 0.2 ? "warning" : "attention"
    });
  }

  if (firstHalfHr && lastHalfHr) {
    const drift = lastHalfHr / firstHalfHr;
    metrics.push({
      label: "Late HR drift",
      planned: "Controlled through the finish",
      actual: `${Math.round(lastHalfHr - firstHalfHr)} bpm rise`,
      note: `${formatPercent(drift - 1)} drift`,
      tone: drift <= 1.04 ? "success" : drift <= 1.08 ? "warning" : "attention"
    });
  } else if (firstHalfPace && lastHalfPace) {
    const fade = lastHalfPace / firstHalfPace;
    metrics.push({
      label: "Late-session fade",
      planned: "Hold pace late",
      actual: `${formatPercent(fade - 1)} slower late`,
      tone: fade <= 1.04 ? "success" : fade <= 1.1 ? "warning" : "attention"
    });
  }

  return metrics;
}

export function normalizeReviewSummary(input: ReviewSummaryInput): NormalizedReviewSummary {
  const review = parsePersistedExecutionReview(input.executionResult);
  const persisted = input.executionResult && typeof input.executionResult === "object" ? input.executionResult : null;
  const rawReviewSummary =
    persisted && "review_summary" in persisted && persisted.review_summary && typeof persisted.review_summary === "object"
      ? (persisted.review_summary as Record<string, unknown>)
      : null;

  const outcome =
    input.storedStatus === "skipped"
      ? "missed_intent"
      : review
        ? normalizeReviewOutcomeState(review.status)
        : normalizeReviewOutcomeState(
          getString(rawReviewSummary, ["outcome"]) ??
          getString(persisted, ["status"])
        );
  const keyIssues = Array.isArray(rawReviewSummary?.keyIssues)
    ? rawReviewSummary.keyIssues.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : review?.deterministic.detectedIssues.map((issue) => humanizeIssue(issue.code)) ??
      (Array.isArray(review?.evidence) ? review.evidence.slice(0, 3) : []);
  const missingEvidenceReasons = Array.isArray(rawReviewSummary?.missingEvidenceReasons)
    ? rawReviewSummary.missingEvidenceReasons
        .map((item) => (typeof item === "string" ? normalizeMissingEvidenceReason(item) : null))
        .filter((item): item is MissingEvidenceReason => Boolean(item))
    : review?.missingEvidence
        .map((reason) => normalizeMissingEvidenceReason(reason))
        .filter((item): item is MissingEvidenceReason => Boolean(item)) ?? [];
  const metrics = buildMetrics(input, persisted);
  const derivedQuality = deriveEvidenceQuality(metrics, missingEvidenceReasons);
  const confidence =
    (getString(rawReviewSummary, ["confidence"]) as EvidenceQualityState | null) ??
    review?.diagnosisConfidence ??
    derivedQuality;
  const evidenceQuality =
    (getString(rawReviewSummary, ["evidenceQuality"]) as EvidenceQualityState | null) ??
    derivedQuality;
  const intendedStimulus =
    getString(rawReviewSummary, ["intendedStimulus"]) ??
    review?.deterministic.planned.intentCategory ??
    fallbackIntendedStimulus(input);
  const actualExecution =
    getString(rawReviewSummary, ["actualExecution"]) ??
    review?.executionSummary ??
    getString(persisted, ["executionSummary", "executionScoreSummary", "summary"]) ??
    (input.storedStatus === "skipped"
      ? "The session did not happen, so the intended stimulus did not land."
      : "Execution evidence is still building.");
  const summary =
    getString(rawReviewSummary, ["summary"]) ??
    review?.verdict?.sessionVerdict.summary ??
    (outcome === "on_target"
      ? "The intended session stimulus landed cleanly."
      : outcome === "partial_match"
        ? "The session was completed, but the intended stimulus only partially landed."
        : outcome === "missed_intent"
          ? "The intended stimulus did not land cleanly enough to count as planned."
          : "This session has not been reviewed yet.");
  const primaryGap =
    getString(rawReviewSummary, ["primaryGap"]) ??
    review?.verdict?.explanation.whatHappened ??
    (input.storedStatus === "skipped"
      ? "The session was skipped, so the planned stimulus is still missing from the week."
      : !input.executionResult && input.storedStatus !== "completed"
        ? "The workout has not been completed or synced for review yet."
      : outcome === "on_target"
        ? "Execution stayed aligned with the planned session."
        : outcome === "partial_match"
          ? "The session came up short of its full intended dose."
          : outcome === "missed_intent"
            ? "The primary training purpose did not land."
            : "Review data has not synced yet.");
  const recommendation =
    getString(rawReviewSummary, ["recommendation"]) ??
    review?.recommendedNextAction ??
    review?.verdict?.explanation.whatToDoNextTime ??
    (outcome === "on_target"
      ? "Proceed as planned."
      : outcome === "partial_match"
        ? "Modify the next similar session and protect execution quality earlier."
        : outcome === "missed_intent"
          ? "Protect recovery, keep the week stable, and decide whether the session should be repeated."
          : "Wait for the review to finish before making a bigger adjustment.");
  const weekRecommendation =
    getString(rawReviewSummary, ["weekRecommendation"]) ??
    review?.suggestedWeekAdjustment ??
    review?.verdict?.explanation.whatToDoThisWeek ??
    "Keep the rest of the week stable.";
  const didStimulusLand =
    (getString(rawReviewSummary, ["didStimulusLand"]) as StimulusLandingState | null) ??
    deriveDidStimulusLand(outcome);
  const stimulusImpact =
    (getString(rawReviewSummary, ["stimulusImpact"]) as StimulusImpactLevel | null) ??
    deriveStimulusImpact(outcome, keyIssues, Boolean(input.isExtra));
  const effectOnWeek =
    (getString(rawReviewSummary, ["effectOnWeek"]) as EffectOnWeek | null) ??
    deriveEffectOnWeek(
      outcome,
      keyIssues,
      Boolean(getString(rawReviewSummary, ["isProtected"]) ?? false) || /key/i.test(input.type),
      Boolean(input.isExtra)
    );

  return {
    outcome,
    outcomeLabel: getReviewOutcomeLabel(outcome),
    confidence,
    confidenceLabel: getEvidenceQualityLabel(confidence),
    evidenceQuality,
    evidenceQualityLabel: getEvidenceQualityLabel(evidenceQuality),
    headline:
      getString(rawReviewSummary, ["headline"]) ??
      (outcome === "on_target"
        ? "On target"
        : outcome === "partial_match"
          ? "Partial match"
          : outcome === "missed_intent"
            ? "Missed intent"
            : "Unreviewed"),
    summary,
    primaryGap,
    keyIssues,
    intendedStimulus,
    actualExecution,
    didStimulusLand,
    recommendation,
    weekRecommendation,
    stimulusImpact,
    effectOnWeek,
    missingEvidenceReasons,
    missingEvidenceLabels: missingEvidenceReasons.map((reason) => getMissingEvidenceLabel(reason)),
    confidenceExplanation: buildConfidenceExplanation(evidenceQuality, missingEvidenceReasons),
    metrics
  };
}
