import { buildExtraCompletedActivities, hasConfirmedPlannedSessionLink, loadCompletedActivities } from "@/lib/activities/completed-activities";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { parsePersistedExecutionReview } from "@/lib/execution-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { buildExecutionResultForSession, shouldRefreshExecutionResultFromActivity } from "@/lib/workouts/session-execution";
import { addDays, weekRangeLabel } from "@/lib/date-utils";
import type {
  WeeklyDebriefSession,
  WeeklyDebriefActivity,
  WeeklyDebriefLink,
  WeeklyDebriefInputs,
  WeeklyDebriefFacts,
  WeeklyDebriefEvidenceItem,
  WeeklyDebriefEvidenceGroup,
  WeeklyDebriefSessionSummary,
  WeeklyDebriefActivityEvidence,
  WeeklyDebriefReadiness
} from "./types";
import { weeklyDebriefFactsSchema, truncateStr } from "./types";
import { clamp, capitalize, formatMinutes } from "./format";
import { buildActivityEvidenceEntry, describeExtraActivityLoad, getHardestExtraActivity } from "./activity-evidence";
import {
  isSkippedByTag,
  inferSessionStatus,
  getConfidenceNote,
  buildArtifactState,
  computeWeeklyDebriefReadiness,
  classifyWeeklyDebriefWeekShape,
  buildDeterministicNarrative,
  getSourceUpdatedAt
} from "./deterministic";

function buildWeekTitle(args: {
  completedPlannedSessions: number;
  plannedSessions: number;
  keySessionsLanded: number;
  keySessionsMissed: number;
  keySessionsTotal: number;
  skippedSessions: number;
  addedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  latestIssueLabel: string | null;
}) {
  if (args.keySessionsTotal === 0) {
    if (args.weekShape === "disrupted") {
      return args.latestIssueLabel
        ? `A mixed week, with drift most visible in ${args.latestIssueLabel.toLowerCase()}`
        : "A mixed week, with quality fading later on";
    }

    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return "A steady week, with extra work layered around it";
    }

    if (args.skippedSessions > 0) {
      return "A mostly intact week, with one visible wobble";
    }

    return "A steady consistency week";
  }

  if (args.weekShape === "disrupted") {
    return args.keySessionsLanded > 0
      ? "A disrupted week, with some of the main work preserved"
      : "A disrupted week, with the main work partly missed";
  }

  if (args.keySessionsTotal > 0 && args.keySessionsLanded === args.keySessionsTotal) {
    if (args.skippedSessions > 0) {
      return "The main work landed, with a few lower-priority misses";
    }
    if (args.addedSessions > 0) {
      return "The main work landed, with a little extra training added";
    }
    return "The main work landed across a steady week";
  }

  if (args.keySessionsMissed > 0) {
    return "A mixed week, with one meaningful gap in the main work";
  }

  if (args.skippedSessions > 0) {
    return "A mixed week with a couple of late changes";
  }

  if (args.completedPlannedSessions >= Math.ceil(args.plannedSessions * 0.8)) {
    return "A steady week with most of the planned work in place";
  }

  return "A flexible week that stayed broadly on course";
}

function buildStatusLine(args: {
  completedPlannedSessions: number;
  plannedSessions: number;
  keySessionsLanded: number;
  keySessionsMissed: number;
  keySessionsTotal: number;
  skippedSessions: number;
  addedSessions: number;
  latestIssueLabel: string | null;
  strongestExecutionLabel: string | null;
  weekShape: "normal" | "partial_reflection" | "disrupted";
}) {
  if (args.keySessionsTotal === 0) {
    if (args.latestIssueLabel) {
      return `Most of the week structure held, with the clearest drift showing up in ${args.latestIssueLabel}.`;
    }
    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return "Extra work changed the shape of the week, but the planned structure still mostly held.";
    }
    if (args.strongestExecutionLabel) {
      return `${args.strongestExecutionLabel} gave the clearest picture of how the week was landing.`;
    }
    if (args.weekShape === "disrupted") {
      return "The week stayed readable, but execution quality loosened more than the schedule alone suggests.";
    }
    return "The week was defined more by overall consistency than by one priority session.";
  }

  if (args.keySessionsLanded === args.keySessionsTotal && args.latestIssueLabel) {
    return `The priority structure held, but the clearest quality drift showed up in ${args.latestIssueLabel}.`;
  }
  if (args.keySessionsLanded === args.keySessionsTotal) {
    return args.addedSessions > 0
      ? "The priority structure held, and the added work stayed secondary to it."
      : "The priority structure held and execution stayed broadly intact across the week.";
  }
  if (args.keySessionsMissed > 0) {
    return args.latestIssueLabel
      ? `${args.latestIssueLabel} was the clearest point where the week's priority structure stopped landing cleanly.`
      : "One gap in the priority work shaped the rest of the week more than the surrounding sessions did.";
  }
  return `${args.completedPlannedSessions} of ${args.plannedSessions} planned sessions landed, with enough shape left to learn from the week.`;
}

