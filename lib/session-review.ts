import { getDisciplineMeta } from "@/lib/ui/discipline";
import { parsePersistedExecutionReview } from "@/lib/execution-review";
import type { ComponentScores } from "@/lib/coach/session-diagnosis";

export type SessionReviewRow = {
  id: string;
  user_id?: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  discipline?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  intent_category?: string | null;
  target?: string | null;
  notes?: string | null;
  duration_minutes?: number | null;
  status?: "planned" | "completed" | "skipped" | null;
  execution_result?: Record<string, unknown> | null;
  has_linked_activity?: boolean;
  is_extra?: boolean;
};

type SessionStatus = "planned" | "completed" | "skipped";
type DiagnosisStatus = "matched_intent" | "partial_intent" | "missed_intent";
type ScoreBand = "On target" | "Solid" | "Partial match" | "Missed intent";
type Tone = "success" | "warning" | "risk" | "muted";
type IntentBucket = "easy" | "recovery" | "threshold" | "long" | "swim_strength" | "unknown";

export type ReviewViewModel = {
  reviewModeLabel: string;
  reviewModeDetail: string;
  sessionStatusLabel: string;
  sessionStatusDetail: string;
  isReviewable: boolean;
  intent: { label: string; tone: Tone; detail: string };
  score: number | null;
  scoreBand: ScoreBand | null;
  scoreHeadline: string;
  scoreInterpretation: string;
  scoreConfidenceNote: string | null;
  scoreTone: Tone;
  executionCostLabel: string | null;
  confidenceLabel: string | null;
  plannedIntent: string;
  actualExecutionSummary: string;
  mainGapLabel: string;
  mainGap: string;
  usefulMetrics: Array<{ label: string; value: string }>;
  whyItMatters: string;
  nextAction: string;
  weekAction: string;
  uncertaintyTitle: string | null;
  uncertaintyDetail: string | null;
  missingEvidence: string[];
  unlockTitle: string;
  unlockDetail: string;
  followUpIntro: string;
  followUpPrompts: string[];
  narrativeSource: "ai" | "fallback" | "legacy_unknown";
  componentScores: ComponentScores | null;
  trendContext: string | null;
  oneThingToChange: string | null;
  loadContribution: {
    sessionTss: number | null;
    weekTssSoFar: number | null;
    weekTssTarget: number | null;
    weekTssPct: number | null;
  } | null;
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  planned: "Planned",
  completed: "Completed",
  skipped: "Skipped"
};

const SCORE_BAND_BY_VALUE = [
  { min: 90, label: "On target" },
  { min: 75, label: "Solid" },
  { min: 55, label: "Partial match" },
  { min: 0, label: "Missed intent" }
] as const;

function getString(result: Record<string, unknown> | null | undefined, keys: string[], fallback = "") {
  if (!result) return fallback;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return fallback;
}

function getNumber(result: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!result) return null;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function pct(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

/** Format interval completion ratio as a human-readable string. */
function formatIntervalCompletion(value: number): string {
  const pctVal = Math.round(value * 100);
  if (pctVal >= 100) return "All completed";
  return `${pctVal}%`;
}

/** Sanitize raw camelCase field names that may appear in AI-generated text. */
export function sanitizeFieldNames(text: string): string {
  let result = text;
  // intervalCompletionPct or intervalCompletion with comparison operators and values
  // Match both "intervalCompletionPct" and "intervalCompletion" (with or without Pct suffix)
  // ≥ 1.0 → "all planned intervals completed"
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*[≥>=]+\s*1(?:\.0)?\b/gi, "all planned intervals completed");
  // Comparator + value → operator-aware phrasing
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*([≥≤]|>=|<=|>|<)\s*([\d.]+)/gi, (_m, op, v) => {
    const pct = Math.round(parseFloat(v) * 100);
    if (pct >= 100) return "all planned intervals completed";
    const isLessThan = /[<≤]/.test(op);
    const isStrict = op === "<" || op === ">";
    if (isLessThan) {
      return isStrict
        ? `less than ${pct}% of planned intervals completed`
        : `at most ${pct}% of planned intervals completed`;
    }
    return isStrict
      ? `more than ${pct}% of planned intervals completed`
      : `at least ${pct}% of planned intervals completed`;
  });
  // = or : with value
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*[=:]\s*([\d.]+)/gi, (_m, v) => {
    const pct = Math.round(parseFloat(v) * 100);
    return pct >= 100 ? "all planned intervals completed" : `${pct}% of planned intervals completed`;
  });
  // Bare field name without value
  result = result.replace(/\bintervalCompletion(?:Pct)?\b/gi, "interval completion");
  result = result.replace(/\btimeAboveTargetPct\b/gi, "time above target");
  result = result.replace(/\bavgPower\b/gi, "avg power");
  result = result.replace(/\bavgHr\b/gi, "avg heart rate");
  result = result.replace(/\bnormalizedPower\b/gi, "normalized power");
  result = result.replace(/\bvariabilityIndex\b/gi, "variability index");
  result = result.replace(/\btrainingStressScore\b/gi, "training stress score");
  result = result.replace(/\btotalWorkKj\b/gi, "total work");
  // Expand "NP" abbreviation — match when used as a standalone term (not inside a word)
  // but only in metric contexts (followed by space + word/number, or at end after possessive)
  result = result.replace(/\bNP\b(?=\s+(?:remains|target|within|of|from|rose|is|was|at|near|≈|~|\d))/g, "normalized power");
  result = result.replace(/today's NP\b/g, "today's normalized power");
  result = result.replace(/\bVI\b(?=\s+(?:of|was|is|at|\d))/g, "variability index");
  return result;
}

