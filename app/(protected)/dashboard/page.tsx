import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { getSessionDisplayName } from "@/lib/training/session";
import { computeWeekMinuteTotals } from "@/lib/training/week-metrics";
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
  sport_type: string;
  start_time_utc: string;
  duration_sec: number;
  schedule_status: "scheduled" | "unscheduled";
  is_unplanned: boolean | null;
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

function toHoursAndMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}h ${mins}m`;
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

function weekdayName(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00.000Z`));
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
  const todayIso = new Date().toISOString().slice(0, 10);

  const [{ data: profileData }, { data: plansData }, { data: completedData }, { data: completedActivities }, { data: linksData }] = await Promise.all([
    supabase.from("profiles").select("active_plan_id,race_date,race_name").eq("id", user.id).maybeSingle(),
    supabase.from("training_plans").select("id").order("start_date", { ascending: false }),
    supabase.from("completed_sessions").select("date,sport").gte("date", weekStart).lt("date", weekEnd),
    supabase
      .from("completed_activities")
      .select("id,sport_type,start_time_utc,duration_sec,schedule_status,is_unplanned")
      .eq("user_id", user.id)
      .gte("start_time_utc", `${weekStart}T00:00:00.000Z`)
      .lt("start_time_utc", `${weekEnd}T00:00:00.000Z`),
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
      .eq("plan_id", activePlanId)
      .gte("date", weekStart)
      .lt("date", weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });

    if (primary.error && /(is_key|42703|schema cache)/i.test(primary.error.message ?? "")) {
      const fallback = await supabase
        .from("sessions")
        .select("id,plan_id,date,sport,type,duration_minutes,notes,created_at,status")
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

  const uploadedActivities = (completedActivities ?? []) as CompletedActivity[];
  const links = (linksData ?? []) as Array<{ completed_activity_id: string; planned_session_id?: string | null; confirmation_status?: "suggested" | "confirmed" | "rejected" | null }>;
  const confirmedLinks = links.filter((item) => item.confirmation_status === "confirmed" || !item.confirmation_status);
  const linkedSessionIds = new Set(confirmedLinks.map((item) => item.planned_session_id).filter((value): value is string => Boolean(value)));

  const durationByActivityId = new Map(uploadedActivities.map((activity) => [activity.id, Math.round((activity.duration_sec ?? 0) / 60)]));
  const linkedMinutesBySession = confirmedLinks.reduce<Map<string, number>>((acc, link) => {
    if (!link.planned_session_id) return acc;
    const minutes = durationByActivityId.get(link.completed_activity_id) ?? 0;
    acc.set(link.planned_session_id, (acc.get(link.planned_session_id) ?? 0) + minutes);
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
  const nextPendingTodaySession = pendingTodaySessions[0] ?? null;
  const todayCompletedMinutes = completedTodaySessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);

  const weekMetricSessions = sessions.map((session) => ({
    id: session.id,
    date: session.date,
    sport: session.sport,
    durationMinutes: session.duration_minutes ?? 0,
    status: session.status,
    isKey: session.is_key
  }));

  const minuteMetrics = computeWeekMinuteTotals(weekMetricSessions);
  const totals = { planned: minuteMetrics.plannedMinutes, completed: minuteMetrics.completedMinutes };
  const completedSessionsCount = sessions.filter((session) => session.status === "completed").length;
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
    const remainingMinutesOnDay = daySessions.filter((session) => session.status === "planned").reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
    const completedMinutesOnDay = daySessions.filter((session) => session.status === "completed").reduce((sum, session) => sum + getCompletedMinutes(session), 0);
    const trainingMeaning = getDayMeaningLabel(daySessions);

    const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));

    let tone: "rest" | "upcoming" | "today-remaining" | "today-complete" | "completed" | "missed" = "rest";
    let stateLabel = "Rest";
    let microLabel = "Rest";

    if (iso === todayIso) {
      if (plannedCount > 0) {
        tone = "today-remaining";
        stateLabel = "Today";
        microLabel = `${remainingMinutesOnDay}m left`;
      } else if (daySessions.length > 0) {
        tone = "today-complete";
        stateLabel = "Completed";
        microLabel = `${completedMinutesOnDay}m done`;
      }
    } else if (iso < todayIso) {
      if (plannedCount > 0) {
        tone = "missed";
        stateLabel = "Missed";
        microLabel = `${remainingMinutesOnDay || plannedMinutes}m missed`;
      } else if (daySessions.length > 0) {
        tone = "completed";
        stateLabel = "Completed";
        microLabel = `${completedMinutesOnDay || plannedMinutes}m done`;
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
    : behindByMinutes >= 30
      ? {
          kicker: "Needs attention",
          title: "You are behind this week",
          detail: `${toHoursAndMinutes(behindByMinutes)} behind expected progress for today based on your planned time.`,
          cta: "Open weekly plan",
          href: "/calendar",
          ctaStyle: "primary"
        }
      : missedSessionsCount > 0
        ? {
            kicker: "Needs attention",
            title: `${missedSessionsCount} missed session${missedSessionsCount > 1 ? "s" : ""}`,
            detail: `${toHoursAndMinutes(missedMinutes)} is still uncompleted from earlier this week.`,
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
          ? `You are ${biggestGap.gap} min behind planned ${biggestGap.label.toLowerCase()} time. Best recovery path: complete ${weekdayName(nextGapSession.date)} ${getDisciplineMeta(nextGapSession.sport).label.toLowerCase()} and keep weekend load unchanged.`
          : `You are ${biggestGap.gap} min behind planned ${biggestGap.label.toLowerCase()} time. Best recovery path: complete the next planned ${biggestGap.label.toLowerCase()} workout and keep weekend load unchanged.`,
        cta: nextGapSession
          ? `Open ${weekdayName(nextGapSession.date)} ${getDisciplineMeta(nextGapSession.sport).label.toLowerCase()}`
          : `Open next ${biggestGap.label.toLowerCase()} workout`,
        href: nextGapSession ? `/calendar?focus=${nextGapSession.id}` : "/calendar",
        ctaStyle: "secondary"
      }
    : null;

  const contextualItems = [attentionItem, focusItem].filter((item): item is ContextualItem => Boolean(item));

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

  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <article className="surface p-5 md:p-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent">This week</p>
          <p className="mt-1 text-sm text-muted">Week of {weekRangeLabel(weekStart)}</p>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-5xl font-semibold leading-none">{completionPct}%</p>
              <p className="mt-2 text-base font-medium">{toHoursAndMinutes(totals.completed)} / {toHoursAndMinutes(totals.planned)}</p>
              <p className="mt-1 text-sm text-muted">{completedSessionsCount} / {sessions.length} sessions completed</p>
            </div>
            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusChip.className}`}>{statusChip.label}</span>
          </div>

          <div className="mt-5 grid grid-cols-7 gap-2">
            {dailyStates.map((day) => {
              const toneClass = day.tone === "today-remaining"
                ? "border-[hsl(var(--accent-performance)/0.72)] bg-[hsl(var(--accent-performance)/0.18)]"
                : day.tone === "today-complete"
                  ? "border-[hsl(var(--success)/0.52)] bg-[hsl(var(--success)/0.16)]"
                  : day.tone === "completed"
                    ? "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.07)]"
                    : day.tone === "missed"
                      ? "border-[hsl(var(--danger)/0.4)] bg-[hsl(var(--danger)/0.1)]"
                      : day.tone === "upcoming"
                        ? "border-[hsl(var(--border))] bg-[hsl(var(--surface-2)/0.68)]"
                        : "border-transparent bg-transparent opacity-70";

              return (
                <div key={day.iso} className={`rounded-lg border px-2 py-1.5 ${toneClass}`}>
                  <p className="text-[10px] font-medium uppercase tracking-[0.04em] text-[hsl(var(--fg-muted))]">{day.label}</p>
                  <p className="mt-0.5 text-[11px] font-semibold leading-tight">{day.stateLabel}</p>
                  {day.microLabel ? <p className="mt-0.5 text-[10px] text-[hsl(var(--fg-muted))]">{day.microLabel}</p> : null}
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-[hsl(var(--border)/0.7)] pt-3 text-sm">
            <p className="px-1">Completed <span className="mt-0.5 block text-sm font-semibold">{toHoursAndMinutes(totals.completed)}</span></p>
            <p className="px-1">Remaining <span className="mt-0.5 block text-sm font-semibold">{toHoursAndMinutes(remainingMinutes)}</span></p>
            <p className="px-1">Missed <span className="mt-0.5 block text-sm font-semibold">{toHoursAndMinutes(missedMinutes)}</span></p>
          </div>
        </article>

        <article className="surface p-5 md:p-6">
          {pendingTodaySessions.length > 0 ? (
            <>
              <h2 className="text-xl font-semibold">Today</h2>
              <p className="mt-1 text-sm text-muted">{pendingTodaySessions.length} remaining{` · ${completedTodaySessions.length} completed`}</p>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--fg-muted))]">Remaining today</p>
                  <div className="space-y-2">
                    {pendingTodaySessions.map((session) => (
                      <div key={session.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-2">
                        <p className="text-sm font-medium">{getSessionDisplayName(session)}</p>
                        <p className="text-xs text-muted">{session.duration_minutes} min{session.is_key ? " • Key" : ""} • Remaining</p>
                      </div>
                    ))}
                  </div>
                </div>

                {completedTodaySessions.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--fg-muted))]">Completed today</p>
                    <div className="space-y-2">
                      {completedTodaySessions.map((session) => (
                        <div key={session.id} className="rounded-lg border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.08)] px-3 py-2">
                          <p className="text-sm font-medium">{getSessionDisplayName(session)}</p>
                          <p className="text-xs text-muted">{session.duration_minutes} min • Done</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {nextPendingTodaySession ? <Link href={`/calendar?focus=${nextPendingTodaySession.id}`} className="btn-primary px-3 py-1.5 text-xs">Open session</Link> : null}
                <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">View plan</Link>
              </div>
            </>
          ) : completedTodaySessions.length > 0 ? (
            <>
              <h2 className="text-xl font-semibold">Today</h2>
              <p className="mt-1 text-sm text-muted">0 remaining · {completedTodaySessions.length} completed</p>
              <h3 className="mt-2 text-lg font-semibold">{toHoursAndMinutes(todayCompletedMinutes)} done</h3>
              <p className="mt-2 text-sm text-muted">All scheduled sessions for today are complete. You are {statusChip.label === "On track" ? "on track" : "still in reach"} this week.</p>
              <div className="mt-4 space-y-2">
                {completedTodaySessions.map((session) => (
                  <div key={session.id} className="rounded-lg border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.08)] px-3 py-2">
                    <p className="text-sm font-medium">{getSessionDisplayName(session)}</p>
                    <p className="text-xs text-muted">{session.duration_minutes} min • Done</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/calendar" className="btn-primary px-3 py-1.5 text-xs">Review completed sessions</Link>
                <Link href="/plan" className="btn-secondary px-3 py-1.5 text-xs">Open plan</Link>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">Today</h2>
              <p className="mt-1 text-sm text-muted">No sessions scheduled</p>
              <h3 className="mt-2 text-lg font-semibold">No sessions scheduled today</h3>
              <p className="mt-2 text-sm text-muted">Use today for recovery.</p>
              <div className="mt-4">
                <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">View plan</Link>
              </div>
            </>
          )}
        </article>
      </div>

      {contextualItems.length === 1 ? (
        <article className="surface p-5 md:p-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent">{contextualItems[0].kicker}</p>
          <h3 className="mt-2 text-lg font-semibold">{contextualItems[0].title}</h3>
          <p className="mt-2 text-sm text-muted">{contextualItems[0].detail}</p>
          <div className="mt-4">
            <Link href={contextualItems[0].href} className={`${contextualItems[0].ctaStyle === "primary" ? "btn-primary" : "btn-secondary"} px-3 py-1.5 text-xs`}>{contextualItems[0].cta}</Link>
          </div>
        </article>
      ) : null}

      {contextualItems.length === 2 ? (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          {contextualItems.map((item) => (
            <article key={item.kicker} className="surface p-5 md:p-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">{item.kicker}</p>
              <h3 className="mt-2 text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted">{item.detail}</p>
              <div className="mt-4">
                <Link href={item.href} className={`${item.ctaStyle === "primary" ? "btn-primary" : "btn-secondary"} px-3 py-1.5 text-xs`}>{item.cta}</Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
