import type { SupabaseClient } from "@supabase/supabase-js";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import type { ComponentScores } from "@/lib/coach/session-diagnosis";
import type {
  ExecutionEvidence,
  CoachVerdict,
  PersistedExecutionReview,
  WeeklyExecutionBrief,
} from "@/lib/execution-review-types";

// ---------------------------------------------------------------------------
// Internal helpers (shared with execution-review.ts via re-export)
// ---------------------------------------------------------------------------

function toLegacyStatus(status: "on_target" | "partial" | "missed") {
  if (status === "on_target") return "matched_intent" as const;
  if (status === "missed") return "missed_intent" as const;
  return "partial_intent" as const;
}

function nextCallFromEvidence(intentMatch: "on_target" | "partial" | "missed", executionCost: "low" | "moderate" | "high" | "unknown") {
  if (intentMatch === "on_target" && executionCost === "low") return "move_on" as const;
  if (intentMatch === "missed" && executionCost === "high") return "protect_recovery" as const;
  if (intentMatch === "missed") return "repeat_session" as const;
  if (executionCost === "high") return "adjust_next_key_session" as const;
  return "proceed_with_caution" as const;
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
  if (typeof evidence.actual.avgIntervalPower === "number") {
    points.push(`average interval power ${Math.round(evidence.actual.avgIntervalPower)} w`);
  }
  if (evidence.actual.avgPower !== null) {
    const label = evidence.actual.avgIntervalPower != null ? "average power (session)" : "average power";
    points.push(`${label} ${Math.round(evidence.actual.avgPower)} w`);
  }
  if (typeof evidence.actual.normalizedPower === "number") {
    points.push(`normalized power ${Math.round(evidence.actual.normalizedPower)} w`);
  }
  if (typeof evidence.actual.variabilityIndex === "number") {
    points.push(`variability index ${evidence.actual.variabilityIndex.toFixed(2)}`);
  }
  if (typeof evidence.actual.trainingStressScore === "number") {
    points.push(`TSS ${Math.round(evidence.actual.trainingStressScore)}`);
  }
  return points.slice(0, 4);
}

// Re-export helpers so the main execution-review module can import them
// instead of duplicating them.
export { toLegacyStatus, nextCallFromEvidence, buildEvidenceSummary };

// ---------------------------------------------------------------------------
// Persistence functions
// ---------------------------------------------------------------------------

export function toPersistedExecutionReview(args: {
  linkedActivityId: string | null;
  evidence: ExecutionEvidence;
  verdict: CoachVerdict | null;
  narrativeSource?: "ai" | "fallback" | "legacy_unknown";
  createdAt?: string;
  updatedAt?: string;
  componentScores?: ComponentScores | null;
}): PersistedExecutionReview {
  const createdAt = args.createdAt ?? new Date().toISOString();
  const updatedAt = args.updatedAt ?? createdAt;
  const legacyStatus = toLegacyStatus(args.evidence.rulesSummary.intentMatch);
  const nextCall = args.verdict?.sessionVerdict.nextCall ?? nextCallFromEvidence(args.evidence.rulesSummary.intentMatch, args.evidence.rulesSummary.executionCost);
  const suggestedWeekAction = args.verdict?.explanation.whatToDoThisWeek ?? "Keep the rest of the week stable and use this review as guidance for the next similar session.";

  return {
    version: 2,
    linkedActivityId: args.linkedActivityId,
    deterministic: args.evidence,
    verdict: args.verdict,
    narrativeSource: args.narrativeSource ?? (args.verdict ? "fallback" : "legacy_unknown"),
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
    avgIntervalPower: args.evidence.actual.avgIntervalPower ?? null,
    normalizedPower: args.evidence.actual.normalizedPower ?? null,
    trainingStressScore: args.evidence.actual.trainingStressScore ?? null,
    intensityFactor: args.evidence.actual.intensityFactor ?? null,
    totalWorkKj: args.evidence.actual.totalWorkKj ?? null,
    avgCadence: args.evidence.actual.avgCadence ?? null,
    avgPacePer100mSec: args.evidence.actual.avgPacePer100mSec ?? null,
    bestPacePer100mSec: args.evidence.actual.bestPacePer100mSec ?? null,
    avgStrokeRateSpm: args.evidence.actual.avgStrokeRateSpm ?? null,
    maxStrokeRateSpm: args.evidence.actual.maxStrokeRateSpm ?? null,
    avgSwolf: args.evidence.actual.avgSwolf ?? null,
    elevationGainM: args.evidence.actual.elevationGainM ?? null,
    elevationLossM: args.evidence.actual.elevationLossM ?? null,
    poolLengthM: args.evidence.actual.poolLengthM ?? null,
    lengthCount: args.evidence.actual.lengthCount ?? null,
    hrZoneTimeSec: args.evidence.actual.hrZoneTimeSec ?? null,
    paceZoneTimeSec: args.evidence.actual.paceZoneTimeSec ?? null,
    maxHr: args.evidence.actual.maxHr ?? null,
    maxPower: args.evidence.actual.maxPower ?? null,
    firstHalfAvgHr: args.evidence.actual.splitMetrics?.firstHalfAvgHr ?? null,
    lastHalfAvgHr: args.evidence.actual.splitMetrics?.lastHalfAvgHr ?? null,
    firstHalfPaceSPerKm: args.evidence.actual.splitMetrics?.firstHalfPaceSPerKm ?? null,
    lastHalfPaceSPerKm: args.evidence.actual.splitMetrics?.lastHalfPaceSPerKm ?? null,
    firstHalfAvgCadence: args.evidence.actual.splitMetrics?.firstHalfAvgCadence ?? null,
    lastHalfAvgCadence: args.evidence.actual.splitMetrics?.lastHalfAvgCadence ?? null,
    firstHalfPacePer100mSec: args.evidence.actual.splitMetrics?.firstHalfPacePer100mSec ?? null,
    lastHalfPacePer100mSec: args.evidence.actual.splitMetrics?.lastHalfPacePer100mSec ?? null,
    firstHalfStrokeRate: args.evidence.actual.splitMetrics?.firstHalfStrokeRate ?? null,
    lastHalfStrokeRate: args.evidence.actual.splitMetrics?.lastHalfStrokeRate ?? null,
    executionCost: args.evidence.rulesSummary.executionCost,
    missingEvidence: args.evidence.missingEvidence,
    componentScores: args.componentScores ?? null
  };
}

