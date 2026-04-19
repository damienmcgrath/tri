export type Sport = "swim" | "bike" | "run" | "strength" | "other";

export type IntentMatchStatus = "matched_intent" | "partial_intent" | "missed_intent";
type DiagnosisConfidence = "high" | "medium" | "low";
type ExecutionScoreBand = "On target" | "Solid" | "Partial match" | "Missed intent";

export type PlannedTargetBand = {
  hr?: { min?: number; max?: number };
  power?: { min?: number; max?: number };
  pace?: { min?: number; max?: number };
  /** Swim pace target in seconds per 100 m (e.g. 115 = 1:55/100m) */
  pace100m?: { min?: number; max?: number };
};

type PlannedSessionDiagnosisInput = {
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

type CompletedSessionDiagnosisInput = {
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

type IntentBucket = "easy_endurance" | "recovery" | "threshold_quality" | "long_endurance" | "swim_strength" | "unknown";

type IssueKey =
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

type DiagnosisDraft = {
  status: IntentMatchStatus;
  issues: IssueKey[];
  evidenceCount: number;
};

function toIntentBucket(input: PlannedSessionDiagnosisInput): IntentBucket {
  const text = `${input.intentCategory ?? ""}`.toLowerCase();
  const sport = input.sport ?? "other";

  if (/recovery/.test(text)) return "recovery";
  if (/threshold|tempo|vo2|interval|quality|anaerobic/.test(text)) return "threshold_quality";
  if (/long/.test(text)) return "long_endurance";
  if (sport === "swim" || sport === "strength") return "swim_strength";
  if (/easy|endurance|aerobic|z2|base/.test(text)) return "easy_endurance";
  return "unknown";
}

function getMetric(actual: CompletedSessionDiagnosisInput, key: string): number | null {
  const direct = (actual as unknown as Record<string, number | null | undefined>)[key];
  if (typeof direct === "number") return direct;
  const nested = actual.metrics?.[key];
  return typeof nested === "number" ? nested : null;
}

function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!numerator || !denominator || denominator <= 0) return null;
  return numerator / denominator;
}

function evaluateEasyEndurance(input: SessionDiagnosisInput): DiagnosisDraft {
  const issues: IssueKey[] = [];
  let evidenceCount = 0;
  const avgHr = input.actual.avgHr ?? getMetric(input.actual, "avg_hr");
  const avgPower = input.actual.avgPower ?? getMetric(input.actual, "avg_power");
  const targetHrMax = input.planned.targetBands?.hr?.max;
  const targetPowerMax = input.planned.targetBands?.power?.max;
  const timeAbove = input.actual.timeAboveTargetPct;
  const drift = ratio(input.actual.splitMetrics?.lastHalfAvgHr, input.actual.splitMetrics?.firstHalfAvgHr);
  const variability = input.actual.variabilityIndex;

  if (typeof timeAbove === "number") {
    evidenceCount += 1;
    if (timeAbove >= 0.25) issues.push("too_hard");
  }

  if (targetHrMax && avgHr) {
    evidenceCount += 1;
    if (avgHr > targetHrMax * 1.05) issues.push("high_hr");
  }

  if (targetPowerMax && avgPower) {
    evidenceCount += 1;
    if (avgPower > targetPowerMax * 1.08) issues.push("too_hard");
  }

  if (drift) {
    evidenceCount += 1;
    if (drift > 1.06) issues.push("late_drift");
  }

  if (variability) {
    evidenceCount += 1;
    if (variability > 1.12) issues.push("too_variable");
  }

  if (issues.length >= 3) return { status: "missed_intent", issues, evidenceCount };
  if (issues.length >= 1) return { status: "partial_intent", issues, evidenceCount };
  return { status: "matched_intent", issues, evidenceCount };
}

function evaluateRecovery(input: SessionDiagnosisInput): DiagnosisDraft {
  const draft = evaluateEasyEndurance(input);
  const upgradedIssues = [...draft.issues];

  if (draft.status !== "matched_intent") {
    if (!upgradedIssues.includes("too_hard")) upgradedIssues.push("too_hard");
  }

  const status: IntentMatchStatus = upgradedIssues.length >= 2 ? "missed_intent" : draft.status;
  return { status, issues: upgradedIssues, evidenceCount: draft.evidenceCount };
}

