import { Suspense } from "react";
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
import { SESSION_INTENT_LABELS } from "@/lib/training/semantics";
import { computeWeekMinuteTotals, computeWeekShape } from "@/lib/training/week-metrics";
import { getDiagnosisDataState } from "@/lib/ui/sparse-data";
import { getWeeklyDebriefSnapshot } from "@/lib/weekly-debrief";
import { addDays, getMonday, weekRangeLabel } from "../week-context";
import { WeeklyDebriefCard } from "./weekly-debrief-card";
import { WeekAheadCard } from "./components/week-ahead-card";
import { WeekNavigator } from "./components/week-navigator";
import { TransitionBriefingCard } from "./components/transition-briefing-card";
import { TrendCards } from "./trend-cards";
import { MorningBriefCard } from "./components/morning-brief-card";
import { TrainingScoreCard } from "./components/training-score-card";
import { ReadinessIndicator } from "./components/readiness-indicator";
import { RecentUploadCard } from "./components/recent-upload-card";
import { DisciplineBalanceCompact } from "./components/discipline-balance-compact";
import { DashboardCardSkeleton } from "./components/dashboard-skeletons";
import { getLatestFitness, getReadinessState, getTsbTrend } from "@/lib/training/fitness-model";
import { computeWeeklyDisciplineBalance, detectDisciplineImbalance } from "@/lib/training/discipline-balance";
import { detectTrends } from "@/lib/training/trends";
import { detectCrossDisciplineFatigue, type FatigueSignal } from "@/lib/training/fatigue-detection";
import { getWeekTransitionBriefing, generateWeekTransitionBriefing } from "@/lib/training/week-transition";
import { getOrGenerateMorningBrief, type MorningBrief } from "@/lib/training/morning-brief";
import { MondayTransitionFlow } from "./components/monday-transition-flow";
import { getOrComputeTrainingScore } from "@/lib/training/scoring";
import { getRaceWeekContext, formatRaceDistance, getConfidenceStatement, type RaceWeekContext } from "@/lib/training/race-week";
import {
  type Session,
  type CompletedSession,
  type Profile,
  type Plan,
  type ContextualItem,
  type DayTone,
  kickerClassName,
  toHoursAndMinutes,
  getNextImportantSession,
  getUpcomingSessionMeta,
  getDayToneClass,
  getDayChipContent,
  getDayChipTitleClass,
  getSessionStatus,
  getStatusChip,
  getDefaultStatusInterpretation,
  getDiagnosisStatusInterpretation,
  getDiagnosisAwareSignal,
  getDayMeaningLabel,
  weekdayName,
  isMissingSessionColumnError,
} from "./dashboard-helpers";

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
  const isCurrentWeek = weekStart === currentWeekStart;
  const showWeeklyDebriefCard = isCurrentWeek;

  const nowForMoment = new Date();
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(nowForMoment);
  const weekdayStr = localParts.find((p) => p.type === "weekday")?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const todayDayOfWeek = weekdayMap[weekdayStr] ?? nowForMoment.getUTCDay();
  const hourOfDay = Number(localParts.find((p) => p.type === "hour")?.value ?? nowForMoment.getUTCHours());

  // Transition briefing is a Mon/Tue concept (bridging last week → this week).
  // Sunday (day 0) is end-of-week, not start-of-week — don't show it then.
  // Week Ahead preview is relevant on Sun/Mon/Tue (looking ahead to next week on Sun, or reviewing this week on Mon/Tue).
  const showWeekAheadCard = isCurrentWeek && (todayDayOfWeek === 0 || todayDayOfWeek === 1 || todayDayOfWeek === 2);
  const showTransitionBriefing = isCurrentWeek && (todayDayOfWeek === 1 || todayDayOfWeek === 2);

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

  // Fetch week navigation data (training_weeks for plan)
  let weekOptions: Array<{ weekStart: string; label: string; blockLabel: string | null }> = [];
  let currentBlockLabel: string | null = null;
  let currentWeekNumber: number | null = null;
  if (activePlanId) {
    const { data: weeksData } = await supabase
      .from("training_weeks")
      .select("week_index,week_start_date,focus")
      .eq("plan_id", activePlanId)
      .order("week_index", { ascending: true });
    if (weeksData && weeksData.length > 0) {
      weekOptions = (weeksData as Array<{ week_index: number; week_start_date: string; focus: string }>).map((w) => ({
        weekStart: w.week_start_date,
        label: `Week ${w.week_index}`,
        blockLabel: w.focus
      }));
      const currentWeekEntry = weekOptions.find((w) => w.weekStart === weekStart);
      if (currentWeekEntry) {
        currentBlockLabel = currentWeekEntry.blockLabel;
        currentWeekNumber = weekOptions.indexOf(currentWeekEntry) + 1;
      }
    }
  }
  // Ensure current week is always in options even if plan doesn't cover it
  if (!weekOptions.some((w) => w.weekStart === currentWeekStart)) {
    weekOptions.push({ weekStart: currentWeekStart, label: "Current week", blockLabel: null });
  }
  weekOptions.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

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

  // Race-week context — fetched early so it can influence moment detection and card ordering
  const raceWeekCtx = isCurrentWeek
    ? await getRaceWeekContext(supabase, user.id, todayIso).catch(() => null)
    : null;

  // Dashboard moment detection — determines the athlete's current context
  type DashboardMoment = "race_day" | "race_eve" | "race_week" | "post_race" | "just_uploaded" | "monday_transition" | "end_of_week" | "session_today" | "rest_day" | "default";

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
    durationMinutes: session.status === "completed" ? getCompletedMinutes(session) : (session.duration_minutes ?? 0),
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
  const missedSessions = sessions.filter((session) => (session.status === "planned" || session.status === "skipped") && session.date < todayIso);
  const missedSessionsCount = missedSessions.length;
  const missedMinutes = missedSessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);

  const completionPct = totals.planned > 0 ? Math.round((totals.completed / totals.planned) * 100) : 0;
  const remainingMinutes = minuteMetrics.remainingMinutes;
  const dayIndex = Math.floor((Date.parse(`${todayIso}T00:00:00.000Z`) - Date.parse(`${weekStart}T00:00:00.000Z`)) / 86_400_000);
  const elapsedDays = Math.max(0, Math.min(dayIndex + 1, 7));
  // Shape-aware expectation: use the actual planned minutes scheduled on or before today,
  // not a flat elapsedDays/7 share. Back-loaded weeks (long run Sat, long bike Sun) should
  // not read as "at risk" on Friday when Mon–Fri's share of the load is genuinely complete.
  const weekShape = computeWeekShape({ sessions: weekMetricSessions, todayIso });
  const expectedByTodayPct = totals.planned > 0
    ? Math.round(weekShape.expectedShareByToday * 100)
    : Math.round((elapsedDays / 7) * 100);
  const statusChip = getStatusChip(completionPct, expectedByTodayPct);

  // Determine the dashboard moment for context-aware ordering
  // Race-week states take priority over standard moments
  const hasPendingToday = todaySessions.some((s) => s.status === "planned");
  let dashboardMoment: DashboardMoment = "default";
  if (!isCurrentWeek) {
    dashboardMoment = "default";
  } else if (raceWeekCtx?.proximity === "race_day") {
    dashboardMoment = "race_day";
  } else if (raceWeekCtx?.proximity === "day_before") {
    dashboardMoment = "race_eve";
  } else if (raceWeekCtx?.proximity === "race_week" || raceWeekCtx?.proximity === "pre_race_week") {
    dashboardMoment = "race_week";
  } else if (raceWeekCtx?.proximity === "post_race") {
    dashboardMoment = "post_race";
  } else if (todayDayOfWeek === 1 || (todayDayOfWeek === 2 && hourOfDay < 12)) {
    dashboardMoment = "monday_transition";
  } else if ((todayDayOfWeek === 6 || todayDayOfWeek === 0) && completionPct > 60) {
    dashboardMoment = "end_of_week";
  } else if (hasPendingToday) {
    dashboardMoment = "session_today";
  } else if (!hasPendingToday) {
    dashboardMoment = "rest_day";
  }

  const dailyStates = Array.from({ length: 7 }).map((_, index) => {
    const iso = addDays(weekStart, index);
    const daySessions = sessions.filter((session) => session.date === iso);
    const unresolvedCount = daySessions.filter((session) => session.status === "planned" || session.status === "skipped").length;
    const plannedMinutes = daySessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
    const extraMinutesOnDay = extraMinutesByDay.get(iso) ?? 0;
    const plannedCompletedMinutesOnDay =
      daySessions.filter((session) => session.status === "completed").reduce((sum, session) => sum + getCompletedMinutes(session), 0);
    const completedMinutesOnDay = plannedCompletedMinutesOnDay + extraMinutesOnDay;
    const remainingMinutesOnDay = Math.max(plannedMinutes - plannedCompletedMinutesOnDay, 0);
    const trainingMeaning = getDayMeaningLabel(daySessions);

    const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));

    let tone: DayTone = "rest";
    let stateLabel = "Rest";
    let microLabel = "";

    if (iso === todayIso) {
      if (unresolvedCount > 0 && remainingMinutesOnDay > 0) {
        tone = "today-remaining";
        stateLabel = "Today";
        microLabel = trainingMeaning
          ? `${trainingMeaning} · ${remainingMinutesOnDay}m left`
          : completedMinutesOnDay > 0
            ? `${completedMinutesOnDay}m done · ${remainingMinutesOnDay}m left`
            : `${remainingMinutesOnDay}m left`;
      } else if (completedMinutesOnDay > 0) {
        tone = "today-complete";
        stateLabel = "Today";
        microLabel = `${completedMinutesOnDay}m done`;
      }
    } else if (iso < todayIso) {
      if (unresolvedCount > 0 && remainingMinutesOnDay > 0) {
        tone = "missed";
        stateLabel = completedMinutesOnDay > 0 ? "Mixed" : "Missed";
        microLabel = completedMinutesOnDay > 0 ? `${completedMinutesOnDay}m done · ${remainingMinutesOnDay || plannedMinutes}m missed` : `${remainingMinutesOnDay || plannedMinutes}m missed`;
      } else if (completedMinutesOnDay > 0) {
        tone = "completed";
        stateLabel = "Done";
        microLabel = `${completedMinutesOnDay}m done`;
      }
    } else if (unresolvedCount > 0) {
      tone = "upcoming";
      stateLabel = trainingMeaning ?? "Upcoming";
      microLabel = `${plannedMinutes}m planned`;
    } else {
      microLabel = "";
    }

    // Distinct sports for this day's sessions — surfaced as dots on the day chip
    // so the week's sport shape is legible at a glance.
    const sports = Array.from(new Set(daySessions.map((session) => session.sport).filter(Boolean))) as string[];

    return { iso, label, tone, stateLabel, microLabel, sports };
  });

  const overdueKeySession = sessions
    .filter((session) => session.is_key && session.status === "planned" && session.date < todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  const expectedMinutesByToday = totals.planned > 0
    ? weekShape.expectedShareByToday * totals.planned
    : (elapsedDays / 7) * totals.planned;
  // Exclude extra / unplanned activities from the "behind on plan" calculation — an
  // off-plan bike doesn't complete a remaining planned run. Use planned-completed
  // minutes only for the pacing signal; extras stay visible through the Today card.
  const behindByMinutes = Math.max(
    Math.round(expectedMinutesByToday - minuteMetrics.plannedCompletedMinutes),
    0
  );
  // Only surface "behind" when there is genuinely remaining or overdue work.  A back-loaded week can
  // look "behind pace" even when every session through today is done — suppress the alert in that case.
  // Also suppress on planned rest days: the Morning Brief already covers "take it fully" and the
  // "behind" framing is misleading when today was never supposed to contain work.
  //
  // Additionally suppress when the week is weekend-loaded and the shape-adjusted completion
  // is close to expectation — otherwise Fri shows "at risk 2h 34m behind" when the athlete
  // has done 48% of the load correctly because 52% is scheduled Sat/Sun.
  const todayHasRemainingWork = dailyStates.find((d) => d.iso === todayIso)?.tone === "today-remaining";
  const shapeAdjustedDeltaPct = completionPct - expectedByTodayPct;
  // Only treat a week as "weekend-loaded on plan" when today has no outstanding work and
  // no past sessions are missed. If today is partially complete, the user genuinely is
  // behind and the shape argument shouldn't hide that.
  const isWeekendLoadedOnPlan =
    weekShape.isWeekendLoaded &&
    missedSessionsCount === 0 &&
    !todayHasRemainingWork &&
    shapeAdjustedDeltaPct >= -12;
  const behindAlertActive =
    behindByMinutes >= 30 &&
    dashboardMoment !== "rest_day" &&
    !isWeekendLoadedOnPlan &&
    (missedSessionsCount > 0 || todayHasRemainingWork);

  const sports = ["swim", "bike", "run", "strength"] as const;
  const biggestGap = sports
    .map((sport) => {
      const planned = sessions.filter((session) => session.sport === sport).reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
      const completed = sessions
        .filter((session) => session.sport === sport)
        .reduce((sum, session) => sum + getCompletedMinutes(session), 0);
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
    : behindAlertActive
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
        title: biggestGap.sport === "run" ? "Complete the Sunday run" : `Protect ${biggestGap.label.toLowerCase()} consistency`,
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
  const resolvedFocusItem = diagnosisAwareSignal.focusOverride ?? focusItem;
  const todayCue = diagnosisAwareSignal.todayCue;
  const nextImportantSession = getNextImportantSession(sessions, todayIso);

  // During race week taper or post-race, suppress volume-deficit and balance warnings
  // — reduced volume is intentional, not a problem
  const isRaceWeekSuppressed = raceWeekCtx?.taperStatus.inTaper ||
    dashboardMoment === "race_day" || dashboardMoment === "race_eve" || dashboardMoment === "post_race";

  // F12: the attention signal ("You are behind", "Missed key session", etc.) is the
  // left-column "This week" card's new inline status row. The right column's
  // contextualItems list only carries *forward-looking* focus items now — otherwise
  // the user sees the same warning described three different ways.
  const attentionIsAboutKeySession = attentionItem?.title.startsWith("Missed key session");
  const showFocusItem = !isRaceWeekSuppressed && resolvedFocusItem && (!attentionItem || attentionIsAboutKeySession);
  const leftStatusRow = isRaceWeekSuppressed ? null : attentionItem;
  const contextualItems = [
    showFocusItem ? resolvedFocusItem : null
  ].filter((item): item is ContextualItem => Boolean(item));

  if (!hasActivePlan && !hasAnyPlan) {
    return (
      <section className="space-y-4">
        <article className="surface p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-accent">Get started</p>
          <h1 className="mt-2 text-2xl font-semibold">Build your first week</h1>
          <p className="mt-2 text-sm text-muted">
            Create a plan to unlock this week progress, today execution, and focused coaching decisions.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/plan" className="btn-primary">Create a plan</Link>
            <Link href="/settings/integrations" className="btn-secondary">Connect Garmin</Link>
          </div>
        </article>
      </section>
    );
  }

  const showWeekNavigator = weekOptions.length > 1;

  return (
    <section className="space-y-4">
      {/* Race-week hero cards — take priority over everything else */}
      {dashboardMoment === "race_day" && raceWeekCtx ? (
        <article className="rounded-xl border border-[rgba(251,191,36,0.5)] bg-[rgba(251,191,36,0.08)] px-5 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-400">Race day</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{raceWeekCtx.race.name}</h2>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.72)]">{formatRaceDistance(raceWeekCtx)}</p>
          <p className="mt-3 text-sm text-[rgba(255,255,255,0.84)]">{getConfidenceStatement(raceWeekCtx)}</p>
          {raceWeekCtx.readiness.readinessState === "fresh" ? (
            <p className="mt-2 text-xs text-emerald-400">Readiness: Fresh (TSB +{Math.round(raceWeekCtx.readiness.tsb)})</p>
          ) : null}
        </article>
      ) : dashboardMoment === "race_eve" && raceWeekCtx ? (
        <article className="rounded-xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.06)] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-400">Tomorrow is race day</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{raceWeekCtx.race.name}</h2>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.72)]">{formatRaceDistance(raceWeekCtx)}</p>
          <p className="mt-3 text-sm text-[rgba(255,255,255,0.84)]">You have done the work. Trust your training.</p>
          <div className="mt-3 space-y-1 text-xs text-[rgba(255,255,255,0.68)]">
            <p>Lay out all race gear tonight. Pin your number. Charge your watch.</p>
            <p>Eat a familiar dinner. Hydrate well. Set two alarms.</p>
          </div>
        </article>
      ) : dashboardMoment === "race_week" && raceWeekCtx ? (
        <article className="rounded-xl border border-[rgba(6,182,212,0.3)] bg-[rgba(6,182,212,0.06)] px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-400">
                {raceWeekCtx.race.name} in {raceWeekCtx.race.daysUntil} day{raceWeekCtx.race.daysUntil === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-sm text-[rgba(255,255,255,0.72)]">{raceWeekCtx.race.priority} Race · {formatRaceDistance(raceWeekCtx)}</p>
            </div>
            {raceWeekCtx.taperStatus.inTaper ? (
              <span className="rounded-full border border-[rgba(6,182,212,0.3)] bg-[rgba(6,182,212,0.1)] px-2.5 py-1 text-[11px] font-medium text-cyan-400">Taper</span>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-[rgba(255,255,255,0.84)]">{getConfidenceStatement(raceWeekCtx)}</p>
        </article>
      ) : dashboardMoment === "post_race" && raceWeekCtx ? (
        <article className="rounded-xl border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.06)] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-400">Recovery mode</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{raceWeekCtx.race.name} — completed</h2>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.72)]">{Math.abs(raceWeekCtx.race.daysUntil)} day{Math.abs(raceWeekCtx.race.daysUntil) === 1 ? "" : "s"} since race</p>
          <p className="mt-3 text-sm text-[rgba(255,255,255,0.84)]">
            {Math.abs(raceWeekCtx.race.daysUntil) <= 2
              ? "Take it easy. Walk, stretch, eat well. Your body needs rest."
              : Math.abs(raceWeekCtx.race.daysUntil) <= 4
                ? "Easy movement only if it feels good. No intensity."
                : "Easy sessions can resume. Rebuild gradually."}
          </p>
        </article>
      ) : null}

      {/* Recent Upload Card — actionable, not a text wall, stays above grid */}
      {isCurrentWeek ? (
        <Suspense fallback={<DashboardCardSkeleton />}>
          <DashboardRecentUpload supabase={supabase} userId={user.id} />
        </Suspense>
      ) : null}


      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr] lg:grid-cols-[1fr_1.6fr]">
        <article className="surface p-4 md:p-5 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">This week</p>
              {/* F20: the week pager lives inside the This Week card now, not as a
                  detached strip above the hero cards. When there's only one week the
                  pager collapses to a plain date range. */}
              {showWeekNavigator ? (
                <div className="mt-1">
                  <WeekNavigator
                    weekStart={weekStart}
                    currentWeekStart={currentWeekStart}
                    weekOptions={weekOptions}
                    blockLabel={currentBlockLabel}
                    weekNumber={currentWeekNumber}
                  />
                </div>
              ) : (
                <p className="mt-1 text-sm text-[rgba(255,255,255,0.68)]">{weekRangeLabel(weekStart)}</p>
              )}
            </div>
            {leftStatusRow ? null : (
              <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${resolvedStatusChip.className}`}>{resolvedStatusChip.label}</span>
            )}
          </div>

          {leftStatusRow ? (
            <div
              role="status"
              className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(255,180,60,0.3)] bg-[rgba(255,180,60,0.1)] px-3 py-2.5"
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--color-warning)]" />
              <p className="min-w-0 flex-1 text-sm text-white">
                <span className="font-medium">{leftStatusRow.title}</span>
                {leftStatusRow.detail ? <span className="text-[rgba(255,255,255,0.72)]"> · {leftStatusRow.detail}</span> : null}
              </p>
              <Link href={leftStatusRow.href} className="text-xs font-medium text-[var(--color-warning)] transition hover:text-white">
                {leftStatusRow.cta} →
              </Link>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="text-4xl font-semibold leading-none tracking-[-0.03em] sm:text-5xl lg:text-6xl">{completionPct}%</p>
              <p className="mt-3 text-lg font-medium leading-tight text-[rgba(255,255,255,0.94)] sm:text-xl">{toHoursAndMinutes(remainingMinutes)} left this week</p>
              <p className="mt-1 text-sm text-[rgba(255,255,255,0.74)]">{toHoursAndMinutes(totals.completed)} completed of {toHoursAndMinutes(totals.planned)} planned</p>
            </div>
          </div>

          <div className="mt-3 h-[4px] overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]" aria-hidden>
            <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${totals.planned > 0 ? (totals.completed / totals.planned) * 100 : 0}%` }} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {dailyStates.map((day) => {
              const chip = getDayChipContent(day);
              const chipSports = day.sports.slice(0, 3);
              return (
                <div key={day.iso} className={`min-h-[52px] overflow-hidden rounded-2xl border px-3 py-2 sm:min-h-[60px] ${getDayToneClass(day.tone)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[rgba(255,255,255,0.6)]">{day.label}</p>
                    {chipSports.length > 0 ? (
                      <div aria-hidden="true" className="flex items-center gap-0.5">
                        {chipSports.map((sport) => (
                          <span
                            key={sport}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: `var(--color-${sport})` }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <p className={getDayChipTitleClass(day)}>{chip.title}</p>
                  {chip.meta ? <p className="mt-0.5 truncate text-[11px] leading-tight text-[rgba(255,255,255,0.62)]">{chip.meta}</p> : null}
                </div>
              );
            })}
          </div>

          {/* F11: flatten the Completed/Remaining/Missed trio — they're redundant with
              the percentage above. One inline summary line instead. */}
          <p className="mt-3 text-xs text-[rgba(255,255,255,0.62)]">
            <span className="text-white">{toHoursAndMinutes(totals.completed)} done</span>
            <span> · {toHoursAndMinutes(remainingMinutes)} left</span>
            {missedMinutes > 0 ? <span> · {toHoursAndMinutes(missedMinutes)} missed</span> : null}
          </p>
        </article>

        <article className="surface p-4 md:p-5 lg:p-6">
          {/* F16: morning brief opens the "What matters" column. Coach-authored
              context is the first thing the user reads, before the session list. */}
          {isCurrentWeek ? (
            <Suspense fallback={null}>
              <DashboardMorningBrief supabase={supabase} userId={user.id} todayIso={todayIso} />
            </Suspense>
          ) : null}
          {pendingTodaySessions.length > 0 ? (
            <>
              <p className={`text-[11px] uppercase tracking-[0.14em] text-[rgba(255,255,255,0.68)] ${isCurrentWeek ? "mt-4" : ""}`}>Today</p>
              <h2 className="mt-2 text-xl font-semibold">What matters right now</h2>
              <p className="mt-1 text-xs text-[rgba(255,255,255,0.56)]">{pendingTodaySessions.length} remaining{` · ${completedTodaySessions.length + extraTodayActivities.length} completed`}</p>
              {todayCue ? <p className="mt-2 text-xs text-[rgba(255,255,255,0.68)]">Cue: {todayCue}</p> : null}

              <div className="mt-4 space-y-3">
                <div>
                  <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-[rgba(255,255,255,0.62)]">Remaining today</p>
                  <div className="space-y-2">
                    {pendingTodaySessions.map((session) => {
                      // Prefer the AI-classified intent category for the meta line; fall back to
                      // the planner-authored subtype (e.g. "Sweet Spot Intervals") so the row
                      // still teaches the user *what* the session is for rather than repeating
                      // the section's "Remaining" header.
                      const intentLabel =
                        (session.intent_category &&
                          SESSION_INTENT_LABELS[
                            session.intent_category as keyof typeof SESSION_INTENT_LABELS
                          ]) ||
                        session.subtype?.trim() ||
                        null;
                      return (
                        <div key={session.id} className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-2.5">
                          <p className="text-sm font-medium">{getSessionDisplayName(session)}</p>
                          <p className="text-xs text-[rgba(255,255,255,0.72)]">
                            {session.duration_minutes} min{session.is_key ? " • Key" : ""}{intentLabel ? ` • ${intentLabel}` : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {completedTodaySessions.length > 0 || extraTodayActivities.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-[rgba(255,255,255,0.62)]">Completed today</p>
                    <div className="space-y-2">
                      {completedTodaySessions.map((session) => (
                        <div key={session.id} className="rounded-xl border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.08)] px-3 py-2.5">
                          <p className="text-sm font-medium">{getSessionDisplayName(session)}</p>
                          <p className="text-xs text-[rgba(255,255,255,0.72)]">{getCompletedMinutes(session)} min • Done</p>
                        </div>
                      ))}
                      {extraTodayActivities.map((activity) => (
                        <Link key={activity.id} href={`/sessions/activity/${activity.id}`} className="block rounded-xl border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.08)] px-3 py-2.5 transition hover:border-[hsl(var(--success)/0.5)]">
                          <p className="text-sm font-medium">{getDisciplineMeta(activity.sport).label} extra workout</p>
                          <p className="text-xs text-[rgba(255,255,255,0.72)]">{activity.durationMinutes} min • Done</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 space-y-2">
                {nextPendingTodaySession ? (
                  <Link href={`/calendar?focus=${nextPendingTodaySession.id}`} className="btn-primary w-full text-sm">
                    Open session
                  </Link>
                ) : null}
                <Link href="/calendar" className="block text-center text-[12px] text-tertiary transition hover:text-white">
                  or view the full plan
                </Link>
              </div>

              {contextualItems.length > 0 ? (
                <div className="mt-4 space-y-2 border-t border-[rgba(255,255,255,0.07)] pt-4">
                  {contextualItems.map((item) => (
                    <div key={item.kicker} className={`rounded-xl border px-3 py-2.5 ${item.kicker.toLowerCase() === "needs attention" ? "border-[rgba(255,90,40,0.28)] bg-[rgba(255,90,40,0.06)]" : "border-[rgba(190,255,0,0.14)] bg-[rgba(190,255,0,0.04)]"}`}>
                      <p className={`text-[10px] font-medium uppercase tracking-[0.12em] ${kickerClassName(item.kicker)}`}>{item.kicker}</p>
                      <p className="mt-1 text-sm font-medium text-white">{item.title}</p>
                      <p className="mt-0.5 text-xs text-[rgba(255,255,255,0.68)]">{item.detail}</p>
                      <Link href={item.href} className={`mt-2 inline-flex ${item.ctaStyle === "primary" ? "btn-primary" : "btn-secondary"} px-3 text-[11px]`}>{item.cta}</Link>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : completedTodaySessions.length > 0 || extraTodayActivities.length > 0 ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.14em] text-[rgba(255,255,255,0.68)]">Today</p>
              <h2 className="mt-2 text-xl font-semibold">Today is done</h2>
              <p className="mt-1 text-xs text-[rgba(255,255,255,0.56)]">0 remaining · {completedTodaySessions.length + extraTodayActivities.length} completed</p>
              <div className="mt-4 space-y-1">
                <h3 className="text-sm font-medium text-[rgba(255,255,255,0.72)]">Up next</h3>
                <p className="text-2xl font-semibold leading-tight text-white">{nextImportantSession ? getSessionDisplayName(nextImportantSession) : "Next planned session"}</p>
                {nextImportantSession ? <p className="text-sm text-[rgba(255,255,255,0.64)]">{getUpcomingSessionMeta(nextImportantSession)}</p> : null}
              </div>

              <div className="mt-4 space-y-2">
                <Link
                  href={nextImportantSession ? `/calendar?focus=${nextImportantSession.id}` : "/calendar"}
                  className="btn-primary w-full text-sm"
                >
                  {nextImportantSession ? `Prepare ${getSessionDisplayName(nextImportantSession)}` : "Open weekly plan"}
                </Link>
                <Link
                  href={
                    completedTodaySessions[0]
                      ? `/sessions/${completedTodaySessions[0].id}`
                      : extraTodayActivities[0]
                        ? `/sessions/activity/${extraTodayActivities[0].id}`
                        : "/calendar"
                  }
                  className="block text-center text-[12px] text-tertiary transition hover:text-white"
                >
                  or review today&rsquo;s work
                </Link>
              </div>

              {contextualItems.length > 0 ? (
                <div className="mt-4 space-y-2 border-t border-[rgba(255,255,255,0.07)] pt-4">
                  {contextualItems.map((item) => (
                    <div key={item.kicker} className={`rounded-xl border px-3 py-2.5 ${item.kicker.toLowerCase() === "needs attention" ? "border-[rgba(255,90,40,0.28)] bg-[rgba(255,90,40,0.06)]" : "border-[rgba(190,255,0,0.14)] bg-[rgba(190,255,0,0.04)]"}`}>
                      <p className={`text-[10px] font-medium uppercase tracking-[0.12em] ${kickerClassName(item.kicker)}`}>{item.kicker}</p>
                      <p className="mt-1 text-sm font-medium text-white">{item.title}</p>
                      <p className="mt-0.5 text-xs text-[rgba(255,255,255,0.68)]">{item.detail}</p>
                      <Link href={item.href} className={`mt-2 inline-flex ${item.ctaStyle === "primary" ? "btn-primary" : "btn-secondary"} px-3 text-[11px]`}>{item.cta}</Link>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-[0.14em] text-[rgba(255,255,255,0.68)]">Today</p>
              <h2 className="mt-2 text-xl font-semibold">No sessions scheduled</h2>
              <p className="mt-2 text-sm text-[rgba(255,255,255,0.74)]">Use today for recovery and reset, then protect the next planned key session.</p>
              <div className="mt-4">
                <Link href="/calendar" className="btn-secondary px-3 text-xs">View plan</Link>
              </div>

              {contextualItems.length > 0 ? (
                <div className="mt-4 space-y-2 border-t border-[rgba(255,255,255,0.07)] pt-4">
                  {contextualItems.map((item) => (
                    <div key={item.kicker} className={`rounded-xl border px-3 py-2.5 ${item.kicker.toLowerCase() === "needs attention" ? "border-[rgba(255,90,40,0.28)] bg-[rgba(255,90,40,0.06)]" : "border-[rgba(190,255,0,0.14)] bg-[rgba(190,255,0,0.04)]"}`}>
                      <p className={`text-[10px] font-medium uppercase tracking-[0.12em] ${kickerClassName(item.kicker)}`}>{item.kicker}</p>
                      <p className="mt-1 text-sm font-medium text-white">{item.title}</p>
                      <p className="mt-0.5 text-xs text-[rgba(255,255,255,0.68)]">{item.detail}</p>
                      <Link href={item.href} className={`mt-2 inline-flex ${item.ctaStyle === "primary" ? "btn-primary" : "btn-secondary"} px-3 text-[11px]`}>{item.cta}</Link>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </article>
      </div>

      {/* Narrative cards — collapsed by default so the grid stays above the fold
          (Morning Brief moved inside the What Matters column header — see F16.) */}

      {/* Transition Briefing / Monday Unified Flow */}
      {showTransitionBriefing ? (
        dashboardMoment === "monday_transition" ? (
          <Suspense fallback={<DashboardCardSkeleton />}>
            <DashboardMondayTransition supabase={supabase} userId={user.id} weekStart={weekStart} todayIso={todayIso} />
          </Suspense>
        ) : (
          <Suspense fallback={<DashboardCardSkeleton />}>
            <DashboardTransitionBriefing supabase={supabase} userId={user.id} weekStart={weekStart} />
          </Suspense>
        )
      ) : null}

      {/* Context-aware section: end_of_week promotes debrief before week ahead */}
      {dashboardMoment === "end_of_week" ? (
        <>
          <Suspense fallback={<DashboardCardSkeleton />}>
            <DashboardDebrief supabase={supabase} userId={user.id} weekStart={weekStart} timeZone={timeZone} todayIso={todayIso} />
          </Suspense>
          {showWeekAheadCard ? (
            <Suspense fallback={<DashboardCardSkeleton />}>
              <DashboardWeekAhead supabase={supabase} userId={user.id} weekStart={weekStart} />
            </Suspense>
          ) : null}
        </>
      ) : (
        <>
          {showWeekAheadCard ? (
            <Suspense fallback={<DashboardCardSkeleton />}>
              <DashboardWeekAhead supabase={supabase} userId={user.id} weekStart={weekStart} />
            </Suspense>
          ) : null}
          <Suspense fallback={<DashboardCardSkeleton />}>
            <DashboardDebrief supabase={supabase} userId={user.id} weekStart={weekStart} timeZone={timeZone} todayIso={todayIso} />
          </Suspense>
        </>
      )}

      {/* Readiness (at-a-glance) → Training Score + Balance */}
      {isCurrentWeek ? (
        <>
          <Suspense fallback={<DashboardCardSkeleton />}>
            <DashboardReadiness supabase={supabase} userId={user.id} />
          </Suspense>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Suspense fallback={<DashboardCardSkeleton />}>
              <DashboardTrainingScore supabase={supabase} userId={user.id} todayIso={todayIso} />
            </Suspense>
            <Suspense fallback={<DashboardCardSkeleton />}>
              <DashboardDisciplineBalance supabase={supabase} userId={user.id} weekStart={weekStart} />
            </Suspense>
          </div>
        </>
      ) : null}

      <Suspense fallback={<DashboardCardSkeleton />}>
        <DashboardTrends supabase={supabase} userId={user.id} />
      </Suspense>
    </section>
  );
}

// ── Suspense-streamed async components ───────────────────────────────────

async function DashboardDebrief(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  weekStart: string;
  timeZone: string;
  todayIso: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart, timeZone, todayIso } = props;
  const snapshot = await getWeeklyDebriefSnapshot({ supabase, athleteId: userId, weekStart, timeZone, todayIso });
  if (!snapshot) return null;
  return <WeeklyDebriefCard snapshot={snapshot} />;
}

async function DashboardTrends(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId } = props;
  let trends: Awaited<ReturnType<typeof detectTrends>> = [];
  let fatigueSignal: FatigueSignal | null = null;
  try {
    [trends, fatigueSignal] = await Promise.all([
      detectTrends(supabase, userId),
      detectCrossDisciplineFatigue(supabase, userId).catch(() => null)
    ]);
  } catch {
    return null;
  }
  if (trends.length === 0 && !fatigueSignal) return null;
  return <TrendCards trends={trends} fatigueSignal={fatigueSignal} />;
}

async function DashboardMondayTransition(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  weekStart: string;
  todayIso: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart, todayIso } = props;
  try {
    const briefing = await generateWeekTransitionBriefing(supabase, userId, weekStart);
    if (!briefing || briefing.dismissedAt) return null;

    // Fetch morning brief for "today" section
    let morningBrief: MorningBrief | null = null;
    try {
      morningBrief = await getOrGenerateMorningBrief(supabase, userId, todayIso);
    } catch {
      // Non-critical
    }

    // Fetch debrief summary for "last week" enrichment
    let debriefSummary: string | null = null;
    const prevWeekStart = addDays(weekStart, -7);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      const snapshot = await getWeeklyDebriefSnapshot({ supabase, athleteId: userId, weekStart: prevWeekStart, timeZone, todayIso });
      if (snapshot?.artifact?.narrative?.executiveSummary) {
        debriefSummary = snapshot.artifact.narrative.executiveSummary;
      }
    } catch {
      // Non-critical
    }

    // Count pending rationales
    const { count } = await supabase
      .from("adaptation_rationales")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending");

    return (
      <MondayTransitionFlow
        briefing={briefing}
        morningBrief={morningBrief}
        debriefSummary={debriefSummary}
        pendingRationaleCount={count ?? 0}
        weekStart={prevWeekStart}
      />
    );
  } catch {
    return null;
  }
}

async function DashboardWeekAhead(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  weekStart: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart } = props;
  try {
    const { getMacroContext } = await import("@/lib/training/macro-context");
    const { generateWeekPreview } = await import("@/lib/training/week-preview");
    const nextWeekStart = addDays(weekStart, 7);
    const macroCtx = await getMacroContext(supabase, userId);
    const preview = await generateWeekPreview(supabase, userId, nextWeekStart, macroCtx);
    if (!preview) return null;
    return <WeekAheadCard preview={preview} />;
  } catch {
    return null;
  }
}

async function DashboardTransitionBriefing(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  weekStart: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart } = props;
  try {
    const briefing = await generateWeekTransitionBriefing(supabase, userId, weekStart);
    if (briefing.dismissedAt) return null;
    return <TransitionBriefingCard briefing={briefing} />;
  } catch {
    return null;
  }
}

async function DashboardRecentUpload(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId } = props;
  try {
    // Find recently-synced activities (last 4 hours) that haven't been reviewed via feel capture
    const { data: recentActivity } = await supabase
      .from("completed_activities")
      .select("id,sport_type,duration_sec")
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 4 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!recentActivity) return null;

    // Check if there's a linked session
    const { data: link } = await supabase
      .from("session_activity_links")
      .select("planned_session_id")
      .eq("completed_activity_id", recentActivity.id)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!link?.planned_session_id) return null;

    // Check if feel already captured
    const { data: existingFeel } = await supabase
      .from("session_feels")
      .select("id")
      .eq("session_id", link.planned_session_id)
      .limit(1)
      .maybeSingle();

    if (existingFeel) return null;

    // Get session details
    const { data: session } = await supabase
      .from("sessions")
      .select("id,session_name,type,sport")
      .eq("id", link.planned_session_id)
      .maybeSingle();

    if (!session) return null;

    const durationMinutes = recentActivity.duration_sec ? Math.round(recentActivity.duration_sec / 60) : 0;
    return (
      <RecentUploadCard
        sessionId={session.id}
        sessionName={session.session_name ?? session.type}
        sport={session.sport}
        durationMinutes={durationMinutes}
      />
    );
  } catch {
    return null;
  }
}

async function DashboardMorningBrief(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  todayIso: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, todayIso } = props;
  try {
    const brief = await getOrGenerateMorningBrief(supabase, userId, todayIso);
    return <MorningBriefCard brief={brief} />;
  } catch {
    return null;
  }
}

async function DashboardTrainingScore(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  todayIso: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, todayIso } = props;
  try {
    const score = await getOrComputeTrainingScore(supabase, userId, todayIso);
    return <TrainingScoreCard score={score} />;
  } catch {
    return null;
  }
}

async function DashboardReadiness(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId } = props;
  try {
    const [fitness, tsbTrend, fatigue] = await Promise.all([
      getLatestFitness(supabase, userId),
      getTsbTrend(supabase, userId),
      detectCrossDisciplineFatigue(supabase, userId).catch(() => null)
    ]);
    if (!fitness?.total) return null;
    const readiness = getReadinessState(fitness.total.tsb, tsbTrend);
    const signalContext = fatigue?.sports && fatigue.sports.length >= 2
      ? `${fatigue.sports.join(" + ")} trending down, expect heavier legs`
      : readiness === "fatigued" || readiness === "overreaching"
        ? "Hold the key session but keep easy days truly easy"
        : null;
    return (
      <ReadinessIndicator
        readiness={readiness}
        tsb={fitness.total.tsb}
        tsbTrend={tsbTrend}
        signalContext={signalContext}
      />
    );
  } catch {
    return null;
  }
}

async function DashboardDisciplineBalance(props: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  weekStart: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart } = props;
  try {
    const balance = await computeWeeklyDisciplineBalance(supabase, userId, weekStart);
    const imbalances = detectDisciplineImbalance(balance);
    // Only show if there's actual data
    if (balance.totalActualTss === 0 && balance.totalPlannedTss === 0) return null;
    return <DisciplineBalanceCompact balance={balance} imbalances={imbalances} />;
  } catch {
    return null;
  }
}
