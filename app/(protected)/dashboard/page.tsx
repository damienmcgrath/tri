import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { computeWeekMinuteTotals } from "@/lib/training/week-metrics";
import { addDays, getMonday, weekRangeLabel } from "../week-context";

type Session = {
  id: string;
  plan_id: string;
  date: string;
  sport: string;
  type: string;
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
  if (completionPct >= expectedByTodayPct + 8) {
    return { label: "On track", className: "signal-ready" };
  }

  if (completionPct < expectedByTodayPct - 20) {
    return { label: "At risk", className: "signal-risk" };
  }

  return { label: "Slightly behind", className: "signal-load" };
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
      .select("id,plan_id,date,sport,type,duration_minutes,notes,created_at,status,is_key")
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
  const remainingSessionsCount = sessions.filter((session) => session.status === "planned").length;
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
    const completedCount = daySessions.filter((session) => session.status === "completed" || session.status === "skipped").length;
    const hasSessions = daySessions.length > 0;

    const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));

    let tone: "none" | "scheduled" | "completed" | "missed" | "today" = "none";
    if (iso === todayIso && hasSessions) {
      tone = "today";
    } else if (!hasSessions) {
      tone = "none";
    } else if (plannedCount > 0 && iso < todayIso) {
      tone = "missed";
    } else if (plannedCount === 0 && completedCount > 0) {
      tone = "completed";
    } else {
      tone = "scheduled";
    }

    return { iso, label, hasSessions, plannedCount, completedCount, tone };
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

  const attentionItem = overdueKeySession
    ? {
        title: `Missed key session: ${overdueKeySession.type}`,
        detail: "This was a key planned session. Missing it shifts too much load into the weekend.",
        cta: "Reschedule key session",
        href: `/calendar?focus=${overdueKeySession.id}`
      }
    : behindByMinutes >= 30
      ? {
          title: "You are behind this week",
          detail: `${toHoursAndMinutes(behindByMinutes)} behind expected progress for today based on your planned week.`,
          cta: "Open weekly plan",
          href: "/calendar"
        }
      : missedSessionsCount > 0
        ? {
            title: `${missedSessionsCount} missed session${missedSessionsCount > 1 ? "s" : ""}`,
            detail: `${toHoursAndMinutes(missedMinutes)} is still uncompleted from earlier this week.`,
            cta: "Review missed work",
            href: "/calendar"
          }
        : null;

  const focusItem = biggestGap && biggestGap.gap >= 20
    ? {
        title: `Protect ${biggestGap.label.toLowerCase()} consistency`,
        detail: `You are ${biggestGap.gap} min behind planned ${biggestGap.label.toLowerCase()} time. Best recovery path: complete the next planned ${biggestGap.label.toLowerCase()} session without changing weekend load.`,
        cta: `Open next ${biggestGap.label.toLowerCase()} session`,
        href: "/calendar"
      }
    : null;

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
              const toneClass = day.tone === "today"
                ? "border-[hsl(var(--accent-performance)/0.65)] bg-[hsl(var(--accent-performance)/0.16)]"
                : day.tone === "completed"
                  ? "border-[hsl(var(--success)/0.45)] bg-[hsl(var(--success)/0.12)]"
                  : day.tone === "missed"
                    ? "border-[hsl(var(--danger)/0.45)] bg-[hsl(var(--danger)/0.12)]"
                    : day.tone === "scheduled"
                      ? "border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]"
                      : "border-[hsl(var(--border)/0.6)] bg-transparent";

              const toneLabel = day.tone === "today"
                ? "Today"
                : day.tone === "completed"
                  ? "Done"
                  : day.tone === "missed"
                    ? "Missed"
                    : day.tone === "scheduled"
                      ? "Planned"
                      : "Rest";

              return (
                <div key={day.iso} className={`rounded-lg border px-2 py-2 ${toneClass}`}>
                  <p className="text-[11px] font-semibold">{day.label}</p>
                  <p className="mt-1 text-[10px] text-muted">{toneLabel}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
            <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-2">Completed <span className="block text-base font-semibold">{toHoursAndMinutes(totals.completed)}</span></p>
            <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-2">Remaining <span className="block text-base font-semibold">{toHoursAndMinutes(remainingMinutes)}</span></p>
            <p className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-2">Missed <span className="block text-base font-semibold">{toHoursAndMinutes(missedMinutes)}</span></p>
          </div>
        </article>

        <article className="surface p-5 md:p-6">
          {pendingTodaySessions.length > 0 ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Today</p>
              <h2 className="mt-2 text-xl font-semibold">{pendingTodaySessions.length} scheduled session{pendingTodaySessions.length > 1 ? "s" : ""} to complete</h2>

              <div className="mt-4 space-y-2">
                {todaySessions.map((session) => (
                  <div key={session.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-2">
                    <p className="text-sm font-medium">{session.type}</p>
                    <p className="text-xs text-muted">{getDisciplineMeta(session.sport).label} • {session.duration_minutes} min{session.is_key ? " • Key session" : ""}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {nextPendingTodaySession ? <Link href={`/calendar?focus=${nextPendingTodaySession.id}`} className="btn-primary px-3 py-1.5 text-xs">Open session</Link> : null}
                <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">View plan</Link>
              </div>
            </>
          ) : completedTodaySessions.length > 0 ? (
            <>
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Today complete</p>
              <h2 className="mt-2 text-xl font-semibold">{toHoursAndMinutes(completedTodaySessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0))} done</h2>
              <p className="mt-2 text-sm text-muted">You completed all scheduled sessions for today and you are {statusChip.label === "On track" ? "on track" : "still in reach"} this week.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/calendar" className="btn-primary px-3 py-1.5 text-xs">Review completed sessions</Link>
                <Link href="/plan" className="btn-secondary px-3 py-1.5 text-xs">Open plan</Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Today</p>
              <h2 className="mt-2 text-xl font-semibold">No sessions scheduled today</h2>
              <p className="mt-2 text-sm text-muted">This is a planned rest or flex day. No action required on dashboard today.</p>
              <div className="mt-4">
                <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">View plan</Link>
              </div>
            </>
          )}
        </article>
      </div>

      {(attentionItem || focusItem) ? (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          {attentionItem ? (
            <article className="surface p-5 md:p-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Needs attention</p>
              <h3 className="mt-2 text-lg font-semibold">{attentionItem.title}</h3>
              <p className="mt-2 text-sm text-muted">{attentionItem.detail}</p>
              <div className="mt-4">
                <Link href={attentionItem.href} className="btn-primary px-3 py-1.5 text-xs">{attentionItem.cta}</Link>
              </div>
            </article>
          ) : <div />}

          {focusItem ? (
            <article className="surface p-5 md:p-6">
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Focus this week</p>
              <h3 className="mt-2 text-lg font-semibold">{focusItem.title}</h3>
              <p className="mt-2 text-sm text-muted">{focusItem.detail}</p>
              <div className="mt-4">
                <Link href={focusItem.href} className="btn-secondary px-3 py-1.5 text-xs">{focusItem.cta}</Link>
              </div>
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