function buildPrimaryTakeaway(args: {
  keySessionsTotal: number;
  keySessionsCompleted: number;
  keySessionsMissed: number;
  skippedSessions: number;
  addedSessions: number;
  lateWeekSkippedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
  completedPlannedSessions: number;
  plannedSessions: number;
}) {
  if (args.keySessionsTotal === 0) {
    if (args.strongestExecutionSession && args.latestIssueSession && args.strongestExecutionSession.id !== args.latestIssueSession.id) {
      return {
        title: "The week had one clear strength and one clear wobble",
        detail: `${args.strongestExecutionSession.label} was the best-executed session of the week, while ${args.latestIssueSession.label} was where the week loosened most.`
      };
    }

    if (args.latestIssueSession) {
      return {
        title: "One session explained most of the drift",
        detail: `${args.latestIssueSession.label} was the clearest point where execution quality fell away, more than the rest of the week.`
      };
    }

    if (args.strongestExecutionSession) {
      return {
        title: "Quality came through in one representative session",
        detail: `${args.strongestExecutionSession.label} best captured how the week was landing overall.`
      };
    }

    if (args.addedSessions > 0 && args.skippedSessions === 0) {
      return {
        title: "Consistency held, even with a little extra work",
        detail: "No one session dominated the week; the main read is that the overall structure held while a little extra work was layered on."
      };
    }
  }

  if (args.keySessionsTotal > 0) {
    if (args.keySessionsCompleted === args.keySessionsTotal) {
      if (args.skippedSessions > 0) {
        return {
          title: "The main work held",
          detail: "The priority sessions landed, and most of the disruption stayed outside the work the week depended on."
        };
      }

      if (args.addedSessions > 0) {
        return {
          title: "The main work set the week",
          detail: "The priority sessions landed first, and the added work stayed secondary to the planned structure."
        };
      }

      return {
        title: "The main work set the tone",
        detail: "The priority sessions landed and the rest of the week stayed close to the intended structure."
      };
    }

    if (args.keySessionsMissed > 0) {
      return {
        title: "One key gap shaped the week",
        detail: args.latestIssueSession?.label
          ? `${args.latestIssueSession.label} was the clearest point where the week's main structure stopped feeling fully intact.`
          : "The biggest story of the week was the priority work that did not fully land."
      };
    }
  }

  if (args.addedSessions > 0 && args.skippedSessions === 0) {
    return {
      title: "Consistency held, with extra work around it",
      detail: "No single session defined the week; the main story was that the planned structure held while a little extra work was layered on."
    };
  }

  if (args.lateWeekSkippedSessions > 0) {
    return {
      title: "Most of the week held until late drift",
      detail: "The opening structure stayed intact, but the back half of the week loosened more than the start."
    };
  }

  if (args.skippedSessions > 0) {
    return {
      title: "A few changes shaped the week",
      detail: "Without one designated priority session, the main story was where the planned structure slipped and what still held around it."
    };
  }

  if (args.completedPlannedSessions >= Math.ceil(args.plannedSessions * 0.8)) {
    return {
      title: "Consistency defined the week",
      detail: "No single session outweighed the rest; the value came from keeping the week's structure in place across multiple days."
    };
  }

  return {
    title: "The structure mattered more than any one session",
    detail: args.weekShape === "disrupted"
      ? "The week is better understood as a block with a few loose edges than as one standout session."
      : "This was more about the overall rhythm of the week than about a single headline workout."
  };
}

