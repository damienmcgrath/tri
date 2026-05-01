import { buildExtraCompletedActivities, hasConfirmedPlannedSessionLink } from "@/lib/activities/completed-activities";
import { parsePersistedExecutionReview } from "@/lib/execution-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { buildExecutionResultForSession, shouldRefreshExecutionResultFromActivity } from "@/lib/workouts/session-execution";
import { addDays, weekRangeLabel } from "@/lib/date-utils";
import type {
  WeeklyDebriefSession,
  WeeklyDebriefActivity,
  WeeklyDebriefInputs,
  WeeklyDebriefSessionSummary,
  WeeklyDebriefActivityEvidence
} from "./types";
import { weeklyDebriefFactsSchema } from "./types";
import { clamp, capitalize, formatMinutes } from "./format";
import { buildActivityEvidenceEntry, describeExtraActivityLoad, getHardestExtraActivity } from "./activity-evidence";
import {
  inferSessionStatus,
  getConfidenceNote,
  buildArtifactState,
  computeWeeklyDebriefReadiness,
  classifyWeeklyDebriefWeekShape,
  buildDeterministicNarrative,
  getSourceUpdatedAt
} from "./deterministic";
import {
  buildPositiveHighlights,
  buildPrimaryTakeaway,
  buildStatusLine,
  buildWeekTitle,
  getDominantSport
} from "./facts-narrative";
import { buildEvidenceGroups, buildFallbackEvidenceSummaries } from "./facts-evidence";
import { buildDeterministicObservations, buildDeterministicSuggestions } from "./facts-deterministic";

