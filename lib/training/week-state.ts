import {
  deriveSessionLifecycleState,
  getWeekRiskLabel,
  normalizeReviewOutcomeState,
  type AdaptationState,
  type ReviewOutcomeState,
  type SessionLifecycleState,
  type SessionStoredState,
  type WeekRiskState
} from "@/lib/training/semantics";
import { normalizeReviewSummary, type NormalizedReviewSummary } from "@/lib/training/review-summary";

export type WeekSessionInput = {
  id: string;
  date: string;
  title: string;
  sport: string;
  durationMinutes: number;
  storedStatus?: SessionStoredState | null;
  isKey?: boolean;
  isProtected?: boolean;
  isFlexible?: boolean;
  isOptional?: boolean;
  intentSummary?: string | null;
  intentCategory?: string | null;
  target?: string | null;
  executionResult?: Record<string, unknown> | null;
  isExtra?: boolean;
};

export type DerivedWeekSession = WeekSessionInput & {
  lifecycle: SessionLifecycleState;
  reviewOutcome: ReviewOutcomeState;
  reviewSummary: NormalizedReviewSummary;
  isProtected: boolean;
  isFlexible: boolean;
  isOptional: boolean;
};

export type WeeklyIntervention = {
  title: string;
  statusLine: string;
  why: string;
  recommendedAction: string;
  impactIfIgnored: string;
  href?: string;
};

export type AdaptationActionOperation =
  | "move_session"
  | "drop_session"
  | "shorten_session"
  | "keep_as_planned"
  | "no_action_needed";

export type AdaptationRecommendation = {
  state: AdaptationState;
  whatChanged: string;
  whyItMatters: string;
  recommendation: string;
  rationale: string;
  affectedSessionIds: string[];
  operation: AdaptationActionOperation;
  primaryLabel: string;
};

export type CoachIssue = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  issueType: string;
  reviewOutcome: ReviewOutcomeState;
  whyItMatters: string;
  recommendation: string;
  summary: string;
};

export type WeekStateSummary = {
  sessions: DerivedWeekSession[];
  plannedMinutes: number;
  completedMinutes: number;
  remainingMinutes: number;
  counts: {
    completed: number;
    remaining: number;
    missed: number;
    extra: number;
    skipped: number;
  };
  protected: {
    completed: number;
    remaining: number;
    missed: number;
  };
  remainingLoadPerDay: number;
  remainingLoadRealistic: boolean;
  weekRisk: WeekRiskState;
  weekRiskLabel: string;
  focusStatement: string;
  topIntervention: WeeklyIntervention;
  adaptation: AdaptationRecommendation | null;
  issues: CoachIssue[];
};