export function parsePersistedExecutionReview(payload: Record<string, unknown> | null | undefined): PersistedExecutionReview | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.version === 2 && payload.deterministic && typeof payload.deterministic === "object") {
    const narrativeSource: PersistedExecutionReview["narrativeSource"] =
      payload.narrativeSource === "ai" || payload.narrativeSource === "fallback" || payload.narrativeSource === "legacy_unknown"
        ? payload.narrativeSource
        : "legacy_unknown";
    return {
      ...(payload as unknown as PersistedExecutionReview),
      narrativeSource
    };
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
  extraActivityCount?: number;
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
  // Pattern synthesis: name the most common recurring issue across reviewed sessions so
  // the brief reads as a coaching observation instead of a universal hedge.
  const issueCounts = new Map<string, number>();
  for (const item of reviews) {
    for (const issue of item.review.deterministic.detectedIssues ?? []) {
      const code = issue.code;
      if (!code) continue;
      issueCounts.set(code, (issueCounts.get(code) ?? 0) + 1);
    }
  }
  const [dominantIssue, dominantIssueCount] = Array.from(issueCounts.entries())
    .sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const PATTERN_MESSAGES: Record<string, string> = {
    shortened: `${dominantIssueCount} of your last ${reviewedCount} sessions ran shorter than planned. Is that a schedule issue or a recovery issue? Worth a quick check-in.`,
    too_hard: `${dominantIssueCount} of your last ${reviewedCount} easy sessions ran hotter than the target zone. Worth checking whether it's pacing or cumulative fatigue driving intensity up.`,
    late_drift: `${dominantIssueCount} of your last ${reviewedCount} sessions drifted upward in the second half. That's usually a fueling or pacing cue.`,
    incomplete_reps: `${dominantIssueCount} of your last ${reviewedCount} sessions cut reps short. Protect the next key set and flag if recovery feels off.`,
    faded_late: `${dominantIssueCount} of your last ${reviewedCount} long sessions faded in the final third. Open more conservatively and fuel earlier next time.`
  };
  const patternNote =
    reviewedCount >= 3 && dominantIssueCount >= 2 && PATTERN_MESSAGES[dominantIssue]
      ? PATTERN_MESSAGES[dominantIssue]
      : null;

  const sessionsNeedingAttention = reviews
    .filter((item) => item.review.deterministic.rulesSummary.intentMatch !== "on_target")
    .slice(0, 3)
    .map((item) => ({
      sessionId: item.id,
      sessionName: item.name,
      scoreHeadline: item.review.verdict?.sessionVerdict.headline ?? item.review.executionScoreSummary,
      reason: item.review.verdict?.explanation.whyItMatters ?? item.review.whyItMatters
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
  const extraCount = args.extraActivityCount ?? 0;
  const extraNote = extraCount > 0 ? ` ${extraCount} extra session${extraCount === 1 ? "" : "s"} also logged this week.` : "";

  return {
    weekHeadline:
      reviewedCount === 0
        ? extraCount > 0
          ? `${extraCount} extra session${extraCount === 1 ? "" : "s"} logged — reviews building`
          : "Reviews are still building, so keep the week steady"
        : missedCount > 0
          ? "Execution is mostly on track, but one key session came up short"
          : partialCount > 0
            ? "Execution is on track overall, with a few sessions needing attention"
            : "Execution is on track this week",
    weekSummary:
      reviewedCount === 0
        ? `Early uploads are in.${extraNote} Hold the current structure for now, then let the next reviewed sessions sharpen the call.`
        : `${extraCount > 0 ? `${extraCount} extra ${extraCount === 1 ? "session" : "sessions"} also logged this week.` : "Execution reviewed against this week's training intent."}${contextCue ? ` ${contextCue} noted.` : ""}`,
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
    // Prefer naming a concrete pattern over universal "provisional" hedging. Only
    // surface the provisional count when it's a meaningful minority and no richer
    // pattern is available to lead with.
    confidenceNote:
      patternNote
        ?? (provisionalCount > 0 && provisionalCount < reviewedCount
          ? `${provisionalCount} of ${reviewedCount} review${reviewedCount === 1 ? "" : "s"} still need richer data to firm up the read.`
          : null)
  } satisfies WeeklyExecutionBrief;
}
