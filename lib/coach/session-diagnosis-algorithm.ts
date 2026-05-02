import type {
  CompletedSessionDiagnosisInput,
  DiagnosisDraft,
  IntentBucket,
  IntentMatchStatus,
  IssueKey,
  PlannedSessionDiagnosisInput,
  SessionDiagnosisInput
} from "./session-diagnosis";

export function toIntentBucket(input: PlannedSessionDiagnosisInput): IntentBucket {
  const text = `${input.intentCategory ?? ""}`.toLowerCase();
  const sport = input.sport ?? "other";

  if (/recovery/.test(text)) return "recovery";
  if (/threshold|tempo|vo2|interval|quality|anaerobic/.test(text)) return "threshold_quality";
  if (/long/.test(text)) return "long_endurance";
  if (sport === "swim" || sport === "strength") return "swim_strength";
  if (/easy|endurance|aerobic|z2|base/.test(text)) return "easy_endurance";
  return "unknown";
}

export function getMetric(actual: CompletedSessionDiagnosisInput, key: string): number | null {
  const direct = (actual as unknown as Record<string, number | null | undefined>)[key];
  if (typeof direct === "number") return direct;
  const nested = actual.metrics?.[key];
  return typeof nested === "number" ? nested : null;
}

export function ratio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (!numerator || !denominator || denominator <= 0) return null;
  return numerator / denominator;
}

export function evaluateEasyEndurance(input: SessionDiagnosisInput): DiagnosisDraft {
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

export function evaluateRecovery(input: SessionDiagnosisInput): DiagnosisDraft {
  const draft = evaluateEasyEndurance(input);
  const upgradedIssues = [...draft.issues];

  if (draft.status !== "matched_intent") {
    if (!upgradedIssues.includes("too_hard")) upgradedIssues.push("too_hard");
  }

  const status: IntentMatchStatus = upgradedIssues.length >= 2 ? "missed_intent" : draft.status;
  return { status, issues: upgradedIssues, evidenceCount: draft.evidenceCount };
}

export function evaluateThreshold(input: SessionDiagnosisInput): DiagnosisDraft {
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

export function evaluateLongEndurance(input: SessionDiagnosisInput): DiagnosisDraft {
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

export function evaluateSwimStrength(input: SessionDiagnosisInput): DiagnosisDraft {
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

export function evaluateUnknown(input: SessionDiagnosisInput): DiagnosisDraft {
  const durationCompletion = ratio(input.actual.durationSec, input.planned.plannedDurationSec ?? null);

  if (typeof durationCompletion !== "number") {
    return { status: "partial_intent", issues: ["sparse_data"], evidenceCount: 0 };
  }

  if (durationCompletion >= 0.9) return { status: "matched_intent", issues: [], evidenceCount: 1 };
  if (durationCompletion >= 0.75) return { status: "partial_intent", issues: ["shortened"], evidenceCount: 1 };
  return { status: "missed_intent", issues: ["shortened"], evidenceCount: 1 };
}