function evaluateThreshold(input: SessionDiagnosisInput): DiagnosisDraft {
  const issues: IssueKey[] = [];
  let evidenceCount = 0;
  const avgHr = input.actual.avgHr ?? getMetric(input.actual, "avg_hr");
  const sessionAvgPower = input.actual.avgPower ?? getMetric(input.actual, "avg_power");
  // Prefer interval-only power for threshold evaluation (excludes warm-up/cool-down/recovery)
  const avgPower = input.actual.avgIntervalPower ?? sessionAvgPower;
  const targetHr = input.planned.targetBands?.hr;
  const targetPower = input.planned.targetBands?.power;
  const completion =
    input.actual.intervalCompletionPct ??
    ratio(input.actual.completedIntervals, input.planned.plannedIntervals) ??
    null;
  const durationCompletion = ratio(input.actual.durationSec, input.planned.plannedDurationSec ?? null);
  const variability = input.actual.variabilityIndex;

  if (targetPower?.min && avgPower) {
    evidenceCount += 1;
    if (avgPower < targetPower.min * 0.92) issues.push("under_target");
  }

  if (targetPower?.max && avgPower) {
    evidenceCount += 1;
    if (avgPower > targetPower.max * 1.06) issues.push("over_target");
  }

  if (targetHr?.min && avgHr) {
    evidenceCount += 1;
    if (avgHr < targetHr.min * 0.92) issues.push("under_target");
  }

  if (targetHr?.max && avgHr) {
    evidenceCount += 1;
    if (avgHr > targetHr.max * 1.06) issues.push("over_target");
  }

  if (typeof completion === "number") {
    evidenceCount += 1;
    if (completion < 0.85) issues.push("incomplete_reps");
  }

  if (typeof durationCompletion === "number") {
    evidenceCount += 1;
    if (durationCompletion < 0.85) issues.push("shortened");
  }

  if (typeof variability === "number") {
    evidenceCount += 1;
    if (variability > 1.18) issues.push("inconsistent_execution");
  }

  if (issues.length >= 3) return { status: "missed_intent", issues, evidenceCount };
  if (issues.length >= 1) return { status: "partial_intent", issues, evidenceCount };
  return { status: "matched_intent", issues, evidenceCount };
}

function evaluateLongEndurance(input: SessionDiagnosisInput): DiagnosisDraft {
  const issues: IssueKey[] = [];
  let evidenceCount = 0;

  const hrRise = ratio(input.actual.splitMetrics?.firstHalfAvgHr, input.actual.splitMetrics?.lastHalfAvgHr);
  const paceFade = ratio(input.actual.splitMetrics?.lastHalfPaceSPerKm, input.actual.splitMetrics?.firstHalfPaceSPerKm);
  const durationCompletion = ratio(input.actual.durationSec, input.planned.plannedDurationSec ?? null);

  if (hrRise) {
    evidenceCount += 1;
    if (hrRise > 1.06) issues.push("started_too_hard");
  }

  if (paceFade) {
    evidenceCount += 1;
    if (paceFade > 1.12) issues.push("faded_late");
  }

  if (typeof input.actual.timeAboveTargetPct === "number") {
    evidenceCount += 1;
    if (input.actual.timeAboveTargetPct > 0.2) issues.push("too_hard");
  }

  if (typeof durationCompletion === "number") {
    evidenceCount += 1;
    if (durationCompletion < 0.9) issues.push("shortened");
  }

  if (issues.length >= 3) return { status: "missed_intent", issues, evidenceCount };
  if (issues.length >= 1) return { status: "partial_intent", issues, evidenceCount };
  return { status: "matched_intent", issues, evidenceCount };
}

function evaluateSwimStrength(input: SessionDiagnosisInput): DiagnosisDraft {
  const issues: IssueKey[] = [];
  let evidenceCount = 0;

  const completion =
    input.actual.intervalCompletionPct ??
    ratio(input.actual.completedIntervals, input.planned.plannedIntervals) ??
    null;
  const durationCompletion = ratio(input.actual.durationSec, input.planned.plannedDurationSec ?? null);

  if (typeof completion === "number") {
    evidenceCount += 1;
    if (completion < 0.8) issues.push("incomplete_reps");
  }

  if (typeof durationCompletion === "number") {
    evidenceCount += 1;
    if (durationCompletion < 0.8) issues.push("shortened");
  }

  if (issues.length >= 2) return { status: "missed_intent", issues, evidenceCount };
  if (issues.length === 1) return { status: "partial_intent", issues, evidenceCount };
  return { status: "matched_intent", issues, evidenceCount };
}

