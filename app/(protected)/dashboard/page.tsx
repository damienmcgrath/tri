import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  buildExtraCompletedActivities,
  hasConfirmedPlannedSessionLink,
  loadCompletedActivities,
  localIsoDate
} from "@/lib/activities/completed-activities";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { getSessionDisplayName } from "@/lib/training/session";
import { computeWeekMinuteTotals } from "@/lib/training/week-metrics";
import { getDiagnosisDataState } from "@/lib/ui/sparse-data";
import { addDays, getMonday, weekRangeLabel } from "../week-context";

type Session = {
  id: string;
  plan_id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  intent_category?: string | null;
  session_role?: "key" | "supporting" | "recovery" | "optional" | "Key" | "Supporting" | "Recovery" | "Optional" | null;
  source_metadata?: { uploadId?: string | null; assignmentId?: string | null; assignedBy?: "planner" | "upload" | "coach" | null } | null;
  execution_result?: { status?: "matched_intent" | "partial_intent" | "missed_intent" | null; summary?: string | null } | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  status: "planned" | "completed" | "skipped";
  is_key?: boolean | null;
};

type CompletedSession = {
  date: string;
  sport: string;
};

type CompletedActivity = {
  id: string;
  upload_id: string | null;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  schedule_status: "scheduled" | "unscheduled";
  is_unplanned: boolean;
};

type Profile = {
  active_plan_id: string | null;
  race_date: string | null;
  race_name: string | null;
};

type Plan = {
  id: string;
};

type ContextualItem = {
  kicker: string;
  title: string;
  detail: string;
  cta: string;
  href: string;
  ctaStyle: "primary" | "secondary";
};

type StatusChip = {
  label: string;
  className: string;
};

type DiagnosisAwareSignal = {
  statusChipOverride?: StatusChip;
  interpretationRisk?: ExecutionRisk;
  statusInterpretation?: string;
  focusOverride?: ContextualItem;
  todayCue?: string;
};

type ExecutionRisk = "easy_control" | "recovery_control" | "bike_consistency" | "strong_execution";

function toHoursAndMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}h ${mins}m`;
}

function getPerformanceChipTone(className: string) {
  if (className === "signal-ready") {
    return "ready";
  }

  if (className === "signal-risk") {
    return "attention";
  }

  if (className === "signal-load") {
    return "extra";
  }

  return "neutral";
}

function getSessionStatus(session: Session, completionLedger: Record<string, number>) {
  if (session.status === "completed" || session.status === "skipped") {
    return session.status;
  }

  const isSkipped = /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(session.notes ?? "");
  if (isSkipped) {
    return "skipped" as const;
  }

  const key = `${session.date}:${session.sport}`;
  const completedCount = completionLedger[key] ?? 0;

  if (completedCount > 0) {
    completionLedger[key] = completedCount - 1;
    return "completed" as const;
  }

  return "planned" as const;
}

function getStatusChip(completionPct: number, expectedByTodayPct: number) {
  if (expectedByTodayPct <= 0) {
    return { label: "On track", className: "signal-ready" };
  }

  const delta = completionPct - expectedByTodayPct;

  if (delta >= -12) {
    return { label: "On track", className: "signal-ready" };
  }

  if (delta >= -22) {
    return { label: "Slightly behind", className: "signal-load" };
  }

  return { label: "At risk", className: "signal-risk" };
}

function getDefaultStatusInterpretation(statusLabel: string) {
  if (statusLabel === "On track") {
    return "On track — keep session order and keep easy work controlled.";
  }

  if (statusLabel === "Slightly behind") {
    return "Slightly behind — protect key sessions and avoid stacking missed work.";
  }

  return "At risk — complete the next key session and keep weekend load unchanged.";
}

function getDiagnosisStatusInterpretation(statusLabel: string, risk: ExecutionRisk) {
  if (risk === "easy_control") {
    if (statusLabel === "On track") {
      return "On track — easy days are drifting too hard.";
    }
    if (statusLabel === "Slightly behind") {
      return "Slightly behind — keep easy work truly easy.";
    }
    return "At risk — rein in easy-day intensity now.";
  }

  if (risk === "recovery_control") {
    if (statusLabel === "On track") {
      return "On track — recovery sessions are running too hard.";
    }
    if (statusLabel === "Slightly behind") {
      return "Slightly behind — hold recovery intent this week.";
    }
    return "At risk — protect recovery quality before adding load.";
  }

  if (risk === "bike_consistency") {
    if (statusLabel === "On track") {
      return "On track — bike execution needs tighter control.";
    }
    if (statusLabel === "Slightly behind") {
      return "Slightly behind — bike sessions need better execution.";
    }
    return "At risk — stabilize bike execution before adding work.";
  }

  if (statusLabel === "On track") {
    return "On track — execution is strong, hold the current load.";
  }
  if (statusLabel === "Slightly behind") {
    return "Slightly behind, but execution quality is strong.";
  }
  return "At risk on progress — keep quality high while stabilizing load.";
}

function weekdayName(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

function isMissingSessionColumnError(message: string | undefined) {
  return /42703|schema cache|sessions\.(session_name|subtype|workout_type|intent_category|session_role|source_metadata|execution_result|is_key)/i.test(
    message ?? ""
  );
}

function getDayMeaningLabel(daySessions: Session[]) {
  const plannedSessions = daySessions.filter((session) => session.status === "planned");
  if (plannedSessions.length === 0) return null;

  if (plannedSessions.length === 1) {
    return getSessionDisplayName(plannedSessions[0]);
  }

  const uniqueSports = [...new Set(plannedSessions.map((session) => getDisciplineMeta(session.sport).label))];
  if (uniqueSports.length === 1) {
    return `${uniqueSports[0]} x${plannedSessions.length}`;
  }

  if (uniqueSports.length >= 2) {
    return `${uniqueSports[0]} + ${uniqueSports[1]}`;
  }

  return `${plannedSessions.length} sessions`;
}

function getDiagnosisAwareSignal({
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
        cta: nextEasyToday ? "Open today\'s easy session" : "Review upcoming easy sessions",
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
        cta: nextRecoveryToday ? "Open today\'s recovery session" : "Review recovery sessions",
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

export default async function DashboardPage({
  searchParams
}: {
  searchParams?: { weekStart?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const requestedWeekStart = searchParams?.weekStart;
  const currentWeekStart = getMonday().toISOString().slice(0, 10);
  const weekStart = requestedWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeekStart) ? requestedWeekStart : currentWeekStart;
  const weekEnd = addDays(weekStart, 7);
  const timeZone =
    (user.user_metadata && typeof user.user_metadata.timezone === "string" && user.user_metadata.timezone) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const todayIso = localIsoDate(new Date().toISOString(), timeZone);
  const activityRangeStart = `${addDays(weekStart, -1)}T00:00:00.000Z`;
  const activityRangeEnd = `${addDays(weekEnd, 1)}T00:00:00.000Z`;

  const [{ data: profileData }, { data: plansData }, { data: completedData }, completedActivities, { data: linksData }] = await Promise.all([
    supabase.from("profiles").select("active_plan_id,race_date,race_name").eq("id", user.id).maybeSingle(),
    supabase.from("training_plans").select("id").order("start_date", { ascending: false }),
    supabase.from("completed_sessions").select("date,sport").gte("date", weekStart).lt("date", weekEnd),
    loadCompletedActivities({
      supabase,
      userId: user.id,
      rangeStart: activityRangeStart,
      rangeEnd: activityRangeEnd
    }),
    supabase.from("session_activity_links").select("completed_activity_id,planned_session_id,confirmation_status").eq("user_id", user.id)
  ]);

  const profile = (profileData ?? null) as Profile | null;
  const plans = (plansData ?? []) as Plan[];
  const hasAnyPlan = plans.length > 0;
  const activePlanId = profile?.active_plan_id ?? plans[0]?.id ?? null;

  let sessionsData: unknown[] | null = [];

  if (activePlanId) {
    const primary = await supabase
      .from("sessions")
      .select("id,plan_id,date,sport,type,session_name,subtype,workout_type,duration_minutes,intent_category,session_role,source_metadata,execution_result,notes,created_at,status,is_key")
      .eq("user_id", user.id)
      .eq("plan_id", activePlanId)
      .gte("date", weekStart)
      .lt("date", weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });

    if (primary.error && isMissingSessionColumnError(primary.error.message)) {
      const fallback = await supabase
        .from("sessions")
        .select("id,plan_id,date,sport,type,duration_minutes,notes,created_at,status")
        .eq("user_id", user.id)
        .eq("plan_id", activePlanId)
        .gte("date", weekStart)
        .lt("date", weekEnd)
        .order("date", { ascending: true })
        .order("created_at", { ascending: true });
      if (fallback.error) throw new Error(fallback.error.message);
      sessionsData = fallback.data as unknown[] | null;
    } else if (primary.error) {
      throw new Error(primary.error.message);
    } else {
      sessionsData = primary.data as unknown[] | null;
    }
  }

  const completionLedger = ((completedData ?? []) as CompletedSession[]).reduce<Record<string, number>>((acc, session) => {
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const uploadedActivities = completedActivities;
  const links = (linksData ?? []) as Array<{ completed_activity_id: string; planned_session_id?: string | null; confirmation_status?: "suggested" | "confirmed" | "rejected" | null }>;
  const confirmedLinks = links.filter(hasConfirmedPlannedSessionLink);
  const linkedSessionIds = new Set(confirmedLinks.map((item) => item.planned_session_id).filter((value): value is string => Boolean(value)));

  const durationByActivityId = new Map(uploadedActivities.map((activity) => [activity.id, Math.round((activity.duration_sec ?? 0) / 60)]));
  const linkedMinutesBySession = confirmedLinks.reduce<Map<string, number>>((acc, link) => {
    if (!link.planned_session_id) return acc;
    const minutes = durationByActivityId.get(link.completed_activity_id) ?? 0;
    acc.set(link.planned_session_id, (acc.get(link.planned_session_id) ?? 0) + minutes);
    return acc;
  }, new Map());
  const extraActivities = buildExtraCompletedActivities({
    activities: uploadedActivities,
    links,
    timeZone,
    weekStart,
    weekEndExclusive: weekEnd
  });
  const extraMinutesByDay = extraActivities.reduce<Map<string, number>>((acc, activity) => {
    acc.set(activity.date, (acc.get(activity.date) ?? 0) + activity.durationMinutes);
    return acc;
  }, new Map());
  const extraMinutesBySport = extraActivities.reduce<Map<string, number>>((acc, activity) => {
    acc.set(activity.sport, (acc.get(activity.sport) ?? 0) + activity.durationMinutes);
    return acc;
  }, new Map());

  const getCompletedMinutes = (session: Pick<Session, "id" | "duration_minutes" | "status">) => {
    const linkedMinutes = linkedMinutesBySession.get(session.id);
    if (typeof linkedMinutes === "number" && linkedMinutes > 0) {
      return linkedMinutes;
    }

    return session.status === "completed" ? session.duration_minutes ?? 0 : 0;
  };

  const sessions = ((sessionsData ?? []) as Session[]).map((session) => ({
    ...session,
    duration_minutes: session.duration_minutes ?? 0,
    status: linkedSessionIds.has(session.id) ? ("completed" as const) : getSessionStatus(session, completionLedger),
    is_key: Boolean((session as { is_key?: boolean }).is_key)
  }));

  const hasActivePlan = Boolean(activePlanId);
  const todaySessions = sessions.filter((session) => session.date === todayIso);
  const pendingTodaySessions = todaySessions.filter((session) => session.status === "planned");
  const completedTodaySessions = todaySessions.filter((session) => session.status === "completed");
  const extraTodayActivities = extraActivities.filter((activity) => activity.date === todayIso);
  const nextPendingTodaySession = pendingTodaySessions[0] ?? null;
  const todayCompletedMinutes =
    completedTodaySessions.reduce((sum, session) => sum + getCompletedMinutes(session), 0) +
    extraTodayActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const plannedCompletedSessionsCount = sessions.filter((session) => session.status === "completed").length;
  const extraCompletedCount = extraActivities.length;

  const weekMetricSessions = sessions.map((session) => ({
    id: session.id,
    date: session.date,
    sport: session.sport,
    durationMinutes: session.duration_minutes ?? 0,
    status: session.status,
    isKey: session.is_key
  }));

  const minuteMetrics = computeWeekMinuteTotals(
    weekMetricSessions,
    extraActivities.map((activity) => ({
      id: activity.id,
      date: activity.date,
      sport: activity.sport,
      durationMinutes: activity.durationMinutes
    }))
  );
  const totals = { planned: minuteMetrics.plannedMinutes, completed: minuteMetrics.completedMinutes };
  const completedSessionsCount = plannedCompletedSessionsCount + extraCompletedCount;
  const missedSessions = sessions.filter((session) => session.status === "planned" && session.date < todayIso);
  const missedSessionsCount = missedSessions.length;
  const missedMinutes = missedSessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);

  const completionPct = totals.planned > 0 ? Math.round((totals.completed / totals.planned) * 100) : 0;
  const remainingMinutes = Math.max(totals.planned - totals.completed, 0);
  const dayIndex = Math.floor((Date.parse(`${todayIso}T00:00:00.000Z`) - Date.parse(`${weekStart}T00:00:00.000Z`)) / 86_400_000);
  const elapsedDays = Math.max(0, Math.min(dayIndex + 1, 7));
  const expectedByTodayPct = Math.round((elapsedDays / 7) * 100);
  const statusChip = getStatusChip(completionPct, expectedByTodayPct);

  const dailyStates = Array.from({ length: 7 }).map((_, index) => {
    const iso = addDays(weekStart, index);
    const daySessions = sessions.filter((session) => session.date === iso);
    const plannedCount = daySessions.filter((session) => session.status === "planned").length;
    const plannedMinutes = daySessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
    const extraMinutesOnDay = extraMinutesByDay.get(iso) ?? 0;
    const completedMinutesOnDay =
      daySessions.filter((session) => session.status === "completed").reduce((sum, session) => sum + getCompletedMinutes(session), 0) +
      extraMinutesOnDay;
    const remainingMinutesOnDay = Math.max(plannedMinutes - completedMinutesOnDay, 0);
    const trainingMeaning = getDayMeaningLabel(daySessions);

    const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));

    let tone: "rest" | "upcoming" | "today-remaining" | "today-complete" | "completed" | "missed" = "rest";
    let stateLabel = "Rest";
    let microLabel = "Rest";

    if (iso === todayIso) {
      if (plannedCount > 0 && remainingMinutesOnDay > 0) {
        tone = "today-remaining";
        stateLabel = "Today";
        microLabel = completedMinutesOnDay > 0 ? `${completedMinutesOnDay}m done · ${remainingMinutesOnDay}m left` : `${remainingMinutesOnDay}m left`;
      } else if (completedMinutesOnDay > 0) {
        tone = "today-complete";
        stateLabel = "Completed";
        microLabel = `${completedMinutesOnDay}m done`;
      }
    } else if (iso < todayIso) {
      if (plannedCount > 0 && remainingMinutesOnDay > 0) {
        tone = "missed";
        stateLabel = completedMinutesOnDay > 0 ? "Mixed" : "Missed";
        microLabel = completedMinutesOnDay > 0 ? `${completedMinutesOnDay}m done · ${remainingMinutesOnDay || plannedMinutes}m missed` : `${remainingMinutesOnDay || plannedMinutes}m missed`;
      } else if (completedMinutesOnDay > 0) {
        tone = "completed";
        stateLabel = "Completed";
        microLabel = `${completedMinutesOnDay}m done`;
      }
    } else if (plannedCount > 0) {
      tone = "upcoming";
      stateLabel = trainingMeaning ? `${trainingMeaning} · ${plannedMinutes}m` : `${plannedMinutes}m planned`;
      microLabel = trainingMeaning ? "" : `${plannedMinutes}m planned`;
    }

    return { iso, label, tone, stateLabel, microLabel };
  });

  const overdueKeySession = sessions
    .filter((session) => session.is_key && session.status === "planned" && session.date < todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  const behindByMinutes = Math.max(Math.round((expectedByTodayPct / 100) * totals.planned) - totals.completed, 0);

  const sports = ["swim", "bike", "run", "strength"] as const;
  const biggestGap = sports
    .map((sport) => {
      const planned = sessions.filter((session) => session.sport === sport).reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
      const completed = sessions
        .filter((session) => session.sport === sport)
        .reduce((sum, session) => sum + getCompletedMinutes(session), 0) + (extraMinutesBySport.get(sport) ?? 0);
      return { sport, label: getDisciplineMeta(sport).label, gap: Math.max(planned - completed, 0), planned, completed };
    })
    .sort((a, b) => b.gap - a.gap)[0];

  const nextGapSession = biggestGap
    ? sessions
      .filter((session) => session.sport === biggestGap.sport && session.status === "planned" && session.date >= todayIso)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
    : null;

  const attentionItem: ContextualItem | null = overdueKeySession
    ? {
        kicker: "Needs attention",
        title: `Missed key session: ${getSessionDisplayName(overdueKeySession)}`,
        detail: "Missing this key session shifts too much load into the back half of the week.",
        cta: "Reschedule key session",
        href: `/calendar?focus=${overdueKeySession.id}`,
        ctaStyle: "primary"
      }
    : behindByMinutes >= 30
      ? {
          kicker: "Needs attention",
          title: "You are behind this week",
          detail: `${toHoursAndMinutes(behindByMinutes)} behind expected progress today.`,
          cta: "Open weekly plan",
          href: "/calendar",
          ctaStyle: "primary"
        }
      : missedSessionsCount > 0
        ? {
            kicker: "Needs attention",
            title: `${missedSessionsCount} missed session${missedSessionsCount > 1 ? "s" : ""}`,
            detail: `${toHoursAndMinutes(missedMinutes)} still open from earlier this week.`,
            cta: "Review missed work",
            href: "/calendar",
            ctaStyle: "primary"
          }
        : null;

  const focusItem: ContextualItem | null = biggestGap && biggestGap.gap >= 20
    ? {
        kicker: "Focus this week",
        title: `Protect ${biggestGap.label.toLowerCase()} consistency`,
        detail: nextGapSession
          ? `${biggestGap.gap} min behind on ${biggestGap.label.toLowerCase()} load. Complete ${weekdayName(nextGapSession.date)} ${getDisciplineMeta(nextGapSession.sport).label.toLowerCase()} and keep weekend unchanged.`
          : `${biggestGap.gap} min behind on ${biggestGap.label.toLowerCase()} load. Complete the next planned ${biggestGap.label.toLowerCase()} workout and keep weekend unchanged.`,
        cta: nextGapSession
          ? `Open ${weekdayName(nextGapSession.date)} ${getDisciplineMeta(nextGapSession.sport).label.toLowerCase()}`
          : `Open next ${biggestGap.label.toLowerCase()} workout`,
        href: nextGapSession ? `/calendar?focus=${nextGapSession.id}` : "/calendar",
        ctaStyle: "secondary"
      }
    : null;

  const diagnosedSessionCount = sessions.filter((session) => session.status === "completed" && session.execution_result?.status).length;
  const diagnosisDataState = getDiagnosisDataState(diagnosedSessionCount);

  const diagnosisAwareSignal = diagnosisDataState.isSparse
    ? { focusOverride: focusItem ?? undefined }
    : getDiagnosisAwareSignal({
        sessions,
        todayIso,
        nextPendingTodaySession,
        fallbackFocusItem: focusItem
      });

  const resolvedStatusChip = diagnosisAwareSignal.statusChipOverride ?? statusChip;
  const statusInterpretation = diagnosisDataState.isSparse
    ? `${getDefaultStatusInterpretation(resolvedStatusChip.label)} ${diagnosisDataState.guidanceText}`
    : diagnosisAwareSignal.statusInterpretation
      ?? (diagnosisAwareSignal.interpretationRisk
        ? getDiagnosisStatusInterpretation(resolvedStatusChip.label, diagnosisAwareSignal.interpretationRisk)
        : getDefaultStatusInterpretation(resolvedStatusChip.label));
  const resolvedFocusItem = diagnosisAwareSignal.focusOverride ?? focusItem;
  const todayCue = diagnosisAwareSignal.todayCue;

  const contextualItems = [attentionItem, resolvedFocusItem].filter((item): item is ContextualItem => Boolean(item));

  if (!hasActivePlan && !hasAnyPlan) {
    return (
      <section className="performance-page space-y-4">
        <article className="performance-panel performance-panel-supporting p-6">
          <p className="performance-eyebrow text-[hsl(var(--accent-performance))]">Get started</p>
          <h1 className="mt-2 text-2xl font-semibold">Build your first week</h1>
          <p className="mt-2 text-sm text-muted">
            Create a plan to unlock this week progress, today execution, and focused coaching decisions.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/plan" className="btn-primary performance-btn-primary">Create a plan</Link>
            <Link href="/settings/integrations" className="btn-secondary performance-btn-secondary">Connect Garmin</Link>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="performance-page space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <article className="performance-panel performance-panel-hero p-5 md:p-6">
          <p className="performance-eyebrow text-[hsl(var(--accent-performance))]">This week</p>
          <p className="mt-1 text-sm text-muted">Week of {weekRangeLabel(weekStart)}</p>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="performance-hero-value">{completionPct}%</p>
              <p className="performance-hero-subvalue mt-2">{toHoursAndMinutes(totals.completed)} / {toHoursAndMinutes(totals.planned)}</p>
              <p className="mt-1 text-sm text-muted">
                {completedSessionsCount} completed this week
                {extraCompletedCount > 0 ? ` · ${plannedCompletedSessionsCount}/${sessions.length} planned landed · ${extraCompletedCount} extra` : ` · ${plannedCompletedSessionsCount}/${sessions.length} planned landed`}
              </p>
            </div>
            <span className="performance-chip dashboard-status-chip" data-tone={getPerformanceChipTone(resolvedStatusChip.className)}>
              {resolvedStatusChip.label}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">{statusInterpretation}</p>
          {diagnosisDataState.isSparse ? <p className="mt-1 text-xs text-tertiary">{diagnosisDataState.unlockText}</p> : null}

          <div className="mt-5 grid grid-cols-7 gap-2">
            {dailyStates.map((day) => {
              return (
                <div key={day.iso} className="performance-day-pill" data-tone={day.tone}>
                  <p className="text-[10px] font-medium uppercase tracking-[0.04em] text-[hsl(var(--fg-muted))]">{day.label}</p>
                  <p className="mt-0.5 text-[11px] font-semibold leading-tight">{day.stateLabel}</p>
                  {day.microLabel ? <p className="mt-0.5 text-[10px] text-[hsl(var(--fg-muted))]">{day.microLabel}</p> : null}
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[hsl(var(--performance-border))] pt-3 text-sm">
            <p className="performance-metric-tile">
              <span className="performance-metric-label">Completed</span>
              <span className="performance-metric-value">{toHoursAndMinutes(totals.completed)}</span>
            </p>
            <p className="performance-metric-tile">
              <span className="performance-metric-label">Remaining</span>
              <span className="performance-metric-value">{toHoursAndMinutes(remainingMinutes)}</span>
            </p>
            <p className="performance-metric-tile">
              <span className="performance-metric-label">Missed</span>
              <span className="performance-metric-value">{toHoursAndMinutes(missedMinutes)}</span>
            </p>
          </div>
        </article>

        <article className="performance-panel performance-panel-supporting p-5 md:p-6">
          {pendingTodaySessions.length > 0 ? (
            <>
              <p className="performance-eyebrow">Today</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Today</h2>
              <p className="mt-1 text-sm text-muted">{pendingTodaySessions.length} remaining{` · ${completedTodaySessions.length + extraTodayActivities.length} completed`}</p>
              {todayCue ? <p className="mt-2 text-xs text-muted">Cue: {todayCue}</p> : null}

              <div className="mt-4 space-y-3">
                <div>
                  <p className="performance-eyebrow mb-2">Remaining today</p>
                  <div className="space-y-2">
                    {pendingTodaySessions.map((session) => (
                      <div key={session.id} className="performance-session-card" data-tone="planned">
                        <p className="text-sm font-medium">{getSessionDisplayName(session)}</p>
                        <p className="text-xs text-muted">{session.duration_minutes} min{session.is_key ? " • Key" : ""} • Remaining</p>
                      </div>
                    ))}
                  </div>
                </div>

                {completedTodaySessions.length > 0 || extraTodayActivities.length > 0 ? (
                  <div>
                    <p className="performance-eyebrow mb-2">Completed today</p>
                    <div className="space-y-2">
                      {completedTodaySessions.map((session) => (
                        <div key={session.id} className="performance-session-card" data-tone="done">
                          <p className="text-sm font-medium">{getSessionDisplayName(session)}</p>
                          <p className="text-xs text-muted">{getCompletedMinutes(session)} min • Done</p>
                        </div>
                      ))}
                      {extraTodayActivities.map((activity) => (
                        <Link key={activity.id} href={`/sessions/activity/${activity.id}`} className="performance-session-card performance-link-card block" data-tone="done">
                          <p className="text-sm font-medium">{getDisciplineMeta(activity.sport).label} extra workout</p>
                          <p className="text-xs text-muted">{activity.durationMinutes} min • Done</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {nextPendingTodaySession ? <Link href={`/calendar?focus=${nextPendingTodaySession.id}`} className="btn-primary performance-btn-primary px-3 py-1.5 text-xs">Open session</Link> : null}
                <Link href="/calendar" className="btn-secondary performance-btn-secondary px-3 py-1.5 text-xs">View plan</Link>
              </div>
            </>
          ) : completedTodaySessions.length > 0 || extraTodayActivities.length > 0 ? (
            <>
              <p className="performance-eyebrow">Today</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Today</h2>
              <p className="mt-1 text-sm text-muted">0 remaining · {completedTodaySessions.length + extraTodayActivities.length} completed</p>
              <h3 className="mt-2 text-lg font-semibold">{toHoursAndMinutes(todayCompletedMinutes)} done</h3>
              <p className="mt-2 text-sm text-muted">All scheduled sessions for today are complete. You are {resolvedStatusChip.label === "On track" ? "on track" : "still within reach"} this week.</p>
              <div className="mt-4 space-y-2">
                {completedTodaySessions.map((session) => (
                  <div key={session.id} className="performance-session-card" data-tone="done">
                    <p className="text-sm font-medium">{getSessionDisplayName(session)}</p>
                    <p className="text-xs text-muted">{getCompletedMinutes(session)} min • Done</p>
                  </div>
                ))}
                {extraTodayActivities.map((activity) => (
                  <Link key={activity.id} href={`/sessions/activity/${activity.id}`} className="performance-session-card performance-link-card block" data-tone="done">
                    <p className="text-sm font-medium">{getDisciplineMeta(activity.sport).label} extra workout</p>
                    <p className="text-xs text-muted">{activity.durationMinutes} min • Done</p>
                  </Link>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={
                    completedTodaySessions[0]
                      ? `/sessions/${completedTodaySessions[0].id}`
                      : extraTodayActivities[0]
                        ? `/sessions/activity/${extraTodayActivities[0].id}`
                        : "/calendar"
                  }
                  className="btn-primary performance-btn-primary px-3 py-1.5 text-xs"
                >
                  Review completed sessions
                </Link>
                <Link href="/plan" className="btn-secondary performance-btn-secondary px-3 py-1.5 text-xs">Open plan</Link>
              </div>
            </>
          ) : (
            <>
              <p className="performance-eyebrow">Today</p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em]">Today</h2>
              <p className="mt-1 text-sm text-muted">No sessions scheduled</p>
              <h3 className="mt-2 text-lg font-semibold">No sessions scheduled today</h3>
              <p className="mt-2 text-sm text-muted">Use today for recovery and reset, then protect the next planned key session.</p>
              <div className="mt-4">
                <Link href="/calendar" className="btn-secondary performance-btn-secondary px-3 py-1.5 text-xs">View plan</Link>
              </div>
            </>
          )}
        </article>
      </div>

      {contextualItems.length === 1 ? (
        <article className="performance-context-card p-5 md:p-6" data-tone={contextualItems[0].kicker === "Needs attention" ? "attention" : "focus"}>
          <p className={`performance-eyebrow ${contextualItems[0].kicker === "Needs attention" ? "text-[hsl(var(--performance-attention))]" : "text-[hsl(var(--accent-performance))]"}`}>{contextualItems[0].kicker}</p>
          <h3 className="mt-2 text-lg font-semibold">{contextualItems[0].title}</h3>
          <p className="mt-2 text-sm text-muted">{contextualItems[0].detail}</p>
          <div className="mt-4">
            <Link href={contextualItems[0].href} className={`${contextualItems[0].ctaStyle === "primary" ? "btn-primary performance-btn-primary" : "btn-secondary performance-btn-secondary"} px-3 py-1.5 text-xs`}>{contextualItems[0].cta}</Link>
          </div>
        </article>
      ) : null}

      {contextualItems.length === 2 ? (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          {contextualItems.map((item) => (
            <article key={item.kicker} className="performance-context-card p-5 md:p-6" data-tone={item.kicker === "Needs attention" ? "attention" : "focus"}>
              <p className={`performance-eyebrow ${item.kicker === "Needs attention" ? "text-[hsl(var(--performance-attention))]" : "text-[hsl(var(--accent-performance))]"}`}>{item.kicker}</p>
              <h3 className="mt-2 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted">{item.detail}</p>
              <div className="mt-4">
                <Link href={item.href} className={`${item.ctaStyle === "primary" ? "btn-primary performance-btn-primary" : "btn-secondary performance-btn-secondary"} px-3 py-1.5 text-xs`}>{item.cta}</Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
