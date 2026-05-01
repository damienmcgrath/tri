/**
 * Deterministic title / status-line / takeaway builders used by the weekly
 * debrief facts orchestrator. Pure helpers — no I/O, no Zod parsing — so they
 * can be unit-tested independently and kept clear of the large composition
 * function in facts.ts.
 */

import type { WeeklyDebriefSessionSummary } from "./types";
import { capitalize } from "./format";
import { buildExtraCompletedActivities } from "@/lib/activities/completed-activities";

type WeekShape = "normal" | "partial_reflection" | "disrupted";

export function buildWeekTitle(args: {
  completedPlannedSessions: number;
  plannedSessions: number;
  keySessionsLanded: number;
  keySessionsMissed: number;
  keySessionsTotal: number;
  skippedSessions: number;
  addedSessions: number;
  weekShape: WeekShape;
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

export function buildStatusLine(args: {
  completedPlannedSessions: number;
  plannedSessions: number;
  keySessionsLanded: number;
  keySessionsMissed: number;
  keySessionsTotal: number;
  skippedSessions: number;
  addedSessions: number;
  latestIssueLabel: string | null;
  strongestExecutionLabel: string | null;
  weekShape: WeekShape;
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

export function buildPrimaryTakeaway(args: {
  keySessionsTotal: number;
  keySessionsCompleted: number;
  keySessionsMissed: number;
  skippedSessions: number;
  addedSessions: number;
  lateWeekSkippedSessions: number;
  weekShape: WeekShape;
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

export function buildPositiveHighlights(args: {
  keySessionsTotal: number;
  keySessionsCompleted: number;
  skippedSessions: number;
  addedSessions: number;
  lateWeekSkippedSessions: number;
  weekShape: WeekShape;
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

export function getDominantSport(sportMinutes: Map<string, number>) {
  const winner = [...sportMinutes.entries()].sort((a, b) => b[1] - a[1])[0];
  return winner?.[1] ? capitalize(winner[0]) : "Mixed";
}