export function durationLabel(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "—";
  const wholeMinutes = Math.round(minutes);
  const h = Math.floor(wholeMinutes / 60);
  const m = wholeMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function toStatusLabel(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  if (normalized in STATUS_LABELS) return STATUS_LABELS[normalized as SessionStatus];
  return "Completed";
}

function toReviewState(status: string | null | undefined, diagnosis: Record<string, unknown> | null | undefined, hasLinkedActivity: boolean) {
  const normalized = (status ?? "").toLowerCase();
  const hasDiagnosticSignals = Boolean(diagnosis) && Object.keys(diagnosis ?? {}).length > 0;

  if (normalized === "completed") {
    return {
      reviewModeLabel: "Post-execution review",
      reviewModeDetail: "This session has enough execution evidence to review what happened and what to do next.",
      sessionStatusLabel: "Completed",
      sessionStatusDetail: "Completed session with reviewable execution evidence.",
      isReviewable: true
    };
  }

  if (normalized === "skipped") {
    return {
      reviewModeLabel: "Skipped-session review",
      reviewModeDetail: "This review is about the missed training stimulus and the best next step from here.",
      sessionStatusLabel: "Skipped",
      sessionStatusDetail: "The workout was skipped, so the review focuses on the missed stimulus rather than execution quality.",
      isReviewable: true
    };
  }

  if (normalized === "planned" && hasDiagnosticSignals) {
    return {
      reviewModeLabel: "Post-execution review",
      reviewModeDetail: "Activity data is present, but the session status has not fully synced yet.",
      sessionStatusLabel: "Awaiting completion sync",
      sessionStatusDetail: "Workout data exists, but the calendar state still needs to catch up.",
      isReviewable: true
    };
  }

  if (normalized === "planned" && hasLinkedActivity) {
    return {
      reviewModeLabel: "Analysis pending",
      reviewModeDetail: "A completed activity is already linked to this session. You do not need to upload it again.",
      sessionStatusLabel: "Activity linked",
      sessionStatusDetail: "This session is waiting for execution analysis to populate the review.",
      isReviewable: false
    };
  }

  if (normalized === "planned") {
    return {
      reviewModeLabel: "Not reviewable yet",
      reviewModeDetail: "This workout is still waiting for completion data, so a post-session review would be premature.",
      sessionStatusLabel: "Planned",
      sessionStatusDetail: "No completed execution data has synced for this session yet.",
      isReviewable: false
    };
  }

  return {
    reviewModeLabel: hasDiagnosticSignals ? "Post-execution review" : "Not reviewable yet",
    reviewModeDetail: hasDiagnosticSignals
      ? "Some execution evidence is available while the final session state is still syncing."
      : "No reliable execution evidence has synced for review yet.",
    sessionStatusLabel: hasDiagnosticSignals ? "Sync in progress" : "Awaiting execution data",
    sessionStatusDetail: hasDiagnosticSignals
      ? "Execution evidence is present, but final session sync is still in progress."
      : "Upload or sync the completed workout to unlock a reliable review.",
    isReviewable: hasDiagnosticSignals
  };
}

function deriveOneThingToChange(
  componentScores: ComponentScores | null,
  scoreBand: ScoreBand | null,
  aiNextAction: string | null,
  verdictAdaptationType?: string | null
): string | null {
  // If the verdict says modifications/redistribution are needed, prefer the AI action over "keep doing"
  const verdictSuggestsChange = verdictAdaptationType && verdictAdaptationType !== "proceed";

  if (componentScores) {
    const components = [
      { key: "intentMatch" as const, label: "intensity target", score: componentScores.intentMatch.score, detail: componentScores.intentMatch.detail },
      { key: "pacingExecution" as const, label: "pacing", score: componentScores.pacingExecution.score, detail: componentScores.pacingExecution.detail },
      { key: "completion" as const, label: "session completion", score: componentScores.completion.score, detail: componentScores.completion.detail },
      { key: "recoveryCompliance" as const, label: "recovery discipline", score: componentScores.recoveryCompliance.score, detail: componentScores.recoveryCompliance.detail }
    ];
    const worst = components.reduce((a, b) => (a.score <= b.score ? a : b));
    if (worst.score < 80) {
      return sanitizeFieldNames(`NEXT ${worst.label}: ${worst.detail}`);
    }
  }
  if ((scoreBand === "On target" || scoreBand === "Solid") && !verdictSuggestsChange) {
    return "Maintain this approach. Same targets next time.";
  }
  return aiNextAction ? sanitizeFieldNames(aiNextAction) : null;
}

function toExtraReviewState(hasDiagnosticSignals: boolean) {
  if (hasDiagnosticSignals) {
    return {
      reviewModeLabel: "Post-execution review",
      reviewModeDetail: "This completed workout was not planned, so the review focuses on its execution and weekly impact rather than planned vs actual.",
      sessionStatusLabel: "Completed",
      sessionStatusDetail: "Completed workout without a planned target, but with enough evidence to review what it added to the week.",
      isReviewable: true
    };
  }

  return {
    reviewModeLabel: "Post-execution review",
    reviewModeDetail: "This completed workout was not planned, so the review stays directional until richer evidence syncs.",
    sessionStatusLabel: "Completed",
    sessionStatusDetail: "Completed workout without enough detail for a stronger execution read.",
    isReviewable: false
  };
}

function toIntentBucket(intentCategory: string | null | undefined, sport: string) {
  const text = `${intentCategory ?? ""}`.toLowerCase();
  if (/recovery/.test(text)) return "recovery";
  if (/threshold|tempo|vo2|interval|quality|anaerobic/.test(text)) return "threshold";
  if (/long/.test(text)) return "long";
  if (sport === "swim" || sport === "strength") return "swim_strength";
  if (/easy|endurance|aerobic|z2|base/.test(text)) return "easy";
  return "unknown";
}

function toIntent(status: unknown, isReviewable: boolean, hasLinkedActivity: boolean) {
  if (!isReviewable && hasLinkedActivity) {
    return {
      label: "Analysis pending",
      tone: "muted" as const,
      detail: "The workout is linked. Intent result will appear once execution analysis finishes."
    };
  }

  if (!isReviewable) {
    return {
      label: "Pending review",
      tone: "muted" as const,
      detail: "Intent result will appear once the completed session is reviewable."
    };
  }

  if (status === "matched_intent" || status === "matched") {
    return {
      label: "Matched intent",
      tone: "success" as const,
      detail: "Execution stayed aligned with the planned training stimulus."
    };
  }
  if (status === "missed_intent" || status === "missed") {
    return {
      label: "Missed intent",
      tone: "risk" as const,
      detail: "Execution drifted enough to blunt the session's intended adaptation."
    };
  }
  return {
    label: "Partial match",
    tone: "warning" as const,
    detail: "Some of the intended stimulus landed, but key parts of the execution were off."
  };
}

function toExtraIntent(status: unknown, isReviewable: boolean) {
  if (!isReviewable) {
    return {
      label: "Directional read",
      tone: "muted" as const,
      detail: "This extra workout still counts, but richer interval and intensity detail would sharpen how it should change the week."
    };
  }

  if (status === "matched_intent" || status === "matched") {
    return {
      label: "Supportive load",
      tone: "success" as const,
      detail: "The extra work looks controlled enough to add useful training load without obvious disruption."
    };
  }

  if (status === "missed_intent" || status === "missed") {
    return {
      label: "Risky load",
      tone: "risk" as const,
      detail: "The extra work looks costly enough that the rest of the week may need more protection."
    };
  }

  return {
    label: "Manage load",
    tone: "warning" as const,
    detail: "The extra work added stimulus, but treat the next sessions conservatively until recovery is clearer."
  };
}

function toScoreBand(score: number | null, explicitBand: string | null) {
  if (explicitBand === "On target" || explicitBand === "Solid" || explicitBand === "Partial match" || explicitBand === "Missed intent") return explicitBand;
  if (score === null) return null;
  return SCORE_BAND_BY_VALUE.find((band) => score >= band.min)?.label ?? "Partial match";
}

function summarizeMatchedSession(bucket: IntentBucket) {
  if (bucket === "recovery") return "Recovery intent was controlled well and stayed easy enough to do its job.";
  if (bucket === "threshold") return "Key work stayed close to target and the session delivered the planned quality stimulus.";
  if (bucket === "long") return "The session stayed durable enough to preserve the long-run or long-ride intent through the finish.";
  return "Execution stayed close to plan and delivered the intended training stimulus.";
}

function summarizeActualExecution(params: {
  bucket: IntentBucket;
  intentLabel: string;
  executionSummary: string;
  timeAbove: number | null;
  intervalCompletion: number | null;
  durationCompletion: number | null;
  avgHr: number | null;
  avgPower: number | null;
  hrDrift: number | null;
  paceFade: number | null;
}) {
  const { bucket, intentLabel, executionSummary, timeAbove, intervalCompletion, durationCompletion, hrDrift, paceFade } = params;

  if (intentLabel === "Matched intent") return summarizeMatchedSession(bucket);
  if (bucket === "recovery" && (timeAbove ?? 0) >= 0.15) return "Recovery intent drifted too hard, so the session likely stopped acting like true recovery.";
  if (bucket === "easy" && ((timeAbove ?? 0) >= 0.2 || (hrDrift ?? 1) > 1.06)) return "The easy session drifted harder than planned, especially once fatigue started to rise.";
  if (bucket === "threshold" && (intervalCompletion ?? 1) < 0.9) return "Threshold work was only partially completed, so the quality block landed short of the planned stimulus.";
  if (bucket === "threshold" && (durationCompletion ?? 1) < 0.9) return "The quality set finished short of plan, which reduced the time spent at the intended stimulus.";
  if (bucket === "long" && ((paceFade ?? 1) > 1.1 || (hrDrift ?? 1) > 1.06)) return "The long session lost control late, pointing to pacing, fueling, or durability drift.";
  if (bucket === "swim_strength" && (intervalCompletion ?? 1) < 0.9) return "The session was completed unevenly, with part of the planned work left unfinished.";
  if (executionSummary) return executionSummary;
  return intentLabel === "Missed intent"
    ? "Execution moved far enough away from plan that the intended training effect was diluted."
    : "Execution delivered some useful work, but control against the plan was uneven.";
}

function deriveMainGap(params: {
  isReviewable: boolean;
  bucket: IntentBucket;
  intentLabel: string;
  timeAbove: number | null;
  intervalCompletion: number | null;
  durationCompletion: number | null;
  hrDrift: number | null;
  paceFade: number | null;
}) {
  const { isReviewable, bucket, intentLabel, timeAbove, intervalCompletion, durationCompletion, hrDrift, paceFade } = params;

  if (!isReviewable) return "No execution gap yet, because this workout has not been completed and synced for review.";
  if (intentLabel === "Matched intent") return "Session matched intent well. Keep the same execution approach next time.";
  if (bucket === "recovery" && (timeAbove ?? 0) >= 0.15) return "Recovery session stayed too hard to deliver the easy-day reset it was meant to provide.";
  if (bucket === "easy" && ((timeAbove ?? 0) >= 0.2 || (hrDrift ?? 1) > 1.06)) return "Easy session drifted too hard, so the aerobic intent lost some of its control.";
  if (bucket === "threshold" && (intervalCompletion ?? 1) < 0.85) return "Threshold reps were under target or left incomplete, reducing the specific quality dose.";
  if (bucket === "threshold" && (durationCompletion ?? 1) < 0.9) return "The quality block finished short of plan, so the session did not fully deliver its intended load.";
  if (bucket === "long" && (paceFade ?? 1) > 1.1) return "Long session faded late, which points to pacing or fueling falling off before the finish.";
  if (bucket === "long" && (hrDrift ?? 1) > 1.06) return "Long session started a little too hard and lost control as fatigue built.";
  if (bucket === "swim_strength" && (intervalCompletion ?? 1) < 0.9) return "Planned work was not fully completed, so the session stimulus landed short.";
  return intentLabel === "Missed intent"
    ? "Execution moved too far from the planned stimulus to fully deliver the session's purpose."
    : "The session was useful, but execution drift reduced the specificity of the planned stimulus.";
}

function deriveWeekAction(params: { intentLabel: string; bucket: IntentBucket; isReviewable: boolean }) {
  const { intentLabel, bucket, isReviewable } = params;
  if (!isReviewable) return "Complete or sync this workout before making bigger training changes.";
  if (intentLabel === "Matched intent") return "Keep the next key session as planned, and carry the same execution discipline into it.";
  if (bucket === "recovery" || bucket === "easy") return "Protect the next 48 hours from extra intensity so the week does not drift harder than planned.";
  if (bucket === "threshold") return "Keep the next key session on the calendar, but only progress the load if you can hit the full set cleanly.";
  if (bucket === "long") return "Hold the planned week structure, but be more deliberate with pacing and fueling before the next long session.";
  return "Use this session as feedback and keep the rest of the week steady rather than forcing extra load.";
}

export function toneToTextClass(tone: Tone) {
  if (tone === "success") return "text-[hsl(var(--success))]";
  if (tone === "warning") return "text-[hsl(var(--warning))]";
  if (tone === "risk") return "text-[hsl(var(--signal-risk))]";
  return "text-muted";
}

export function toneToBadgeClass(tone: Tone) {
  if (tone === "success") return "border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]";
  if (tone === "warning") return "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]";
  if (tone === "risk") return "border-[hsl(var(--signal-risk)/0.35)] bg-[hsl(var(--signal-risk)/0.12)] text-[hsl(var(--signal-risk))]";
  return "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] text-muted";
}

export function createReviewViewModel(session: SessionReviewRow, options?: { trendContext?: string | null; verdictAdaptationType?: string | null }): ReviewViewModel {
  const diagnosis = session.execution_result;
  const v2Review = parsePersistedExecutionReview(diagnosis);
  const hasLinkedActivity = session.has_linked_activity === true;
  const hasDiagnosticSignals = Boolean(diagnosis) && Object.keys(diagnosis ?? {}).length > 0;
  const isExtra = session.is_extra === true;
  const reviewState = isExtra ? toExtraReviewState(hasDiagnosticSignals) : toReviewState(session.status, diagnosis, hasLinkedActivity);
  const intent = isExtra ? toExtraIntent(diagnosis?.status, reviewState.isReviewable) : toIntent(diagnosis?.status, reviewState.isReviewable, hasLinkedActivity);
  const bucket = toIntentBucket(session.intent_category, session.sport);

  const defaultWhyItMatters = isExtra
    ? "Unplanned sessions still change the training week, so the key question is whether this added useful stimulus or unnecessary load."
    : reviewState.isReviewable
    ? intent.label === "Matched intent"
      ? "Matching the planned session intent preserves the adaptation you wanted from the day and supports the rest of the week."
      : "Execution consistency protects the intended training effect and helps the rest of the week land as planned."
    : "A useful review starts with a completed session, because that is what makes coaching advice trustworthy.";

  const defaultNextAction = isExtra
    ? "Decide whether this should count as added load, a replacement for missed work, or a reason to trim the next session."
    : reviewState.isReviewable
    ? intent.label === "Matched intent"
      ? "Good control. Keep the same execution approach next time."
      : "Start the next similar session with one clear execution cue and protect it early."
    : hasLinkedActivity
      ? "No re-upload is needed. Give the linked workout time to process, and only re-link it if the session attachment is wrong."
      : "Complete or sync the workout first, then come back for a more specific review.";

  const executionSummary = getString(diagnosis, ["executionSummary", "executionScoreSummary", "summary"]);
  const whyItMatters = getString(
    v2Review?.verdict?.explanation
      ? {
        whyItMatters: v2Review.verdict.explanation.whyItMatters
      }
      : diagnosis,
    ["whyItMatters", "why_it_matters"],
    defaultWhyItMatters
  );
  const nextAction = getString(
    v2Review?.verdict?.explanation
      ? {
        recommendedNextAction: v2Review.verdict.explanation.whatToDoNextTime
      }
      : diagnosis,
    ["recommendedNextAction", "recommended_next_action"],
    defaultNextAction
  );
  const aiWhatHappened = v2Review?.narrativeSource === "ai"
    ? getString(
      v2Review.verdict?.explanation
        ? { actualExecutionSummary: v2Review.verdict.explanation.whatHappened }
        : null,
      ["actualExecutionSummary"],
      ""
    )
    : "";

  const score = getNumber(diagnosis, ["executionScore", "execution_score"]);
  const explicitBand = getString(diagnosis, ["executionScoreBand", "execution_score_band"]) || null;
  const scoreBand = toScoreBand(score, explicitBand);
  const scoreSummary = getString(diagnosis, ["executionScoreSummary", "execution_score_summary"]);
  const provisional = diagnosis?.executionScoreProvisional === true || diagnosis?.execution_score_provisional === true;

  const durationCompletion = getNumber(diagnosis, ["durationCompletion", "duration_completion"]);
  const intervalCompletion = getNumber(diagnosis, ["intervalCompletionPct", "interval_completion_pct"]);
  const timeAbove = getNumber(diagnosis, ["timeAboveTargetPct", "time_above_target_pct"]);
  const avgHr = getNumber(diagnosis, ["avgHr", "avg_hr"]);
  const avgPower = getNumber(diagnosis, ["avgPower", "avg_power"]);
  const normalizedPower = getNumber(diagnosis, ["normalizedPower", "normalized_power"]);
  const variabilityIndex = getNumber(diagnosis, ["variabilityIndex", "variability_index"]);
  const trainingStressScore = getNumber(diagnosis, ["trainingStressScore", "training_stress_score"]);
  const avgCadence = getNumber(diagnosis, ["avgCadence", "avg_cadence"]);
  const avgPacePer100mSec = getNumber(diagnosis, ["avgPacePer100mSec", "avg_pace_per_100m_sec"]);
  const bestPacePer100mSec = getNumber(diagnosis, ["bestPacePer100mSec", "best_pace_per_100m_sec"]);
  const avgStrokeRateSpm = getNumber(diagnosis, ["avgStrokeRateSpm", "avg_stroke_rate_spm"]);
  const avgSwolf = getNumber(diagnosis, ["avgSwolf", "avg_swolf"]);
  const elevationGainM = getNumber(diagnosis, ["elevationGainM", "elevation_gain_m"]);
  const firstHalfHr = getNumber(diagnosis, ["firstHalfAvgHr", "first_half_avg_hr"]);
  const lastHalfHr = getNumber(diagnosis, ["lastHalfAvgHr", "last_half_avg_hr"]);
  const firstHalfPace = getNumber(diagnosis, ["firstHalfPaceSPerKm", "first_half_pace_s_per_km"]);
  const lastHalfPace = getNumber(diagnosis, ["lastHalfPaceSPerKm", "last_half_pace_s_per_km"]);
  const firstHalfSwimPace = getNumber(diagnosis, ["firstHalfPacePer100mSec", "first_half_pace_per_100m_sec"]);
  const lastHalfSwimPace = getNumber(diagnosis, ["lastHalfPacePer100mSec", "last_half_pace_per_100m_sec"]);

  const hrDrift = firstHalfHr && lastHalfHr ? lastHalfHr / firstHalfHr : null;
  const paceFade = firstHalfPace && lastHalfPace ? lastHalfPace / firstHalfPace : null;
  const swimPaceFade = firstHalfSwimPace && lastHalfSwimPace ? lastHalfSwimPace / firstHalfSwimPace : null;
  const durationCompleted = durationCompletion !== null && session.duration_minutes
    ? durationLabel(Math.round((session.duration_minutes ?? 0) * durationCompletion))
    : null;
  const cadenceUnit = session.sport === "bike" ? "rpm" : "spm";
  const formatPace100 = (seconds: number) => {
    const rounded = Math.round(seconds);
    const minutes = Math.floor(rounded / 60);
    const secs = rounded % 60;
    return `${minutes}:${secs.toString().padStart(2, "0")}/100m`;
  };

  const actualExecutionSummary = aiWhatHappened || (
    isExtra
      ? executionSummary || "This extra session added training load outside the original plan."
      : summarizeActualExecution({
        bucket,
        intentLabel: intent.label,
        executionSummary,
        timeAbove,
        intervalCompletion,
        durationCompletion,
        avgHr,
        avgPower,
        hrDrift,
        paceFade
      })
  );

  const mainGap = isExtra
    ? reviewState.isReviewable
      ? "There is no planned target to compare against, so the main question is whether this extra load helped the week or created recovery cost."
      : "Without richer data, treat this extra session as additive load and judge it by how it affects the next 48 hours."
    : deriveMainGap({
    isReviewable: reviewState.isReviewable,
    bucket,
    intentLabel: intent.label,
    timeAbove,
    intervalCompletion,
    durationCompletion,
    hrDrift,
    paceFade
  });
  const mainGapLabel = isExtra
    ? "Weekly context"
    : intent.label === "Matched intent"
      ? "Key confirmation"
      : "Main gap";

  const scoreHeadline =
    score !== null
      ? provisional
        ? `Provisional · ${scoreBand ?? "Partial match"}`
        : `${Math.round(score)} · ${scoreBand ?? "Partial match"}`
      : reviewState.isReviewable
        ? "Provisional review"
        : hasLinkedActivity
          ? "Awaiting score"
          : "Not yet scored";

  const scoreInterpretation =
    score !== null
      ? provisional
        ? scoreSummary
          ? `Early read: ${scoreSummary}`
          : "Directionally useful score from limited evidence. Treat it as provisional, not final."
        : scoreSummary || `Execution landed ${scoreBand?.toLowerCase() ?? "close to plan"}.`
      : reviewState.isReviewable
        ? "There is enough evidence to review the session, but not enough to publish a trustworthy numeric score yet."
        : hasLinkedActivity
          ? "This workout is already linked. Execution Score will appear once the linked activity finishes processing into session analysis."
        : "Execution Score appears after the workout is completed and enough evidence has synced.";

  const scoreConfidenceNote =
    score !== null && provisional
      ? "Provisional: band looks useful, but confidence improves once interval and intensity detail is richer."
      : score === null && reviewState.isReviewable
        ? "A richer upload with interval completion and intensity detail will unlock a stronger score."
        : null;

  const scoreTone: Tone =
    score === null
      ? "muted"
      : scoreBand === "On target" || scoreBand === "Solid"
        ? "success"
        : scoreBand === "Partial match"
          ? "warning"
          : "risk";

  const rawComponentScores = diagnosis?.componentScores as ComponentScores | null | undefined;
  const componentScores: ComponentScores | null = rawComponentScores && typeof rawComponentScores.composite === "number"
    ? rawComponentScores
    : null;

  const runMetrics = [
    durationCompleted ? { label: "Duration completed", value: durationCompleted } : durationCompletion !== null ? { label: "Duration completed", value: pct(durationCompletion) } : null,
    avgHr || avgPower
      ? {
          label: "Average load",
          value: `${avgHr ? `${Math.round(avgHr)} bpm` : ""}${avgHr && avgPower ? " · " : ""}${avgPower ? `${Math.round(avgPower)} w` : ""}`
        }
      : null,
    hrDrift !== null ? { label: "Late HR drift", value: pct(hrDrift - 1) } : null,
    paceFade !== null ? { label: "Late pace fade", value: pct(paceFade - 1) } : null,
    avgCadence !== null ? { label: "Average cadence", value: `${Math.round(avgCadence)} ${cadenceUnit}` } : null,
    elevationGainM !== null ? { label: "Elevation gain", value: `${Math.round(elevationGainM)} m` } : null,
    timeAbove !== null ? { label: "Time above target", value: pct(timeAbove) } : null,
    intervalCompletion !== null ? { label: "Key reps completed", value: formatIntervalCompletion(intervalCompletion) } : null
  ];
  const swimMetrics = [
    durationCompleted ? { label: "Duration completed", value: durationCompleted } : durationCompletion !== null ? { label: "Duration completed", value: pct(durationCompletion) } : null,
    avgPacePer100mSec !== null ? { label: "Average pace /100m", value: formatPace100(avgPacePer100mSec) } : null,
    bestPacePer100mSec !== null ? { label: "Best pace /100m", value: formatPace100(bestPacePer100mSec) } : null,
    avgStrokeRateSpm !== null ? { label: "Average stroke rate", value: `${Math.round(avgStrokeRateSpm)} spm` } : null,
    avgSwolf !== null ? { label: "Average SWOLF", value: `${Math.round(avgSwolf)}` } : null,
    intervalCompletion !== null ? { label: "Key reps completed", value: formatIntervalCompletion(intervalCompletion) } : null,
    swimPaceFade !== null ? { label: "Late pace fade", value: pct(swimPaceFade - 1) } : null
  ];
  const defaultMetrics = [
    durationCompleted ? { label: "Duration completed", value: durationCompleted } : durationCompletion !== null ? { label: "Duration completed", value: pct(durationCompletion) } : null,
    intervalCompletion !== null ? { label: "Key reps completed", value: formatIntervalCompletion(intervalCompletion) } : null,
    timeAbove !== null ? { label: "Time above target", value: pct(timeAbove) } : null,
    hrDrift !== null && bucket !== "threshold" ? { label: "Late HR drift", value: pct(hrDrift - 1) } : null,
    paceFade !== null && bucket === "long" ? { label: "Late pace fade", value: pct(paceFade - 1) } : null,
    normalizedPower !== null ? { label: "Normalized power", value: `${Math.round(normalizedPower)} w` } : null,
    variabilityIndex !== null ? { label: "Variability Index", value: variabilityIndex.toFixed(2) } : null,
    trainingStressScore !== null ? { label: "Training Stress", value: `${Math.round(trainingStressScore)} TSS` } : null,
    avgCadence !== null ? { label: "Average cadence", value: `${Math.round(avgCadence)} ${cadenceUnit}` } : null
  ];
  const usefulMetrics = (session.sport === "run" ? runMetrics : session.sport === "swim" ? swimMetrics : defaultMetrics)
    .filter((metric): metric is { label: string; value: string } => metric !== null)
    .slice(0, 8);

  const plannedIntent = isExtra ? "No planned target. Treat this as completed load added on top of the week." : session.intent_category?.trim() || `${getDisciplineMeta(session.sport).label} session intent`;
  const weekAction = getString(
    v2Review?.verdict?.explanation
      ? { suggestedWeekAdjustment: v2Review.verdict.explanation.whatToDoThisWeek }
      : diagnosis,
    ["suggestedWeekAdjustment", "suggested_week_adjustment", "weeklyAdjustment", "weekly_adjustment"],
    isExtra
      ? "Keep or trim the next session based on whether this extra load was replacing something planned or adding on top."
      : deriveWeekAction({ intentLabel: intent.label, bucket, isReviewable: reviewState.isReviewable })
  );
  const executionCostLabel = v2Review?.verdict?.sessionVerdict.executionCost
    ? v2Review.verdict.sessionVerdict.executionCost.replace("_", " ")
    : typeof diagnosis?.executionCost === "string"
      ? diagnosis.executionCost.replace("_", " ")
      : null;
  const confidenceLabel = v2Review?.verdict?.sessionVerdict.confidence ?? (getString(diagnosis, ["diagnosisConfidence", "diagnosis_confidence"]) || null);
  const uncertaintyTitle =
    v2Review?.verdict?.uncertainty.label === "confident_read"
      ? null
      : v2Review?.verdict?.uncertainty.label === "insufficient_data"
        ? "Insufficient data"
        : v2Review?.verdict?.uncertainty.label === "early_read"
          ? "Early read"
          : null;
  const uncertaintyDetail = v2Review?.verdict?.uncertainty.label && v2Review.verdict.uncertainty.label !== "confident_read"
    ? v2Review.verdict.uncertainty.detail
    : null;
  const rawMissingEvidence = v2Review?.verdict?.uncertainty.missingEvidence ?? (Array.isArray(diagnosis?.missingEvidence) ? diagnosis.missingEvidence.filter((item): item is string => typeof item === "string") : []);
  const hasRichSplitEvidence = Boolean(firstHalfHr || lastHalfHr || firstHalfPace || lastHalfPace || firstHalfSwimPace || lastHalfSwimPace);
  const missingEvidence = rawMissingEvidence.filter((item) => !(hasRichSplitEvidence && item.toLowerCase().includes("split comparison")));
  const narrativeSource: ReviewViewModel["narrativeSource"] = v2Review?.narrativeSource ?? "legacy_unknown";

  const unlockTitle = isExtra ? "Weekly context" : reviewState.isReviewable ? "Review evidence" : "What unlocks review";
  const unlockDetail = isExtra
    ? reviewState.isReviewable
      ? "Use this review to judge whether the extra session was supportive, neutral, or risky for the rest of the week."
      : "This extra session can still be useful, but stronger interval and intensity detail would make the review more reliable."
    : reviewState.isReviewable
    ? usefulMetrics.length > 0
      ? "This review is grounded in the available duration, interval, and intensity evidence from the uploaded session."
      : "This review is directional for now because the uploaded session includes limited measurable evidence."
    : hasLinkedActivity
      ? "The workout is already attached to this planned session. Review unlocks once execution analysis catches up for the linked activity."
    : "Complete or sync the workout to unlock planned vs actual analysis, intent result, and a trustworthy Execution Score.";

  const followUpPrompts = isExtra
    ? [
        "Did this extra session help or hurt the week?",
        "Should I reduce my next session?",
        "Was this replacing missed work or adding load?",
        "How should I adjust the rest of the week?"
      ]
    : reviewState.isReviewable
    ? [
        "Why was this session flagged?",
        "Should I repeat this workout?",
        "How should I adjust the rest of the week?",
        "What should I change next time?"
      ]
    : [
        "What data do you need to review this session?",
        "Should I repeat this workout?",
        "How should I adjust the rest of the week?",
        "What should I change next time?"
      ];

  return {
    reviewModeLabel: reviewState.reviewModeLabel,
    reviewModeDetail: reviewState.reviewModeDetail,
    sessionStatusLabel: reviewState.sessionStatusLabel,
    sessionStatusDetail: reviewState.sessionStatusDetail,
    isReviewable: reviewState.isReviewable,
    intent,
    score,
    scoreBand,
    scoreHeadline,
    scoreInterpretation,
    scoreConfidenceNote,
    scoreTone,
    executionCostLabel,
    confidenceLabel,
    plannedIntent,
    actualExecutionSummary: sanitizeFieldNames(actualExecutionSummary),
    mainGapLabel,
    mainGap: sanitizeFieldNames(mainGap),
    usefulMetrics,
    whyItMatters: sanitizeFieldNames(whyItMatters),
    nextAction: sanitizeFieldNames(nextAction),
    weekAction: sanitizeFieldNames(weekAction),
    uncertaintyTitle,
    uncertaintyDetail,
    missingEvidence,
    unlockTitle,
    unlockDetail,
    narrativeSource,
    componentScores,
    trendContext: options?.trendContext ?? null,
    oneThingToChange: reviewState.isReviewable
      ? deriveOneThingToChange(
          componentScores,
          scoreBand,
          v2Review?.verdict?.explanation.oneThingToChange
            ?? v2Review?.verdict?.explanation.whatToDoNextTime
            ?? null,
          options?.verdictAdaptationType
        )
      : null,
    loadContribution: trainingStressScore !== null
      ? {
          sessionTss: trainingStressScore,
          weekTssSoFar: null,
          weekTssTarget: null,
          weekTssPct: null
        }
      : null,
    followUpIntro: isExtra
      ? "Use coach follow-up to decide whether this extra session should change the rest of the week."
      : reviewState.isReviewable
      ? "Use coach follow-up to understand the flag, decide whether to repeat the session, and protect the rest of the week."
      : "Coach follow-up becomes more useful once the workout is completed, but you can still ask how to handle the week from here.",
    followUpPrompts
  };
}