function titleWithDay(session: WeekSessionInput) {
  const label = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${session.date}T00:00:00.000Z`));
  return `${label} ${session.title}`;
}

function uniqueCount(values: string[]) {
  return new Set(values).size;
}

function deriveIssueType(session: DerivedWeekSession) {
  if (session.lifecycle === "missed") return "Session missed";
  if (session.storedStatus === "skipped") return "Session skipped";
  if (session.reviewSummary.missingEvidenceReasons.length > 0) return "Evidence incomplete";
  return session.reviewSummary.keyIssues[0] ?? (session.reviewOutcome === "partial_match" ? "Execution drift" : "Missed intent");
}

function buildTopIntervention(params: {
  risk: WeekRiskState;
  sessions: DerivedWeekSession[];
  plannedMinutes: number;
  remainingMinutes: number;
  remainingLoadRealistic: boolean;
  adaptation: AdaptationRecommendation | null;
}) {
  const { risk, sessions, plannedMinutes, remainingMinutes, remainingLoadRealistic, adaptation } = params;
  const protectedMissed = sessions.find((session) => session.isProtected && session.lifecycle === "missed") ?? null;

  if (adaptation) {
    return {
      title: `Weekly risk: ${getWeekRiskLabel(risk)}`,
      statusLine: getWeekRiskLabel(risk),
      why: adaptation.whyItMatters,
      recommendedAction: adaptation.recommendation,
      impactIfIgnored:
        risk === "at_risk"
          ? "The week may lose its intended key stimulus."
          : "The week can still stay on course if the next decision stays conservative.",
      href: "/calendar"
    } satisfies WeeklyIntervention;
  }

  if (protectedMissed) {
    return {
      title: "Weekly risk: At risk",
      statusLine: "At risk",
      why: `${titleWithDay(protectedMissed)} is still missing, so the week's protected work is exposed.`,
      recommendedAction: "Protect the remaining key sessions and do not backfill missed easy volume around them.",
      impactIfIgnored: "The week may lose its intended key stimulus.",
      href: `/calendar?focus=${protectedMissed.id}`
    } satisfies WeeklyIntervention;
  }

  if (!remainingLoadRealistic) {
    return {
      title: `Weekly risk: ${getWeekRiskLabel(risk)}`,
      statusLine: getWeekRiskLabel(risk),
      why: `${remainingMinutes} minutes still need a home, and the remaining load no longer looks realistic.`,
      recommendedAction: "Keep the protected sessions fixed and stop trying to backfill everything.",
      impactIfIgnored: "Weekend quality can get crowded out by catch-up volume.",
      href: "/calendar"
    } satisfies WeeklyIntervention;
  }

  return {
    title: `Weekly risk: ${getWeekRiskLabel(risk)}`,
    statusLine: getWeekRiskLabel(risk),
    why:
      risk === "on_track"
        ? "Protected work is either complete or still on schedule, and the remaining load is realistic."
        : "A small amount of drift is showing up, but the protected work is still recoverable.",
    recommendedAction:
      risk === "on_track"
        ? "Stay with the current order and keep easy sessions easy."
        : "Protect the next key session first and let lower-priority volume stay flexible.",
    impactIfIgnored:
      risk === "on_track"
        ? "The week can stay stable if execution quality stays consistent."
        : "The week can drift if missed work gets stacked on top of the protected sessions.",
    href: risk === "on_track" ? "/plan" : "/calendar"
  } satisfies WeeklyIntervention;
}