function evaluateUnknown(input: SessionDiagnosisInput): DiagnosisDraft {
  const durationCompletion = ratio(input.actual.durationSec, input.planned.plannedDurationSec ?? null);

  if (typeof durationCompletion !== "number") {
    return { status: "partial_intent", issues: ["sparse_data"], evidenceCount: 0 };
  }

  if (durationCompletion >= 0.9) return { status: "matched_intent", issues: [], evidenceCount: 1 };
  if (durationCompletion >= 0.75) return { status: "partial_intent", issues: ["shortened"], evidenceCount: 1 };
  return { status: "missed_intent", issues: ["shortened"], evidenceCount: 1 };
}

function getConfidence(evidenceCount: number): DiagnosisConfidence {
  if (evidenceCount >= 4) return "high";
  if (evidenceCount >= 2) return "medium";
  return "low";
}

function getExecutionScoreBand(score: number): ExecutionScoreBand {
  if (score >= 90) return "On target";
  if (score >= 75) return "Solid";
  if (score >= 55) return "Partial match";
  return "Missed intent";
}

function getIssuePenalty(bucket: IntentBucket, issue: IssueKey): number {
  const weightedPenalty: Record<IntentBucket, Partial<Record<IssueKey, number>>> = {
    easy_endurance: { too_hard: 22, high_hr: 18, late_drift: 14, too_variable: 10, shortened: 10 },
    recovery: { too_hard: 28, high_hr: 22, too_variable: 12, late_drift: 10 },
    threshold_quality: { incomplete_reps: 24, under_target: 18, over_target: 16, inconsistent_execution: 14, shortened: 14 },
    long_endurance: { started_too_hard: 20, faded_late: 20, shortened: 16, too_hard: 14 },
    swim_strength: { incomplete_reps: 22, shortened: 18 },
    unknown: { shortened: 18, sparse_data: 16 }
  };

  return weightedPenalty[bucket][issue] ?? 12;
}

function deriveExecutionScore(bucket: IntentBucket, draft: DiagnosisDraft): { score: number | null; band: ExecutionScoreBand | null; provisional: boolean } {
  if (draft.evidenceCount === 0) {
    return { score: null, band: null, provisional: true };
  }

  const uniqueIssues = [...new Set(draft.issues)];
  const totalPenalty = uniqueIssues.reduce((sum, issue) => sum + getIssuePenalty(bucket, issue), 0);
  const statusPenalty = draft.status === "missed_intent" ? 8 : draft.status === "partial_intent" ? 3 : 0;
  const evidenceRelief = Math.min(4, draft.evidenceCount);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty - statusPenalty + evidenceRelief)));
  return { score, band: getExecutionScoreBand(score), provisional: draft.evidenceCount < 2 };
}

function getSummary(status: IntentMatchStatus, issues: IssueKey[], bucket: IntentBucket): string {
  if (status === "matched_intent") {
    return "Execution stayed aligned with the planned intent.";
  }

  const issueText: Record<IssueKey, string> = {
    too_hard: "effort ran too hard for the planned day",
    too_variable: "effort fluctuated more than intended",
    high_hr: "heart rate sat above the intended aerobic range",
    late_drift: "effort drifted upward in the second half",
    under_target: "quality work sat below target",
    over_target: "quality work overshot the target",
    incomplete_reps: "planned reps were not fully completed",
    shortened: "session finished shorter than planned",
    inconsistent_execution: "interval execution was inconsistent",
    started_too_hard: "the session started too aggressively",
    faded_late: "late-session fade suggests pacing or fueling issues",
    sparse_data: "available data is too limited for a strict diagnosis"
  };

  const topIssue = issueText[issues[0] ?? "sparse_data"];

  if (bucket === "recovery") {
    return `Recovery intent was not fully met: ${topIssue}.`;
  }

  return status === "missed_intent"
    ? `Session missed intent: ${topIssue}.`
    : `Session partially matched intent: ${topIssue}.`;
}

