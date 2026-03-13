export type Sport = "swim" | "bike" | "run" | "strength" | "other";

export type IntentMatchStatus = "matched_intent" | "partial_intent" | "missed_intent";
export type DiagnosisConfidence = "high" | "medium" | "low";
export type ExecutionScoreBand = "On target" | "Partial match" | "Missed intent";

export type PlannedTargetBand = {
  hr?: { min?: number; max?: number };
  power?: { min?: number; max?: number };
  pace?: { min?: number; max?: number };
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
  const avgPower = input.actual.avgPower ?? getMetric(input.actual, "avg_power");
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
  if (score >= 85) return "On target";
  if (score >= 65) return "Partial match";
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

  const score = deriveExecutionScore(bucket, draft);
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
    evidenceCount: draft.evidenceCount
  };
}
