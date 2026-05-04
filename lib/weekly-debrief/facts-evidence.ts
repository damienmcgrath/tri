/**
 * Evidence and evidence-group builders for the weekly debrief facts orchestrator.
 * Pure helpers — they take the already-aggregated session/activity inputs and
 * produce the evidence pills + claim-with-supports cards rendered by the UI.
 */

import { addDays } from "@/lib/date-utils";
import { buildExtraCompletedActivities } from "@/lib/activities/completed-activities";
import { capitalize, formatMinutes } from "./format";
import { describeExtraActivityLoad } from "./activity-evidence";
import { truncateStr } from "./types";
import type {
  WeeklyDebriefEvidenceGroup,
  WeeklyDebriefEvidenceItem,
  WeeklyDebriefFacts,
  WeeklyDebriefSessionSummary
} from "./types";

export function buildFallbackEvidenceSummaries(
  sessionSummaries: WeeklyDebriefSessionSummary[],
  extraActivities: ReturnType<typeof buildExtraCompletedActivities>
) {
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

export function buildEvidenceGroups(args: {
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