function getWhyItMatters(status: IntentMatchStatus, issues: IssueKey[], bucket: IntentBucket): string {
  if (status === "matched_intent") {
    if (bucket === "recovery") {
      return "Well-controlled recovery sessions help the next quality work land without unnecessary fatigue carryover.";
    }

    if (bucket === "threshold_quality") {
      return "Hitting the planned quality stimulus is what makes these sessions worth carrying through the week.";
    }

    return "Matching the planned session intent preserves the adaptation you wanted from the day and supports the rest of the week.";
  }

  if (issues.includes("faded_late") || issues.includes("started_too_hard")) {
    return "Pacing errors in longer sessions can compromise durability and race-day execution.";
  }

  if (issues.includes("too_hard") || issues.includes("high_hr")) {
    return "Repeatedly overcooking easy days can blunt adaptation and increase fatigue carryover.";
  }

  if (issues.includes("under_target") || issues.includes("incomplete_reps")) {
    return "Missing quality targets reduces the specific stimulus this workout was meant to deliver.";
  }

  if (issues.includes("sparse_data")) {
    return "Low data quality means this diagnosis should be treated as directional, not definitive.";
  }

  return "Execution drift from intent can lower the training value of the session.";
}

function getNextAction(status: IntentMatchStatus, issues: IssueKey[], bucket: IntentBucket): string {
  if (status === "matched_intent") {
    if (bucket === "recovery") {
      return "Good control. Keep the same easy-day discipline on the next recovery session.";
    }

    if (bucket === "threshold_quality") {
      return "Good control. Keep the same pacing and execution structure on the next quality session.";
    }

    return "Good control. Keep the same execution approach next time.";
  }

  if (issues.includes("too_hard") || issues.includes("high_hr")) {
    return "On the next similar session, cap intensity early and keep the first third deliberately easy.";
  }

  if (issues.includes("under_target")) {
    return "Repeat this quality set with slightly longer recoveries so you can hit target output consistently.";
  }

  if (issues.includes("over_target")) {
    return "Start the first rep 2-3% easier and build only if control stays solid through the final reps.";
  }

  if (issues.includes("incomplete_reps") || issues.includes("shortened")) {
    return "Keep the next session structure intact, even if you reduce intensity modestly to complete all work.";
  }

  if (issues.includes("faded_late") || issues.includes("started_too_hard")) {
    return "Open long sessions more conservatively and plan fueling earlier to protect late-session quality.";
  }

  if (bucket === "swim_strength") {
    return "Prioritize full session completion and smooth execution before adding extra intensity.";
  }

  return "Use this result as feedback and aim for tighter control against the planned intent next time.";
}

type DataCompleteness = {
  pct: number;
  missingCritical: string[];
  /** The dominant intensity metric for this sport/intent (e.g. "HR" for easy bike, "power" for threshold bike, "pace" for run). Null if none applies. */
  missingDominantMetric: string | null;
};

/**
 * The single metric that most directly confirms intent for a sport + intent bucket.
 * When this metric is absent, Intent Match cannot confidently score in the "matched"
 * range even when no issues are detected — absence of a signal is not evidence of success.
 */
function getDominantIntensityMetric(sport: Sport, bucket: IntentBucket): "hr" | "power" | "pace" | null {
  if (sport === "bike") {
    // For easy / long / recovery bikes, HR is the dominant effort signal.
    // Power can look clean while the athlete actually pushed harder in response to
    // wind, terrain, traffic, etc. HR is the physiology.
    if (bucket === "easy_endurance" || bucket === "recovery" || bucket === "long_endurance") {
      return "hr";
    }
    if (bucket === "threshold_quality") {
      return "power";
    }
    return "hr";
  }
  if (sport === "run") {
    return "pace";
  }
  // Pool swim watches rarely provide continuous pace; interval completion + duration
  // is the primary execution signal for pool-based swim sessions. Leave swim without
  // a dominant metric so the cap doesn't fire on sparse-but-complete pool swims.
  return null;
}

