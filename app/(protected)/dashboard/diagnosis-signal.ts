import { weekdayName, type Session } from "./session-utils";

export type ContextualItem = {
  kicker: string;
  title: string;
  detail: string;
  cta: string;
  href: string;
  ctaStyle: "primary" | "secondary";
};

export type ExecutionRisk = "easy_control" | "recovery_control" | "bike_consistency" | "strong_execution";

export type DiagnosisAwareSignal = {
  statusChipOverride?: import("./week-status").StatusChip;
  interpretationRisk?: ExecutionRisk;
  statusInterpretation?: string;
  focusOverride?: ContextualItem;
  todayCue?: string;
};

export function getDiagnosisAwareSignal({
  sessions,
  todayIso,
  nextPendingTodaySession,
  fallbackFocusItem
}: {
  sessions: Session[];
  todayIso: string;
  nextPendingTodaySession: Session | null;
  fallbackFocusItem: ContextualItem | null;
}): DiagnosisAwareSignal {
  const completedWithDiagnosis = sessions.filter(
    (session) => session.status === "completed" && session.execution_result?.status
  );

  if (completedWithDiagnosis.length < 2) {
    return { focusOverride: fallbackFocusItem ?? undefined };
  }

  const easySessions = completedWithDiagnosis.filter((session) => /easy|aerobic|base|endurance|recovery/i.test(session.intent_category ?? ""));
  const easyOffIntent = easySessions.filter((session) => session.execution_result?.status !== "matched_intent");

  const bikeSessions = completedWithDiagnosis.filter((session) => session.sport === "bike");
  const bikeOffIntent = bikeSessions.filter((session) => session.execution_result?.status !== "matched_intent");

  const recoverySessions = completedWithDiagnosis.filter((session) => /recovery/i.test(session.intent_category ?? ""));
  const recoveryOffIntent = recoverySessions.filter((session) => session.execution_result?.status !== "matched_intent");

  const keySessions = completedWithDiagnosis.filter((session) => session.is_key);
  const keyMatched = keySessions.filter((session) => session.execution_result?.status === "matched_intent");

  const easyOffRatio = easySessions.length > 0 ? easyOffIntent.length / easySessions.length : 0;
  const bikeOffRatio = bikeSessions.length > 0 ? bikeOffIntent.length / bikeSessions.length : 0;
  const recoveryOffRatio = recoverySessions.length > 0 ? recoveryOffIntent.length / recoverySessions.length : 0;

  const nextEasyToday = nextPendingTodaySession && /easy|aerobic|base|endurance|recovery/i.test(nextPendingTodaySession.intent_category ?? "");
  const nextRecoveryToday = nextPendingTodaySession && /recovery/i.test(nextPendingTodaySession.intent_category ?? "");
  const upcomingBike = sessions
    .filter((session) => session.status === "planned" && session.date >= todayIso && session.sport === "bike")
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  if (easySessions.length >= 2 && easyOffRatio >= 0.66) {
    return {
      interpretationRisk: "easy_control",
      focusOverride: {
        kicker: "Focus this week",
        title: "Easy sessions are drifting too hard",
        detail: "Hold easy sessions below target strain so key work stays high quality.",
        cta: nextEasyToday ? "Open today's easy session" : "Review upcoming easy sessions",
        href: nextEasyToday && nextPendingTodaySession ? `/calendar?focus=${nextPendingTodaySession.id}` : "/calendar",
        ctaStyle: "secondary"
      },
      todayCue: nextEasyToday ? "Keep this easy session truly easy." : undefined
    };
  }

  if (recoverySessions.length >= 2 && recoveryOffRatio >= 0.66) {
    return {
      interpretationRisk: "recovery_control",
      focusOverride: {
        kicker: "Focus this week",
        title: "Recovery quality is slipping",
        detail: "Keep recovery sessions genuinely light to protect your next key day.",
        cta: nextRecoveryToday ? "Open today's recovery session" : "Review recovery sessions",
        href: nextRecoveryToday && nextPendingTodaySession ? `/calendar?focus=${nextPendingTodaySession.id}` : "/calendar",
        ctaStyle: "secondary"
      },
      todayCue: nextRecoveryToday ? "Maintain recovery intent." : undefined
    };
  }

  if (bikeSessions.length >= 2 && bikeOffRatio >= 0.66) {
    return {
      interpretationRisk: "bike_consistency",
      focusOverride: {
        kicker: "Focus this week",
        title: "Protect bike consistency",
        detail: `${bikeOffIntent.length} of last ${bikeSessions.length} bike sessions missed intent. Lock in execution before adding load.`,
        cta: upcomingBike ? `Open ${weekdayName(upcomingBike.date)} bike` : "Open next bike session",
        href: upcomingBike ? `/calendar?focus=${upcomingBike.id}` : "/calendar",
        ctaStyle: "secondary"
      },
      todayCue: nextPendingTodaySession?.sport === "bike" ? "Cap effort early." : undefined
    };
  }

  if (keySessions.length >= 2 && keyMatched.length / keySessions.length >= 0.75) {
    return {
      interpretationRisk: "strong_execution",
      focusOverride: {
        kicker: "Focus this week",
        title: "Key session execution is strong — maintain load",
        detail: "Key sessions are landing. Keep easy and recovery days controlled to sustain momentum.",
        cta: "Open weekly plan",
        href: "/calendar",
        ctaStyle: "secondary"
      }
    };
  }

  return { focusOverride: fallbackFocusItem ?? undefined };
}