function deriveAdaptation(sessions: DerivedWeekSession[], todayIso: string, remainingLoadRealistic: boolean): AdaptationRecommendation | null {
  const protectedMissed = sessions.find(
    (session) => session.isProtected && (session.lifecycle === "missed" || session.storedStatus === "skipped")
  ) ?? null;
  if (protectedMissed) {
    return {
      state: "suggested",
      whatChanged: `${titleWithDay(protectedMissed)} ${protectedMissed.storedStatus === "skipped" ? "skipped" : "missed"}`,
      whyItMatters: "Protected work is the part of the week least safe to lose.",
      recommendation: "Review whether this session should move, or whether the safer call is to protect the rest of the week and move on.",
      rationale: "Do not backfill everything around a missed protected session if it will squeeze the remaining key work.",
      affectedSessionIds: [protectedMissed.id],
      operation: "move_session",
      primaryLabel: "Review options"
    };
  }

  const missedSessions = sessions.filter((session) => session.lifecycle === "missed" || session.storedStatus === "skipped");
  if (!remainingLoadRealistic || missedSessions.length >= 2) {
    return {
      state: "suggested",
      whatChanged: missedSessions.length >= 2 ? `${missedSessions.length} sessions are now off the original week plan` : "Too much load is stacked into the remaining days",
      whyItMatters: "Trying to catch up everything now is more likely to blunt the protected work than to rescue the week.",
      recommendation: "Drop or shorten low-priority missed work and keep the protected sessions fixed.",
      rationale: "The week is better protected by preserving intent than by chasing every remaining minute.",
      affectedSessionIds: missedSessions.map((session) => session.id),
      operation: "drop_session",
      primaryLabel: "Protect the week"
    };
  }

  const flexibleMissed = sessions.find(
    (session) =>
      (session.lifecycle === "missed" || session.storedStatus === "skipped") &&
      !session.isProtected &&
      (session.isFlexible || /easy|recovery|aerobic/i.test(session.intentCategory ?? session.intentSummary ?? session.title))
  );
  const upcomingProtected = sessions.find((session) => session.isProtected && (session.lifecycle === "today" || session.lifecycle === "planned") && session.date >= todayIso) ?? null;

  if (flexibleMissed && upcomingProtected) {
    return {
      state: "suggested",
      whatChanged: `${titleWithDay(flexibleMissed)} missed`,
      whyItMatters: `${upcomingProtected.title} is still ahead, so backfilling the missed easy work adds load without protecting the week's main purpose.`,
      recommendation: `Drop ${flexibleMissed.title.toLowerCase()} and keep ${upcomingProtected.title.toLowerCase()} unchanged.`,
      rationale: "Flexible work is there to support the week, not to compete with the protected sessions.",
      affectedSessionIds: [flexibleMissed.id, upcomingProtected.id],
      operation: "drop_session",
      primaryLabel: "Apply recommendation"
    };
  }

  const extraEasy = sessions.find((session) => session.lifecycle === "extra" && /easy|recovery|aerobic/i.test(session.title.toLowerCase()));
  if (extraEasy) {
    return {
      state: "suggested",
      whatChanged: `${titleWithDay(extraEasy)} logged as extra work`,
      whyItMatters: "This looks like additive easy load, not a direct threat to the rest of the week.",
      recommendation: "No action needed. Keep the rest of the week as planned unless recovery feels different tomorrow.",
      rationale: "Extra easy load only needs intervention when it starts changing recovery or protected session quality.",
      affectedSessionIds: [extraEasy.id],
      operation: "no_action_needed",
      primaryLabel: "Mark no action"
    };
  }

  return null;
}