function computeDataCompleteness(input: SessionDiagnosisInput, bucket: IntentBucket): DataCompleteness {
  const actual = input.actual;
  const planned = input.planned;
  const sport = planned.sport ?? "other";

  const hasHr = Boolean((actual.avgHr ?? getMetric(actual, "avg_hr")) && planned.targetBands?.hr);
  const hasPower = Boolean((actual.avgIntervalPower ?? actual.avgPower ?? getMetric(actual, "avg_power")) && planned.targetBands?.power);
  const hasPace = Boolean((actual.avgPaceSPerKm ?? getMetric(actual, "avg_pace_s_per_km")) && planned.targetBands?.pace);
  const hasTimeAbove = typeof actual.timeAboveTargetPct === "number";
  const hasIntervals = typeof actual.intervalCompletionPct === "number" || Boolean(actual.completedIntervals && planned.plannedIntervals);
  const hasDuration = Boolean(actual.durationSec && planned.plannedDurationSec);
  const hasSplits = Boolean(actual.splitMetrics?.firstHalfAvgHr || actual.splitMetrics?.firstHalfPaceSPerKm || actual.splitMetrics?.firstHalfAvgPower);
  const hasAnyHr = Boolean(actual.avgHr ?? getMetric(actual, "avg_hr"));
  const hasAnyPower = Boolean(actual.avgIntervalPower ?? actual.avgPower ?? getMetric(actual, "avg_power"));
  const hasAnyPace = Boolean(actual.avgPaceSPerKm ?? getMetric(actual, "avg_pace_s_per_km"));

  const critical: Array<{ key: string; present: boolean; label: string }> = [];

  // For critical data checks, use raw data presence (hasAny*) — not the
  // target-band-gated versions (hasHr/hasPower/hasPace). The device recorded
  // the data even if the plan didn't specify target bands to compare against.
  // Target-band awareness is handled separately by the intent-match scorer.
  const runIntensityPresent = hasAnyHr || hasAnyPower || hasAnyPace || hasTimeAbove;
  const runIntensityLabel = planned.targetBands?.pace ? "HR or pace data" : "HR data";
  switch (bucket) {
    case "easy_endurance":
    case "recovery":
      critical.push({
        key: "intensity",
        present: sport === "run" ? runIntensityPresent : hasAnyHr || hasAnyPower || hasTimeAbove,
        label: sport === "bike" ? "HR or power" : sport === "run" ? runIntensityLabel : "HR data"
      });
      critical.push({ key: "duration", present: hasDuration, label: "duration tracking" });
      break;
    case "threshold_quality":
      critical.push({
        key: "intensity",
        present: sport === "run" ? hasAnyHr || hasAnyPower || hasAnyPace : hasAnyHr || hasAnyPower,
        label: sport === "bike" ? "power or HR" : sport === "run" ? runIntensityLabel : "HR data"
      });
      critical.push({ key: "completion", present: hasIntervals || hasDuration, label: "interval or duration completion" });
      break;
    case "long_endurance":
      critical.push({ key: "duration", present: hasDuration, label: "duration tracking" });
      critical.push({
        key: "intensity",
        present: sport === "run" ? hasAnyHr || hasAnyPower || hasAnyPace : hasAnyHr || hasAnyPower,
        label: sport === "bike" ? "power or HR" : sport === "run" ? runIntensityLabel : "HR data"
      });
      critical.push({ key: "splits", present: hasSplits, label: "split metrics (HR drift or pace fade)" });
      break;
    case "swim_strength":
      critical.push({ key: "completion", present: hasIntervals || hasDuration, label: "interval or duration completion" });
      break;
    case "unknown":
      critical.push({ key: "duration", present: hasDuration, label: "duration tracking" });
      break;
  }

  const hasSport = critical.length > 0;
  if (!hasSport) return { pct: 1, missingCritical: [], missingDominantMetric: null };

  const presentCount = critical.filter((c) => c.present).length;
  const pct = presentCount / critical.length;
  const missingCritical = critical.filter((c) => !c.present).map((c) => c.label);

  const dominant = getDominantIntensityMetric(sport, bucket);
  let missingDominantMetric: string | null = null;
  if (dominant === "hr" && !hasAnyHr) missingDominantMetric = "HR";
  else if (dominant === "power" && !hasAnyPower) missingDominantMetric = "power";
  else if (dominant === "pace" && !hasAnyPace && !hasAnyHr && !hasAnyPower) {
    // Run pace is the dominant signal, but the scorer accepts HR or run power as
    // valid intensity evidence everywhere else. Only flag pace as missing when none
    // of pace, HR, or power is present — otherwise a power-only run would be
    // penalized for data it doesn't actually need.
    missingDominantMetric = "pace";
  }

  return { pct, missingCritical, missingDominantMetric };
}