function buildPositiveHighlights(args: {
  keySessionsTotal: number;
  keySessionsCompleted: number;
  skippedSessions: number;
  addedSessions: number;
  lateWeekSkippedSessions: number;
  weekShape: "normal" | "partial_reflection" | "disrupted";
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
  hardestExtraActivity: ReturnType<typeof buildExtraCompletedActivities>[number] | null;
}) {
  const highlights = [
    args.strongestExecutionSession
      ? `${args.strongestExecutionSession.label} was the best-executed session of the week.`
      : null,
    args.keySessionsTotal > 0 && args.keySessionsCompleted === args.keySessionsTotal
      ? "The priority sessions landed without the rest of the week needing to bend around them."
      : null,
    args.skippedSessions <= 1
      ? "The week kept its shape without quality slipping across multiple sessions."
      : args.lateWeekSkippedSessions > 0
        ? "The disruption stayed more contained than a fully unraveled week."
        : null,
    args.addedSessions > 0 && args.skippedSessions === 0
      ? "Extra work stayed additive rather than replacing the main week."
      : null,
    args.hardestExtraActivity && (args.hardestExtraActivity.trainingStressScore ?? 0) >= 70 && args.skippedSessions === 0
      ? `${capitalize(args.hardestExtraActivity.sport)} extra work added meaningful load without replacing the plan.`
      : null,
    args.weekShape === "disrupted"
      ? "Even with some messiness, the stronger sessions still showed what is worth protecting."
      : null
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  return highlights.slice(0, 3);
}

function getDominantSport(sportMinutes: Map<string, number>) {
  const winner = [...sportMinutes.entries()].sort((a, b) => b[1] - a[1])[0];
  return winner?.[1] ? capitalize(winner[0]) : "Mixed";
}

function buildFallbackEvidenceSummaries(sessionSummaries: WeeklyDebriefSessionSummary[], extraActivities: ReturnType<typeof buildExtraCompletedActivities>) {
  const evidence: WeeklyDebriefEvidenceItem[] = [];

  for (const session of sessionSummaries) {
    if (session.status !== "completed" && session.status !== "skipped") continue;
    const review = session.review;
    evidence.push({
      id: session.id,
      label: session.label,
      detail: truncateStr(
        review?.executionSummary ??
        (session.status === "skipped" ? "This planned session was explicitly skipped." : `${formatMinutes(session.completedMinutes)} completed.`),
        280),
      kind: "session",
      href: `/sessions/${session.id}`,
      supportType: review ? "observation" : "fact"
    });
  }

  for (const activity of extraActivities.slice(0, 4)) {
    const loadDetail = describeExtraActivityLoad(activity);
    evidence.push({
      id: activity.id,
      label: `${capitalize(activity.sport)} extra workout`,
      detail: truncateStr(`${formatMinutes(activity.durationMinutes)} of unscheduled work was added to the week.${loadDetail ? ` ${loadDetail}.` : ""}`, 280),
      kind: "activity",
      href: `/sessions/activity/${activity.id}`,
      supportType: "fact"
    });
  }

  return evidence.slice(0, 18);
}

function buildEvidenceGroups(args: {
  facts: WeeklyDebriefFacts;
  sessionSummaries: WeeklyDebriefSessionSummary[];
  extraActivities: ReturnType<typeof buildExtraCompletedActivities>;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  strongestExecutionSession: WeeklyDebriefSessionSummary | null;
  lateWeekSkippedSessions: number;
  weekStart: string;
}) {
  const completedSessions = args.sessionSummaries.filter((session) => session.status === "completed");
  const completedKeySessions = completedSessions.filter((session) => session.isKey);
  const skippedSessions = args.sessionSummaries.filter((session) => session.status === "skipped");
  const longestCompleted = [...completedSessions].sort((a, b) => b.completedMinutes - a.completedMinutes);

  const sessionSupport = (session: WeeklyDebriefSessionSummary, reason: string) => ({
    id: session.id,
    label: session.label,
    href: `/sessions/${session.id}`,
    kind: "session" as const,
    reason
  });

  const activitySupport = (activity: ReturnType<typeof buildExtraCompletedActivities>[number], reason: string) => ({
    id: activity.id,
    label: `${capitalize(activity.sport)} extra workout`,
    href: `/sessions/activity/${activity.id}`,
    kind: "activity" as const,
    reason
  });

  const uniqueSupports = <T extends { kind: "session" | "activity"; id: string }>(supports: T[]) =>
    supports.filter((support, index, all) => all.findIndex((candidate) => candidate.kind === support.kind && candidate.id === support.id) === index);

  const groups: WeeklyDebriefEvidenceGroup[] = [];

  const primarySupports = args.facts.keySessionsTotal > 0
    ? [
        ...completedKeySessions.slice(0, 2).map((session) => sessionSupport(session, "This was part of the week's priority work.")),
        ...skippedSessions.filter((session) => session.isKey).slice(0, 1).map((session) => sessionSupport(session, "This missing key session changed the week's shape.")),
        ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This added work changed the week's shape without replacing the plan.")) : [])
      ]
    : [
        ...longestCompleted.slice(0, 2).map((session) => sessionSupport(session, "This helped hold the week's planned structure together.")),
        ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This added work changed the week's overall shape.")) : []),
        ...skippedSessions.slice(0, 1).map((session) => sessionSupport(session, "This missed session explains where the week loosened."))
      ];

  if (primarySupports.length > 0) {
    groups.push({
      claim: args.facts.primaryTakeawayTitle,
      detail: args.facts.primaryTakeawayDetail,
      supports: uniqueSupports(primarySupports).slice(0, 4)
    });
  }

  const stabilitySupports = [
    ...(args.strongestExecutionSession ? [sessionSupport(args.strongestExecutionSession, "This session best represents the week's strongest execution quality.")] : []),
    ...completedKeySessions.slice(0, 2).filter((session) => session.id !== args.strongestExecutionSession?.id).map((session) => sessionSupport(session, "This session helped preserve the week's quality.")),
    ...longestCompleted.slice(0, 2).map((session) => sessionSupport(session, "This session helped keep the planned rhythm in place.")),
    ...(args.facts.addedSessions > 0 && args.facts.skippedSessions === 0
      ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This extra work stayed additive rather than replacing the plan."))
      : [])
  ];

  if (stabilitySupports.length > 0) {
    groups.push({
      claim: args.strongestExecutionSession ? "Where execution quality was strongest" : "What held the week together",
      detail: args.strongestExecutionSession
        ? `${args.strongestExecutionSession.label} gave the clearest read on the week's strongest execution.`
        : args.facts.keySessionsTotal > 0 && args.facts.keySessionsCompleted === args.facts.keySessionsTotal
          ? "The priority work landed, and the rest of the week still had enough structure around it."
          : "These sessions best explain what held the week together.",
      supports: uniqueSupports(stabilitySupports).slice(0, 4)
    });
  }

  const noticeSupports = [
    ...(args.latestIssueSession ? [sessionSupport(args.latestIssueSession, "This was the clearest point where execution drift showed up.")] : []),
    ...skippedSessions.filter((session) => !args.latestIssueSession || session.id !== args.latestIssueSession.id).slice(0, args.lateWeekSkippedSessions > 0 ? 2 : 1).map((session) =>
      sessionSupport(
        session,
        session.date >= addDays(args.weekStart, 4)
          ? "This miss contributed to the late-week drift."
          : "This miss contributed to where the week loosened."
      )
    ),
    ...(args.facts.addedSessions > 0 ? args.extraActivities.slice(0, 1).map((activity) => activitySupport(activity, "This extra session changed the week's shape and is worth reading in context.")) : [])
  ];

  if (noticeSupports.length > 0) {
    groups.push({
      claim: "Where execution drift showed up",
      detail: args.latestIssueSession
        ? `The clearest drift showed up around ${args.latestIssueSession.label}.`
        : args.lateWeekSkippedSessions > 0
          ? "Most of the disruption was concentrated in the back half of the week."
          : "These sessions best explain where the week diverged from the intended shape.",
      supports: uniqueSupports(noticeSupports).slice(0, 4)
    });
  }

  return groups.slice(0, 3);
}

function buildDeterministicSuggestions(args: {
  weekShape: "normal" | "partial_reflection" | "disrupted";
  athleteContext: AthleteContextSnapshot | null;
  keySessionsMissed: number;
  lateSkippedSessions: number;
  addedSessions: number;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  keySessionsTotal: number;
  hardestExtraActivity: ReturnType<typeof buildExtraCompletedActivities>[number] | null;
}) {
  const carry: string[] = [];
  if (args.latestIssueSession?.label) {
    carry.push(`Take a calmer first half into the next ${args.latestIssueSession.label.toLowerCase()}.`);
  } else if (args.keySessionsMissed > 0) {
    carry.push("Protect the main session before adding anything extra.");
  } else if (args.keySessionsTotal === 0) {
    carry.push("Keep the sessions that are landing cleanly as the anchor points of the week.");
  } else {
    carry.push("Keep the same spacing around the main work.");
  }

  if (args.lateSkippedSessions > 0) {
    carry.push("Protect the back half of the week from spillover.");
  } else if (args.hardestExtraActivity && (args.hardestExtraActivity.trainingStressScore ?? 0) >= 70) {
    carry.push("Treat the hardest extra session as real load before adding anything else around it.");
  } else if (args.addedSessions > 0) {
    carry.push("Only add extra work after the planned sessions are already done.");
  } else if (args.athleteContext?.weeklyState.note) {
    carry.push("Carry one useful cue from your note into the next harder session.");
  } else if (args.weekShape === "disrupted") {
    carry.push("Keep next week simple rather than trying to repay missed work.");
  } else {
    carry.push("Keep easy work controlled ahead of the harder day.");
  }

  return carry.slice(0, 2);
}

function buildDeterministicObservations(args: {
  reflectionsSparse: boolean;
  latestIssueSession: WeeklyDebriefSessionSummary | null;
  lateSkippedSessions: number;
  skippedSessions: number;
  addedSessions: number;
  keySessionsMissed: number;
  reviewedSessionsCount: number;
  hardestExtraActivity: ReturnType<typeof buildExtraCompletedActivities>[number] | null;
}) {
  const observations: string[] = [];
  if (args.latestIssueSession?.label) {
    observations.push(`The clearest drift showed up in ${args.latestIssueSession.label}, rather than across the whole week.`);
  }
  if (args.keySessionsMissed > 0) {
    observations.push("The most meaningful drift touched one of the week's priority sessions.");
  } else if (args.lateSkippedSessions > 0) {
    observations.push("Most of the disruption was contained to the back half of the week.");
  } else if (args.skippedSessions > 0) {
    observations.push("The misses were present, but they did not spread across the whole structure.");
  }
  if (args.addedSessions > 0) {
    observations.push("Added work changed the shape of the week and is worth reading alongside the planned sessions, not separately from them.");
  }
  if (args.hardestExtraActivity && (args.hardestExtraActivity.trainingStressScore ?? 0) >= 70) {
    observations.push(`${capitalize(args.hardestExtraActivity.sport)} extra work was a meaningful load addition, not just extra minutes.`);
  } else if (args.hardestExtraActivity?.sport === "run" && ((args.hardestExtraActivity.hrDriftPct ?? 0) >= 0.05 || (args.hardestExtraActivity.paceFadePct ?? 0) >= 0.04)) {
    observations.push("The added run looked costly enough to matter for recovery, not just for volume.");
  } else if (args.hardestExtraActivity?.sport === "swim" && (args.hardestExtraActivity.avgPacePer100mSec ?? 0) > 0) {
    observations.push("The added swim looked more like supportive aerobic work than random extra minutes.");
  }
  if (args.reviewedSessionsCount === 0 && observations.length === 0) {
    observations.push("This week reads more through overall rhythm than through one standout session.");
  }

  return observations.slice(0, 3);
}

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
    ...((latestIssueSession || skippedSessions > 0 || addedSessions > 0) ? [{
      label: latestIssueSession ? "Biggest drift" : "Week shape",
      value: latestIssueSession ? latestIssueSession.label : skippedSessions > 0 ? `${skippedSessions} missed` : `${addedSessions} added`,
      detail: latestIssueSession ? null : skippedSessions > 0 ? "Back-half looseness" : "Added work changed the shape",
      tone: latestIssueSession || skippedSessions > 0 ? "caution" as const : "muted" as const
    }] : [])
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