export function buildWeeklyDebriefFacts(input: WeeklyDebriefInputs) {
  const completionLedger = input.sessions.reduce<Record<string, number>>((acc, session) => {
    if (session.status !== "completed") return acc;
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const confirmedLinks = input.links.filter(hasConfirmedPlannedSessionLink);
  const activitiesIndex = new Map(input.activities.map((a) => [a.id, a]));
  const sessionsIndex = new Map(input.sessions.map((s) => [s.id, s]));
  const linkedActivityBySessionId = new Map<string, WeeklyDebriefActivity>();
  const linkedSessionByActivityId = new Map<string, WeeklyDebriefSession>();
  for (const link of confirmedLinks) {
    if (!link.planned_session_id || linkedActivityBySessionId.has(link.planned_session_id)) continue;
    const activity = activitiesIndex.get(link.completed_activity_id);
    const session = sessionsIndex.get(link.planned_session_id);
    if (activity) {
      linkedActivityBySessionId.set(link.planned_session_id, activity);
      if (session) linkedSessionByActivityId.set(activity.id, session);
    }
  }

  const feelsIndex = new Map((input.sessionFeels ?? []).map((f) => [f.sessionId, f]));

  const sessionSummaries: WeeklyDebriefSessionSummary[] = input.sessions
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    .map((session) => {
      const status = inferSessionStatus(session, completionLedger);
      const label = getSessionDisplayName({
        sessionName: session.session_name ?? session.type,
        subtype: session.subtype ?? session.workout_type ?? session.type,
        discipline: session.sport
      });
      const linkedActivity = linkedActivityBySessionId.get(session.id);
      const refreshedExecutionResult = linkedActivity && shouldRefreshExecutionResultFromActivity(session.execution_result ?? null, {
        id: linkedActivity.id,
        sport_type: linkedActivity.sport_type,
        duration_sec: linkedActivity.duration_sec,
        distance_m: linkedActivity.distance_m,
        avg_hr: linkedActivity.avg_hr,
        avg_power: linkedActivity.avg_power,
        metrics_v2: linkedActivity.metrics_v2 ?? null
      })
        ? buildExecutionResultForSession(
            {
              id: session.id,
              athlete_id: session.athlete_id ?? undefined,
              user_id: session.user_id ?? session.athlete_id ?? "unknown-athlete",
              sport: session.sport,
              type: session.type,
              duration_minutes: session.duration_minutes ?? null,
              intent_category: session.intent_category ?? null,
              session_name: session.session_name ?? session.type,
              session_role: session.session_role ?? null,
              status: session.status ?? "planned"
            },
            {
              id: linkedActivity.id,
              sport_type: linkedActivity.sport_type,
              duration_sec: linkedActivity.duration_sec,
              distance_m: linkedActivity.distance_m,
              avg_hr: linkedActivity.avg_hr,
              avg_power: linkedActivity.avg_power,
              metrics_v2: linkedActivity.metrics_v2 ?? null
            }
          )
        : session.execution_result ?? null;
      const review = parsePersistedExecutionReview(refreshedExecutionResult);
      const feel = feelsIndex.get(session.id);
      return {
        id: session.id,
        label,
        date: session.date,
        sport: session.sport,
        durationMinutes: Math.max(0, session.duration_minutes ?? 0),
        status,
        isKey: Boolean(session.is_key) || session.session_role?.toLowerCase() === "key",
        review,
        completedMinutes: status === "completed" ? Math.max(0, session.duration_minutes ?? 0) : 0,
        feels: feel
          ? {
              overallFeel: feel.overallFeel,
              energyLevel: feel.energyLevel,
              legsFeel: feel.legsFeel,
              motivation: feel.motivation,
              note: feel.note,
            }
          : null
      };
    });
  const linkedActivityIds = new Set(confirmedLinks.map((link) => link.completed_activity_id));
  const durationByActivityId = new Map(
    input.activities.map((activity) => [activity.id, Math.round((activity.duration_sec ?? 0) / 60)])
  );

  for (const session of sessionSummaries) {
    const linkedMinutes = confirmedLinks
      .filter((link) => link.planned_session_id === session.id)
      .reduce((sum, link) => sum + (durationByActivityId.get(link.completed_activity_id) ?? 0), 0);
    if (linkedMinutes > 0) {
      session.completedMinutes = linkedMinutes;
    }
  }

  const weekEndExclusive = addDays(input.weekEnd, 1);
  const extraActivities = buildExtraCompletedActivities({
    activities: input.activities,
    links: input.links,
    timeZone: input.timeZone,
    weekStart: input.weekStart,
    weekEndExclusive
  });

  const plannedSessions = sessionSummaries.length;
  const completedPlannedSessions = sessionSummaries.filter((session) => session.status === "completed").length;
  const addedSessions = extraActivities.length;
  const completedSessions = completedPlannedSessions + addedSessions;
  const skippedSessions = sessionSummaries.filter((session) => session.status === "skipped").length;
  const remainingSessions = sessionSummaries.filter((session) => session.status === "planned").length;
  const keySessions = sessionSummaries.filter((session) => session.isKey);
  const keySessionsCompleted = keySessions.filter((session) => session.status === "completed").length;
  const keySessionsMissed = keySessions.filter((session) => session.status === "skipped").length;
  // Use actual activity minutes for completed sessions (same as the dashboard main card) so the
  // generated artifact and the readiness card always report the same effective planned total.
  const plannedMinutes = sessionSummaries.reduce(
    (sum, session) => sum + (session.status === "completed" ? session.completedMinutes : session.durationMinutes),
    0
  );
  const completedPlannedMinutes = sessionSummaries.reduce((sum, session) => sum + session.completedMinutes, 0);
  const completedMinutes = completedPlannedMinutes + extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const skippedMinutes = sessionSummaries.filter((session) => session.status === "skipped").reduce((sum, session) => sum + session.durationMinutes, 0);
  const resolvedMinutes = completedMinutes + skippedMinutes;
  const extraMinutes = extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const completionPct = plannedMinutes === 0 ? 0 : Math.round((resolvedMinutes / plannedMinutes) * 100);
  const sessionsWithFeels = sessionSummaries.filter((s) => s.feels !== null);
  const hasWeeklyNote = !!input.athleteContext?.weeklyState.note?.trim();
  const hasSessionFeels = sessionsWithFeels.length > 0;
  const reflectionsSparse = !hasWeeklyNote && !hasSessionFeels;

  // Build feels aggregate for LLM narrative
  const feelsSnapshot = hasSessionFeels
    ? (() => {
        const feels = sessionsWithFeels.map((s) => s.feels!);
        const avgOverallFeel = Math.round((feels.reduce((sum, f) => sum + f.overallFeel, 0) / feels.length) * 10) / 10;
        const patterns: string[] = [];
        const heavyLegs = feels.filter((f) => f.legsFeel === "heavy").length;
        if (heavyLegs >= 2) patterns.push(`${heavyLegs} sessions with heavy legs`);
        const lowEnergy = feels.filter((f) => f.energyLevel === "low").length;
        if (lowEnergy >= 2) patterns.push(`${lowEnergy} sessions with low energy`);
        const struggled = feels.filter((f) => f.motivation === "struggled").length;
        if (struggled >= 2) patterns.push(`motivation struggled in ${struggled} sessions`);
        const lowFeel = feels.filter((f) => f.overallFeel <= 2).length;
        if (lowFeel >= 2) patterns.push(`${lowFeel} sessions felt hard or terrible`);
        const highFeel = feels.filter((f) => f.overallFeel >= 4).length;
        if (highFeel >= 2 && highFeel >= feels.length * 0.6) patterns.push(`${highFeel} of ${feels.length} sessions felt good or amazing`);
        return { sessionsWithFeels: feels.length, avgOverallFeel, notablePatterns: patterns };
      })()
    : null;
  const weekShape = classifyWeeklyDebriefWeekShape({
    plannedSessions,
    completedSessions,
    skippedSessions,
    reflectionsSparse,
    completionPct
  });

  const sportMinutes = sessionSummaries.reduce((acc, session) => {
    acc.set(session.sport, (acc.get(session.sport) ?? 0) + session.completedMinutes);
    return acc;
  }, new Map<string, number>());
  for (const activity of extraActivities) {
    sportMinutes.set(activity.sport, (sportMinutes.get(activity.sport) ?? 0) + activity.durationMinutes);
  }

  const readiness = computeWeeklyDebriefReadiness({
    todayIso: input.todayIso,
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    plannedMinutes,
    resolvedMinutes,
    totalKeySessions: keySessions.length,
    resolvedKeySessions: keySessionsCompleted
  });

  const reviewedSessions = sessionSummaries.filter((session) => Boolean(session.review));
  const hardestExtraActivity = getHardestExtraActivity(extraActivities);
  const activityEvidence = [
    ...sessionSummaries
      .map((session) => {
        const linkedActivity = linkedActivityBySessionId.get(session.id);
        if (!linkedActivity) return null;
        return buildActivityEvidenceEntry({
          activity: linkedActivity,
          label: session.label,
          context: "linked_session",
          sessionId: session.id
        });
      })
      .filter((item): item is WeeklyDebriefActivityEvidence => item !== null),
    ...extraActivities
      .map((extra) => {
        const source = input.activities.find((activity) => activity.id === extra.id);
        if (!source) return null;
        return buildActivityEvidenceEntry({
          activity: source,
          label: `${capitalize(extra.sport)} extra workout`,
          context: "extra_activity",
          sessionId: linkedSessionByActivityId.get(source.id)?.id
        });
      })
      .filter((item): item is WeeklyDebriefActivityEvidence => item !== null)
  ].slice(0, 10);
  const strongestExecutionSession =
    reviewedSessions
      .filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "on_target")
      .sort((a, b) => (b.review?.executionScore ?? -1) - (a.review?.executionScore ?? -1))[0] ??
    [...reviewedSessions].sort((a, b) => (b.review?.executionScore ?? -1) - (a.review?.executionScore ?? -1))[0] ??
    null;
  const provisionalReviewCount = reviewedSessions.filter((session) => session.review?.executionScoreProvisional).length;
  const latestIssueSession = reviewedSessions
    .filter((session) => session.review?.deterministic.rulesSummary.intentMatch !== "on_target")
    .sort((a, b) => (a.review?.executionScore ?? 100) - (b.review?.executionScore ?? 100))[0] ?? null;
  const finalTitle = buildWeekTitle({
    completedPlannedSessions,
    plannedSessions,
    keySessionsLanded: keySessionsCompleted,
    keySessionsMissed,
    keySessionsTotal: keySessions.length,
    skippedSessions,
    addedSessions,
    weekShape,
    latestIssueLabel: latestIssueSession?.label ?? null
  });
  const statusLine = buildStatusLine({
    completedPlannedSessions,
    plannedSessions,
    keySessionsLanded: keySessionsCompleted,
    keySessionsMissed,
    keySessionsTotal: keySessions.length,
    skippedSessions,
    addedSessions,
    latestIssueLabel: latestIssueSession?.label ?? null,
    strongestExecutionLabel: strongestExecutionSession?.label ?? null,
    weekShape
  });
  const lateWeekSkippedSessions = sessionSummaries.filter(
    (session) => session.status === "skipped" && session.date >= addDays(input.weekStart, 4)
  ).length;
  const primaryTakeaway = buildPrimaryTakeaway({
    keySessionsTotal: keySessions.length,
    keySessionsCompleted,
    keySessionsMissed,
    skippedSessions,
    addedSessions,
    lateWeekSkippedSessions,
    weekShape,
    latestIssueSession,
    strongestExecutionSession,
    completedPlannedSessions,
    plannedSessions
  });
  const artifactState = buildArtifactState({
    provisionalReviewCount
  });

  const factualBullets = [
    `${completedPlannedSessions} of ${plannedSessions} planned sessions were completed.`,
    reviewedSessions.length > 0
      ? latestIssueSession
        ? `The clearest drift showed up in ${latestIssueSession.label}.`
        : strongestExecutionSession
          ? `${strongestExecutionSession.label} gave the strongest execution read.`
          : `${reviewedSessions.length} sessions were reviewed for execution quality.`
      : keySessions.length > 0 && keySessionsCompleted === keySessions.length
        ? `All key sessions landed.`
        : keySessions.length > 0
          ? `${keySessionsCompleted} of ${keySessions.length} key sessions landed.`
          : "The week is best read through overall structure rather than one priority session.",
    skippedSessions > 0
      ? `${skippedSessions} planned ${skippedSessions === 1 ? "session was" : "sessions were"} missed.`
      : addedSessions > 0
        ? `${addedSessions} extra ${addedSessions === 1 ? "session was" : "sessions were"} added.`
        : `${formatMinutes(completedMinutes)} of training was completed.`,
    extraMinutes > 0
      ? hardestExtraActivity && describeExtraActivityLoad(hardestExtraActivity)
        ? `${formatMinutes(extraMinutes)} was added outside the original plan, led by ${describeExtraActivityLoad(hardestExtraActivity)} of extra ${hardestExtraActivity.sport} load.`
        : `${formatMinutes(extraMinutes)} was added outside the original plan.`
      : `${formatMinutes(completedMinutes)} was completed against ${formatMinutes(plannedMinutes)} planned.`
  ].filter((value, index, all) => value && all.indexOf(value) === index).slice(0, 4);

  const positiveHighlights = buildPositiveHighlights({
    keySessionsTotal: keySessions.length,
    keySessionsCompleted,
    skippedSessions,
    addedSessions,
    lateWeekSkippedSessions,
    weekShape,
    strongestExecutionSession,
    hardestExtraActivity
  });

  const observations = buildDeterministicObservations({
    reflectionsSparse,
    latestIssueSession,
    lateSkippedSessions: lateWeekSkippedSessions,
    skippedSessions,
    addedSessions,
    keySessionsMissed,
    reviewedSessionsCount: reviewedSessions.length,
    hardestExtraActivity
  });
  const carryForward = buildDeterministicSuggestions({
    weekShape,
    athleteContext: input.athleteContext,
    keySessionsMissed,
    lateSkippedSessions: lateWeekSkippedSessions,
    addedSessions,
    latestIssueSession,
    keySessionsTotal: keySessions.length,
    hardestExtraActivity
  });

  const qualityOnTargetCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "on_target").length;
  const qualityPartialCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "partial").length;
  const qualityMissedCount = reviewedSessions.filter((session) => session.review?.deterministic.rulesSummary.intentMatch === "missed").length;
  const metrics = [
    {
      label: "Completed",
      value: `${completedPlannedSessions}/${plannedSessions}`,
      detail:
        skippedSessions > 0 || addedSessions > 0
          ? `${completedPlannedSessions} completed${skippedSessions > 0 ? ` • ${skippedSessions} missed` : ""}${addedSessions > 0 ? ` • ${addedSessions} added` : ""}`
          : `${completedPlannedSessions} completed`,
      tone: skippedSessions === 0 ? "positive" as const : "neutral" as const
    },
    {
      label: "Time",
      value: `${formatMinutes(completedMinutes)} / ${formatMinutes(plannedMinutes)}`,
      detail:
        addedSessions > 0
          ? `${formatMinutes(completedMinutes)} done • includes ${formatMinutes(extraMinutes)} added work${hardestExtraActivity && describeExtraActivityLoad(hardestExtraActivity) ? ` • ${describeExtraActivityLoad(hardestExtraActivity)}` : ""}`
          : `${formatMinutes(completedMinutes)} done`,
      tone: completionPct >= 90 ? "positive" as const : completionPct >= 70 ? "neutral" as const : "caution" as const
    },
    ...(reviewedSessions.length > 0 ? [{
      label: "Sessions on target",
      value: `${qualityOnTargetCount}/${reviewedSessions.length} on target`,
      detail: qualityPartialCount > 0 || qualityMissedCount > 0 ? `${qualityPartialCount} partial · ${qualityMissedCount} off` : null,
      tone: qualityMissedCount > 0 ? "caution" as const : qualityOnTargetCount > 0 ? "positive" as const : "neutral" as const
    }] : []),
    ...(strongestExecutionSession ? [{
      label: "Strongest execution",
      value: strongestExecutionSession.label,
      detail: strongestExecutionSession.review?.deterministic.rulesSummary.intentMatch === "on_target" ? "Stayed closest to target" : strongestExecutionSession.review?.executionScoreBand ?? null,
      tone: "positive" as const
    }] : []),
    (latestIssueSession || skippedSessions > 0 || addedSessions > 0)
      ? {
          label: latestIssueSession ? "Biggest drift" : "Week shape",
          value: latestIssueSession ? latestIssueSession.label : skippedSessions > 0 ? `${skippedSessions} missed` : `${addedSessions} added`,
          detail: latestIssueSession ? null : skippedSessions > 0 ? "Back-half looseness" : "Added work changed the shape",
          tone: latestIssueSession || skippedSessions > 0 ? "caution" as const : "muted" as const
        }
      : {
          label: "Week shape",
          value: plannedSessions > 0 ? "On plan" : "Open week",
          detail: plannedSessions > 0 ? "No drift, skips, or extras" : "No planned sessions",
          tone: "muted" as const
        }
  ];

  const draftFacts = weeklyDebriefFactsSchema.parse({
      weekLabel: `Week of ${input.weekStart}`,
      weekRange: weekRangeLabel(input.weekStart),
      title: finalTitle,
      statusLine,
      primaryTakeawayTitle: primaryTakeaway.title,
      primaryTakeawayDetail: primaryTakeaway.detail,
      plannedSessions,
      completedPlannedSessions,
      completedSessions,
      addedSessions,
      skippedSessions,
      remainingSessions,
      keySessionsCompleted,
      keySessionsMissed,
      keySessionsTotal: keySessions.length,
      plannedMinutes,
      completedPlannedMinutes,
      completedMinutes,
      skippedMinutes,
      extraMinutes,
      completionPct,
      dominantSport: getDominantSport(sportMinutes),
      keySessionStatus: keySessions.length > 0 ? "Priority sessions influenced the week." : "Consistency and execution quality explained the week better than one priority session.",
      metrics,
      factualBullets,
      confidenceNote: getConfidenceNote(input),
      narrativeSource: "legacy_unknown",
      artifactStateLabel: artifactState.label,
      artifactStateNote: artifactState.note,
      provisionalReviewCount,
      weekShape,
      reflectionsSparse,
      feelsSnapshot
    });

  const deterministicNarrative = buildDeterministicNarrative({
    facts: draftFacts,
    topHighlights: positiveHighlights,
    observations,
    carryForward
  });

  const evidence = buildFallbackEvidenceSummaries(sessionSummaries, extraActivities);
  const facts = weeklyDebriefFactsSchema.parse({
    ...draftFacts,
    completionPct: clamp(completionPct, 0, 999),
    primaryTakeawayTitle: primaryTakeaway.title,
    primaryTakeawayDetail: primaryTakeaway.detail
  });
  const evidenceGroups = buildEvidenceGroups({
    facts,
    sessionSummaries,
    extraActivities,
    latestIssueSession,
    strongestExecutionSession,
    lateWeekSkippedSessions,
    weekStart: input.weekStart
  });

  return {
    readiness,
    facts,
    deterministicNarrative,
    evidence,
    activityEvidence,
    evidenceGroups,
    sourceUpdatedAt: getSourceUpdatedAt([
      ...input.sessions.map((session) => session.updated_at ?? session.created_at),
      ...input.activities.map((activity) => activity.updated_at ?? activity.created_at ?? activity.start_time_utc),
      ...input.links.map((link) => link.created_at ?? null),
      input.athleteContext?.weeklyState.updatedAt
    ])
  };
}