function computeIntentMatchScore(draft: DiagnosisDraft, bucket: IntentBucket, completeness: DataCompleteness): ComponentScore {
  const weight = 0.40;
  let score: number;
  let detail: string;

  if (draft.status === "matched_intent") {
    score = draft.evidenceCount >= 3 ? 98 : 95;
    detail = "Execution stayed aligned with the planned intent.";
  } else if (draft.status === "partial_intent") {
    const issueSeverity = draft.issues.length;
    score = Math.max(55, 85 - issueSeverity * 10);
    detail = `Intent partially met — ${draft.issues.length} issue${draft.issues.length > 1 ? "s" : ""} detected.`;
  } else {
    const issueSeverity = draft.issues.length;
    score = Math.max(0, 55 - issueSeverity * 12);
    detail = `Intent missed — execution drifted significantly from plan.`;
  }

  if (bucket === "recovery" && draft.issues.includes("too_hard")) {
    score = Math.min(score, 40);
    detail = "Recovery intent was compromised by excessive intensity.";
  }

  const uncapped = score;
  let capped = false;

  // Dominant-metric cap: when the primary effort signal for this sport/intent is
  // missing entirely, intent cannot be confirmed. Cap at 75 regardless of issue count
  // — absence of the dominant signal is not evidence of success.
  if (completeness.missingDominantMetric && draft.status === "matched_intent") {
    const dominantCap = 75;
    if (score > dominantCap) {
      score = dominantCap;
      capped = true;
      detail = `${completeness.missingDominantMetric} missing — capped; intent cannot be confirmed without it.`;
    }
  }

  // Data-completeness cap: critical evidence missing AND matched intent means we're
  // reading "no issues" from limited signals. Broader uncertainty cap.
  if (
    completeness.missingCritical.length > 0 &&
    draft.status === "matched_intent" &&
    !completeness.missingDominantMetric // already handled above with tighter cap
  ) {
    const cap = completeness.pct < 0.5 ? 65 : 78;
    if (score > cap) {
      score = cap;
      capped = true;
      detail = `${completeness.missingCritical[0]} missing — cannot confirm intent match without it.`;
    }
  }

  const clamped = Math.round(Math.max(0, Math.min(100, score)));
  return {
    score: clamped,
    weight,
    detail,
    ...(capped ? { capped: true, uncappedScore: Math.round(uncapped) } : {})
  };
}

function computePacingExecutionScore(input: SessionDiagnosisInput, draft: DiagnosisDraft): ComponentScore {
  const weight = 0.25;
  let score = 90;
  const penalties: string[] = [];

  const splits = input.actual.splitMetrics;
  const variability = input.actual.variabilityIndex;

  if (splits?.firstHalfAvgHr && splits?.lastHalfAvgHr) {
    const drift = splits.lastHalfAvgHr / splits.firstHalfAvgHr;
    if (drift > 1.08) { score -= 25; penalties.push("significant HR drift"); }
    else if (drift > 1.05) { score -= 12; penalties.push("moderate HR drift"); }
  }

  if (splits?.firstHalfPaceSPerKm && splits?.lastHalfPaceSPerKm) {
    const fade = splits.lastHalfPaceSPerKm / splits.firstHalfPaceSPerKm;
    if (fade > 1.15) { score -= 25; penalties.push("significant pace fade"); }
    else if (fade > 1.08) { score -= 12; penalties.push("moderate pace fade"); }
  }

  if (typeof variability === "number") {
    if (variability > 1.20) { score -= 20; penalties.push("high variability"); }
    else if (variability > 1.12) { score -= 10; penalties.push("moderate variability"); }
  }

  if (draft.issues.includes("started_too_hard")) { score -= 15; penalties.push("started too hard"); }
  if (draft.issues.includes("faded_late") && !penalties.some(p => p.includes("fade"))) { score -= 15; penalties.push("faded late"); }

  const detail = penalties.length > 0
    ? `Pacing issues: ${penalties.join(", ")}.`
    : "Pacing stayed controlled throughout.";

  return { score: Math.round(Math.max(0, Math.min(100, score))), weight, detail };
}