export function buildWeekStateSummary(params: {
  sessions: WeekSessionInput[];
  todayIso: string;
}) {
  const sessions = params.sessions.map((session) => {
    const lifecycle = deriveSessionLifecycleState({
      storedStatus: session.storedStatus ?? "planned",
      date: session.date,
      todayIso: params.todayIso,
      isExtra: session.isExtra
    });
    const reviewSummary = normalizeReviewSummary({
      sport: session.sport,
      type: session.title,
      sessionName: session.title,
      intentCategory: session.intentCategory,
      intentSummary: session.intentSummary,
      target: session.target,
      durationMinutes: session.durationMinutes,
      storedStatus: session.storedStatus,
      executionResult: session.executionResult,
      isExtra: session.isExtra
    });

    return {
      ...session,
      lifecycle,
      reviewOutcome:
        session.storedStatus === "skipped" ? "missed_intent" : normalizeReviewOutcomeState(reviewSummary.outcome),
      reviewSummary,
      isProtected: Boolean(session.isProtected || session.isKey),
      isFlexible: Boolean(session.isFlexible),
      isOptional: Boolean(session.isOptional)
    } satisfies DerivedWeekSession;
  });

  const plannedSessions = sessions.filter((session) => !session.isExtra);
  const plannedMinutes = plannedSessions.reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);
  const completedMinutes = plannedSessions
    .filter((session) => session.lifecycle === "completed")
    .reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);
  const remainingMinutes = plannedSessions
    .filter((session) => session.lifecycle === "planned" || session.lifecycle === "today" || session.lifecycle === "missed")
    .reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);
  const counts = {
    completed: sessions.filter((session) => session.lifecycle === "completed").length,
    remaining: sessions.filter((session) => session.lifecycle === "planned" || session.lifecycle === "today").length,
    missed: sessions.filter((session) => session.lifecycle === "missed").length,
    extra: sessions.filter((session) => session.lifecycle === "extra").length,
    skipped: sessions.filter((session) => session.lifecycle === "skipped").length
  };
  const protectedSummary = {
    completed: sessions.filter((session) => session.isProtected && session.lifecycle === "completed").length,
    remaining: sessions.filter((session) => session.isProtected && (session.lifecycle === "planned" || session.lifecycle === "today")).length,
    missed: sessions.filter((session) => session.isProtected && session.lifecycle === "missed").length
  };
  const remainingDayCount = Math.max(
    uniqueCount(
      sessions
        .filter((session) => session.lifecycle === "planned" || session.lifecycle === "today")
        .map((session) => session.date)
    ),
    1
  );
  const remainingLoadPerDay = remainingMinutes / remainingDayCount;
  const remainingLoadRealistic =
    remainingLoadPerDay <= 120 &&
    !(plannedMinutes > 0 && remainingMinutes / plannedMinutes > 0.45 && remainingDayCount <= 2);
  const driftingSessions = sessions.filter(
    (session) =>
      !session.isExtra &&
      session.lifecycle === "completed" &&
      (session.reviewOutcome === "partial_match" || session.reviewOutcome === "missed_intent")
  ).length;
  const offPlanCount = counts.missed + counts.skipped + driftingSessions;
  const protectedAtRisk = sessions.some(
    (session) =>
      session.isProtected &&
      (session.lifecycle === "missed" || session.storedStatus === "skipped" || session.reviewOutcome === "missed_intent")
  );

  const weekRisk: WeekRiskState =
    protectedSummary.missed > 0 || protectedAtRisk || offPlanCount >= 2 || !remainingLoadRealistic
      ? "at_risk"
      : offPlanCount > 0
        ? "watch"
        : "on_track";

  const adaptation = deriveAdaptation(sessions, params.todayIso, remainingLoadRealistic);
  const topIntervention = buildTopIntervention({
    risk: weekRisk,
    sessions,
    plannedMinutes,
    remainingMinutes,
    remainingLoadRealistic,
    adaptation
  });
  const focusStatement =
    weekRisk === "on_track"
      ? "Keep the current order and protect execution quality."
      : weekRisk === "watch"
        ? "Protect the remaining key work and let flexible volume move if needed."
        : "Protect the week intent first and stop chasing every missed minute.";
  const issues = sessions
    .filter(
      (session) =>
        !session.isExtra &&
        (session.lifecycle === "missed" ||
          session.storedStatus === "skipped" ||
          session.reviewOutcome === "partial_match" ||
          session.reviewOutcome === "missed_intent" ||
          session.reviewSummary.missingEvidenceReasons.length > 0)
    )
    .map((session) => ({
      id: `issue:${session.id}`,
      sessionId: session.id,
      sessionTitle: session.title,
      issueType: deriveIssueType(session),
      reviewOutcome: session.reviewOutcome,
      whyItMatters: session.reviewSummary.summary,
      recommendation: session.reviewSummary.recommendation,
      summary: session.reviewSummary.primaryGap
    }))
    .sort((left, right) => {
      const leftScore =
        (left.reviewOutcome === "missed_intent" ? 30 : left.reviewOutcome === "partial_match" ? 20 : 10) +
        (left.issueType === "Session missed" ? 10 : 0);
      const rightScore =
        (right.reviewOutcome === "missed_intent" ? 30 : right.reviewOutcome === "partial_match" ? 20 : 10) +
        (right.issueType === "Session missed" ? 10 : 0);
      return rightScore - leftScore;
    });

  return {
    sessions,
    plannedMinutes,
    completedMinutes,
    remainingMinutes,
    counts,
    protected: protectedSummary,
    remainingLoadPerDay,
    remainingLoadRealistic,
    weekRisk,
    weekRiskLabel: getWeekRiskLabel(weekRisk),
    focusStatement,
    topIntervention,
    adaptation,
    issues
  } satisfies WeekStateSummary;
}
