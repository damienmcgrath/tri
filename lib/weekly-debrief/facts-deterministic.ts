/**
 * Deterministic suggestion / observation builders for the weekly debrief facts
 * orchestrator. Pure helpers that emit the carry-forward bullets and
 * observations the deterministic-narrative path falls back to when the AI
 * narrative is missing.
 */

import { buildExtraCompletedActivities } from "@/lib/activities/completed-activities";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import type { WeeklyDebriefSessionSummary } from "./types";
import { capitalize } from "./format";

type WeekShape = "normal" | "partial_reflection" | "disrupted";

export function buildDeterministicSuggestions(args: {
  weekShape: WeekShape;
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

export function buildDeterministicObservations(args: {
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
  if (observations.length === 0) {
    observations.push("This week reads more through overall rhythm than through one standout session.");
  }

  return observations.slice(0, 3);
}