function computeCompletionScore(input: SessionDiagnosisInput, draft: DiagnosisDraft): ComponentScore {
  const weight = 0.20;
  let score = 95;
  const notes: string[] = [];

  const intervalCompletion = input.actual.intervalCompletionPct
    ?? ratio(input.actual.completedIntervals, input.planned.plannedIntervals);
  const durationCompletion = ratio(input.actual.durationSec, input.planned.plannedDurationSec ?? null);

  if (typeof intervalCompletion === "number") {
    score = Math.round(intervalCompletion * 100);
    if (intervalCompletion < 1) notes.push(`${Math.round(intervalCompletion * 100)}% intervals completed`);
  }

  if (typeof durationCompletion === "number") {
    const durationScore = Math.round(Math.min(1, durationCompletion) * 100);
    if (typeof intervalCompletion === "number") {
      score = Math.round(score * 0.6 + durationScore * 0.4);
    } else {
      score = durationScore;
    }
    if (durationCompletion < 0.95) notes.push(`${Math.round(durationCompletion * 100)}% duration completed`);
  }

  if (typeof intervalCompletion !== "number" && typeof durationCompletion !== "number") {
    score = draft.issues.includes("shortened") ? 65 : 80;
  }

  const detail = notes.length > 0
    ? notes.join("; ") + "."
    : "Session completed as planned.";

  return { score: Math.round(Math.max(0, Math.min(100, score))), weight, detail };
}

function computeRecoveryComplianceScore(input: SessionDiagnosisInput, bucket: IntentBucket): ComponentScore {
  const weight = 0.15;
  const isEasyOrRecovery = bucket === "easy_endurance" || bucket === "recovery";

  if (!isEasyOrRecovery) {
    return { score: 80, weight, detail: "Recovery compliance is neutral for non-easy sessions." };
  }

  let score = 100;
  const penalties: string[] = [];

  const timeAbove = input.actual.timeAboveTargetPct;
  if (typeof timeAbove === "number") {
    if (timeAbove >= 0.25) { score -= 35; penalties.push("significant time above target zone"); }
    else if (timeAbove >= 0.12) { score -= 18; penalties.push("moderate time above target zone"); }
  }

  const avgHr = input.actual.avgHr ?? getMetric(input.actual, "avg_hr");
  const targetHrMax = input.planned.targetBands?.hr?.max;
  if (targetHrMax && avgHr) {
    const hrExcess = avgHr / targetHrMax;
    if (hrExcess > 1.10) { score -= 30; penalties.push("HR well above ceiling"); }
    else if (hrExcess > 1.04) { score -= 15; penalties.push("HR above ceiling"); }
  }

  const avgPower = input.actual.avgPower ?? getMetric(input.actual, "avg_power");
  const targetPowerMax = input.planned.targetBands?.power?.max;
  if (targetPowerMax && avgPower) {
    const powerExcess = avgPower / targetPowerMax;
    if (powerExcess > 1.15) { score -= 30; penalties.push("power well above ceiling"); }
    else if (powerExcess > 1.05) { score -= 22; penalties.push("power above ceiling"); }
  }

  if (input.sessionTss && input.sessionTss > 80 && bucket === "recovery") {
    score -= 20;
    penalties.push("TSS too high for recovery");
  }

  const detail = penalties.length > 0
    ? `Recovery compromised: ${penalties.join(", ")}.`
    : "Easy-day intensity stayed well controlled.";

  return { score: Math.round(Math.max(0, Math.min(100, score))), weight, detail };
}

function computeComponentScores(input: SessionDiagnosisInput, draft: DiagnosisDraft, bucket: IntentBucket): ComponentScores | null {
  if (draft.evidenceCount === 0) return null;

  const completeness = computeDataCompleteness(input, bucket);
  const intentMatch = computeIntentMatchScore(draft, bucket, completeness);
  const pacingExecution = computePacingExecutionScore(input, draft);
  const completion = computeCompletionScore(input, draft);
  const recoveryCompliance = computeRecoveryComplianceScore(input, bucket);

  const composite = Math.round(
    intentMatch.score * intentMatch.weight +
    pacingExecution.score * pacingExecution.weight +
    completion.score * completion.weight +
    recoveryCompliance.score * recoveryCompliance.weight
  );

  return {
    intentMatch,
    pacingExecution,
    completion,
    recoveryCompliance,
    composite,
    dataCompletenessPct: completeness.pct,
    missingCriticalData: completeness.missingCritical,
    missingDominantMetric: completeness.missingDominantMetric
  };
}

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
