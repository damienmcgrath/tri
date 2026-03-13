import { getDisciplineMeta } from "@/lib/ui/discipline";

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
  duration_minutes?: number | null;
  status?: "planned" | "completed" | "skipped" | null;
  execution_result?: Record<string, unknown> | null;
  has_linked_activity?: boolean;
};

type SessionStatus = "planned" | "completed" | "skipped";
type DiagnosisStatus = "matched_intent" | "partial_intent" | "missed_intent";
type ScoreBand = "On target" | "Partial match" | "Missed intent";
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
  plannedIntent: string;
  actualExecutionSummary: string;
  mainGap: string;
  usefulMetrics: Array<{ label: string; value: string }>;
  whyItMatters: string;
  nextAction: string;
  weekAction: string;
  unlockTitle: string;
  unlockDetail: string;
  followUpIntro: string;
  followUpPrompts: string[];
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  planned: "Planned",
  completed: "Completed",
  skipped: "Skipped"
};

const SCORE_BAND_BY_VALUE = [
  { min: 85, label: "On target" },
  { min: 70, label: "Partial match" },
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

function toScoreBand(score: number | null, explicitBand: string | null) {
  if (explicitBand === "On target" || explicitBand === "Partial match" || explicitBand === "Missed intent") return explicitBand;
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

export function createReviewViewModel(session: SessionReviewRow): ReviewViewModel {
  const diagnosis = session.execution_result;
  const hasLinkedActivity = session.has_linked_activity === true;
  const reviewState = toReviewState(session.status, diagnosis, hasLinkedActivity);
  const intent = toIntent(diagnosis?.status, reviewState.isReviewable, hasLinkedActivity);
  const bucket = toIntentBucket(session.intent_category, session.sport);

  const defaultWhyItMatters = reviewState.isReviewable
    ? intent.label === "Matched intent"
      ? "Matching the planned session intent preserves the adaptation you wanted from the day and supports the rest of the week."
      : "Execution consistency protects the intended training effect and helps the rest of the week land as planned."
    : "A useful review starts with a completed session, because that is what makes coaching advice trustworthy.";

  const defaultNextAction = reviewState.isReviewable
    ? intent.label === "Matched intent"
      ? "Good control. Keep the same execution approach next time."
      : "Start the next similar session with one clear execution cue and protect it early."
    : hasLinkedActivity
      ? "No re-upload is needed. Give the linked workout time to process, and only re-link it if the session attachment is wrong."
      : "Complete or sync the workout first, then come back for a more specific review.";

  const executionSummary = getString(diagnosis, ["executionSummary", "executionScoreSummary", "summary"]);
  const whyItMatters = getString(
    diagnosis,
    ["whyItMatters", "why_it_matters"],
    defaultWhyItMatters
  );
  const nextAction = getString(
    diagnosis,
    ["recommendedNextAction", "recommended_next_action"],
    defaultNextAction
  );

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
  const firstHalfHr = getNumber(diagnosis, ["firstHalfAvgHr", "first_half_avg_hr"]);
  const lastHalfHr = getNumber(diagnosis, ["lastHalfAvgHr", "last_half_avg_hr"]);
  const firstHalfPace = getNumber(diagnosis, ["firstHalfPaceSPerKm", "first_half_pace_s_per_km"]);
  const lastHalfPace = getNumber(diagnosis, ["lastHalfPaceSPerKm", "last_half_pace_s_per_km"]);

  const hrDrift = firstHalfHr && lastHalfHr ? lastHalfHr / firstHalfHr : null;
  const paceFade = firstHalfPace && lastHalfPace ? lastHalfPace / firstHalfPace : null;

  const actualExecutionSummary = summarizeActualExecution({
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
  });

  const mainGap = deriveMainGap({
    isReviewable: reviewState.isReviewable,
    bucket,
    intentLabel: intent.label,
    timeAbove,
    intervalCompletion,
    durationCompletion,
    hrDrift,
    paceFade
  });

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
      : scoreBand === "On target"
        ? "success"
        : scoreBand === "Partial match"
          ? "warning"
          : "risk";

  const usefulMetrics = [
    durationCompletion !== null ? { label: "Duration completed", value: pct(durationCompletion) } : null,
    intervalCompletion !== null ? { label: "Key reps completed", value: pct(intervalCompletion) } : null,
    timeAbove !== null ? { label: "Time above target", value: pct(timeAbove) } : null,
    hrDrift !== null && bucket !== "threshold" ? { label: "Late HR drift", value: pct(hrDrift - 1) } : null,
    paceFade !== null && bucket === "long" ? { label: "Late pace fade", value: pct(paceFade - 1) } : null,
    avgHr || avgPower
      ? {
          label: "Average load",
          value: `${avgHr ? `${Math.round(avgHr)} bpm` : ""}${avgHr && avgPower ? " · " : ""}${avgPower ? `${Math.round(avgPower)} w` : ""}`
        }
      : null
  ].filter((metric): metric is { label: string; value: string } => metric !== null);

  const plannedIntent = session.intent_category?.trim() || `${getDisciplineMeta(session.sport).label} session intent`;
  const weekAction = getString(
    diagnosis,
    ["suggestedWeekAdjustment", "suggested_week_adjustment", "weeklyAdjustment", "weekly_adjustment"],
    deriveWeekAction({ intentLabel: intent.label, bucket, isReviewable: reviewState.isReviewable })
  );

  const unlockTitle = reviewState.isReviewable ? "Review evidence" : "What unlocks review";
  const unlockDetail = reviewState.isReviewable
    ? usefulMetrics.length > 0
      ? "This review is grounded in the available duration, interval, and intensity evidence from the uploaded session."
      : "This review is directional for now because the uploaded session includes limited measurable evidence."
    : hasLinkedActivity
      ? "The workout is already attached to this planned session. Review unlocks once execution analysis catches up for the linked activity."
    : "Complete or sync the workout to unlock planned vs actual analysis, intent result, and a trustworthy Execution Score.";

  const followUpPrompts = reviewState.isReviewable
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
    plannedIntent,
    actualExecutionSummary,
    mainGap,
    usefulMetrics,
    whyItMatters,
    nextAction,
    weekAction,
    unlockTitle,
    unlockDetail,
    followUpIntro: reviewState.isReviewable
      ? "Use coach follow-up to understand the flag, decide whether to repeat the session, and protect the rest of the week."
      : "Coach follow-up becomes more useful once the workout is completed, but you can still ask how to handle the week from here.",
    followUpPrompts
  };
}
