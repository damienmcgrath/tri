import { getMetric, ratio } from "./session-diagnosis-algorithm";
import type {
  ComponentScore,
  ComponentScores,
  DiagnosisConfidence,
  DiagnosisDraft,
  ExecutionScoreBand,
  IntentBucket,
  IssueKey,
  SessionDiagnosisInput,
  Sport
} from "./session-diagnosis";

export function getConfidence(evidenceCount: number): DiagnosisConfidence {
  if (evidenceCount >= 4) return "high";
  if (evidenceCount >= 2) return "medium";
  return "low";
}

export function getExecutionScoreBand(score: number): ExecutionScoreBand {
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

export function deriveExecutionScore(bucket: IntentBucket, draft: DiagnosisDraft): { score: number | null; band: ExecutionScoreBand | null; provisional: boolean } {
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

  // When the plan specifies target bands, require data that matches a specified
  // band so the scorer can actually use it (e.g. power-only telemetry doesn't
  // satisfy an HR-targeted threshold check). When no bands are set at all,
  // accept raw data presence — the plan didn't specify targets, so the device
  // data isn't "missing"; it just can't be compared against a plan.
  const hasTargetBands = Boolean(planned.targetBands);
  const effectiveHr = hasTargetBands ? hasHr : hasAnyHr;
  const effectivePower = hasTargetBands ? hasPower : hasAnyPower;
  const effectivePace = hasTargetBands ? hasPace : hasAnyPace;

  const runIntensityPresent = effectiveHr || effectivePower || effectivePace || hasTimeAbove;
  const runIntensityLabel = planned.targetBands?.pace ? "HR or pace data" : "HR data";
  switch (bucket) {
    case "easy_endurance":
    case "recovery":
      critical.push({
        key: "intensity",
        present: sport === "run" ? runIntensityPresent : effectiveHr || effectivePower || hasTimeAbove,
        label: sport === "bike" ? "HR or power" : sport === "run" ? runIntensityLabel : "HR data"
      });
      critical.push({ key: "duration", present: hasDuration, label: "duration tracking" });
      break;
    case "threshold_quality":
      critical.push({
        key: "intensity",
        present: sport === "run" ? effectiveHr || effectivePower || effectivePace : effectiveHr || effectivePower,
        label: sport === "bike" ? "power or HR" : sport === "run" ? runIntensityLabel : "HR data"
      });
      critical.push({ key: "completion", present: hasIntervals || hasDuration, label: "interval or duration completion" });
      break;
    case "long_endurance":
      critical.push({ key: "duration", present: hasDuration, label: "duration tracking" });
      critical.push({
        key: "intensity",
        present: sport === "run" ? effectiveHr || effectivePower || effectivePace : effectiveHr || effectivePower,
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

export function computeComponentScores(input: SessionDiagnosisInput, draft: DiagnosisDraft, bucket: IntentBucket): ComponentScores | null {
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
