import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { WeekProgressCard } from "./week-progress-card";
import { ProgressGlanceCard } from "./progress-glance-card";
import { computeWeekMinuteTotals } from "@/lib/training/week-metrics";
import { getWhyTodayMattersCopy, NEXT_ACTION_STATE } from "./next-action-copy";
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

const sports = ["swim", "bike", "run", "strength"] as const;

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
  const linkedActivityIds = new Set(confirmedLinks.map((item) => item.completed_activity_id));
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
    is_key: Boolean((session as any).is_key)
  }));

  const hasActivePlan = Boolean(activePlanId);
  const todaySessions = sessions.filter((session) => session.date === todayIso);
  const nextPendingTodaySession = todaySessions.find((session) => session.status === "planned") ?? null;
  const completedTodaySessions = todaySessions.filter((session) => session.status === "completed");

  const weekMetricSessions = sessions.map((session) => ({
    id: session.id,
    date: session.date,
    sport: session.sport,
    durationMinutes: session.duration_minutes ?? 0,
    status: session.status,
    isKey: session.is_key
  }));

  const minuteMetrics = computeWeekMinuteTotals(weekMetricSessions);
  const missedPlannedSessions = sessions.filter((session) => session.status === "planned").length;
  const extraActivities = uploadedActivities.filter((activity) => (activity.schedule_status === "unscheduled" || !linkedActivityIds.has(activity.id)) && !activity.is_unplanned);
  const unmatchedExtraSessions = extraActivities.length;
  const extraMinutesTotal = extraActivities.reduce((sum, activity) => sum + Math.round((activity.duration_sec ?? 0) / 60), 0);
  const totals = { planned: minuteMetrics.plannedMinutes, completed: minuteMetrics.completedMinutes };

  const progressBySport = sports.map((sport) => {
    const planned = sessions.filter((session) => session.sport === sport).reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
    const completed = sessions
      .filter((session) => session.sport === sport)
      .reduce((sum, session) => sum + getCompletedMinutes(session), 0);
    const extraMinutes = extraActivities
      .filter((activity) => activity.sport_type === sport)
      .reduce((sum, activity) => sum + Math.round((activity.duration_sec ?? 0) / 60), 0);

    return {
      sport,
      planned,
      completed,
      extraMinutes,
      label: getDisciplineMeta(sport).label,
      color:
        sport === "swim"
          ? "#56B6D9"
          : sport === "bike"
            ? "#6BAA75"
            : sport === "run"
              ? "#C48772"
              : "#9A86C8"
    };
  }).sort((a, b) => (b.planned - b.completed) - (a.planned - a.completed));

  const biggestGap = [...progressBySport].sort((a, b) => b.planned - b.completed - (a.planned - a.completed))[0];

  const completionPct = totals.planned > 0 ? Math.round((totals.completed / totals.planned) * 100) : 0;
  const remainingMinutes = Math.max(totals.planned - totals.completed, 0);
  const marginPct = 10;
  const dayIndex = Math.floor((Date.parse(`${todayIso}T00:00:00.000Z`) - Date.parse(`${weekStart}T00:00:00.000Z`)) / 86_400_000);
  const elapsedDays = Math.max(0, Math.min(dayIndex + 1, 7));
  const expectedByTodayPct = Math.round((elapsedDays / 7) * 100);
  const progressStatus = completionPct > expectedByTodayPct + marginPct
    ? "Ahead"
    : completionPct < expectedByTodayPct - marginPct
      ? "Behind plan"
      : "On track";
  const overdueKeySession = sessions
    .filter((session) => session.is_key && session.status === "planned" && session.date < todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const hasGapSuggestion = Boolean(biggestGap && biggestGap.planned > biggestGap.completed);
  const weeklyFocusText = biggestGap && biggestGap.planned > biggestGap.completed
    ? `Close your ${biggestGap.label} gap (+${biggestGap.planned - biggestGap.completed}m) by adding 2 × 30–45m easy ${biggestGap.label.toLowerCase()} sessions.`
    : "Protect consistency this week with short, low-friction sessions on open days.";

  const nextActionState = nextPendingTodaySession
    ? NEXT_ACTION_STATE.SESSION_TODAY
    : overdueKeySession
      ? NEXT_ACTION_STATE.MISSED_KEY
      : completedTodaySessions.length > 0
        ? NEXT_ACTION_STATE.SESSION_DONE_TODAY
      : NEXT_ACTION_STATE.NO_SESSION_TODAY;

  const completedTodaySummary = completedTodaySessions
    .slice(0, 2)
    .map((session) => `${session.type} · ${session.duration_minutes} min · ${getDisciplineMeta(session.sport).label}`)
    .join(" • ");


  if (!hasActivePlan && !hasAnyPlan) {
    return (
      <section className="space-y-4">
        <article className="surface p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-accent">Get started</p>
          <h1 className="mt-2 text-2xl font-semibold">Build your first week</h1>
          <p className="mt-2 text-sm text-muted">
            Create a plan to unlock Today, Week Progress, and Coach Focus. Connect Garmin to reconcile completed work against scheduled sessions.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/plan" className="btn-primary">Create a plan</Link>
            <Link href="/plan" className="btn-secondary">Open plan setup</Link>
            <Link href="/settings/integrations" className="btn-secondary">Integrations → Garmin</Link>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className="contents lg:block lg:space-y-5">
          <article className="priority-card-primary next-action-card order-2 lg:order-none">
          <p className="priority-kicker">Next action</p>
          {nextPendingTodaySession ? (
            <>
              <h1 className="priority-title">Today: {nextPendingTodaySession.type}</h1>
              <p className="priority-subtitle">
                {nextPendingTodaySession.duration_minutes} min • {getDisciplineMeta(nextPendingTodaySession.sport).label}
                {nextPendingTodaySession.is_key ? <span className="ml-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Key session</span> : null}
              </p>
              <p className="mt-1 text-sm text-[hsl(var(--fg-muted))]">{getWhyTodayMattersCopy(nextActionState, nextPendingTodaySession)}</p>
            </>
          ) : overdueKeySession ? (
            <>
              <h1 className="priority-title">Key session missed: {overdueKeySession.type}</h1>
              <p className="priority-subtitle">Reschedule now to protect this week&apos;s intent.</p>
              <p className="mt-1 text-sm text-[hsl(var(--fg-muted))]">{getWhyTodayMattersCopy(nextActionState, overdueKeySession)}</p>
            </>
          ) : completedTodaySessions.length > 0 ? (
            <>
              <h1 className="priority-title flex items-center gap-2">Done for today <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success)/0.7)]">✓</span></h1>
              <p className="priority-subtitle">
                {completedTodaySummary}
                {completedTodaySessions.length > 2 ? ` • +${completedTodaySessions.length - 2} more completed` : ""}
              </p>
              <p className="mt-1 text-sm text-[hsl(var(--fg-muted))]">{getWhyTodayMattersCopy(nextActionState)}</p>
            </>
          ) : (
            <>
              <h1 className="priority-title">No session planned today</h1>
              <p className="priority-subtitle">
                Keep momentum by pulling one session forward
                {hasGapSuggestion ? ` — 30–45m easy ${biggestGap!.label.toLowerCase()} is the best fit.` : "."}
              </p>
              <p className="mt-1 text-sm text-[hsl(var(--fg-muted))]">{getWhyTodayMattersCopy(nextActionState)}</p>
            </>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {nextPendingTodaySession ? (
                <>
                  <Link href={`/calendar?focus=${nextPendingTodaySession.id}`} className="btn-primary px-3 py-1.5 text-xs">
                    Open session
                  </Link>
                  <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">View in calendar</Link>
                </>
              ) : overdueKeySession ? (
                <>
                  <Link href={`/calendar?focus=${overdueKeySession.id}`} className="btn-primary px-3 py-1.5 text-xs">Reschedule in calendar</Link>
                  <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">Skip and adjust week</Link>
                </>
              ) : completedTodaySessions.length > 0 ? (
                <>
                  <Link href="/calendar" className="btn-primary px-3 py-1.5 text-xs">Open calendar</Link>
                  <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">Review recovery options</Link>
                </>
              ) : null}
              {!nextPendingTodaySession && !overdueKeySession && completedTodaySessions.length === 0 ? (
                <Link href="/calendar" className="btn-primary px-3 py-1.5 text-xs">Open calendar</Link>
              ) : null}
            </div>
            {!nextPendingTodaySession && !overdueKeySession && completedTodaySessions.length === 0 ? (
              <Link href="/calendar" className="text-xs text-muted underline underline-offset-2">Why no session?</Link>
            ) : null}
          </div>
          </article>

          <article className="priority-card-supporting dashboard-supporting-card order-3 lg:order-none">
            <div className="dashboard-supporting-header">
              <p className="priority-kicker">This week&apos;s focus</p>
            </div>
            <h2 className="priority-title">{weeklyFocusText}</h2>
            <p className="priority-subtitle">Make one scheduling decision now, then return to execution.</p>
            <div className="mt-4">
              <Link href="/calendar" className={`${nextActionState === NEXT_ACTION_STATE.SESSION_TODAY ? "btn-secondary" : "btn-primary"} px-3 py-1.5 text-xs`}>Add suggested sessions</Link>
            </div>
          </article>
        </div>

        <div className="contents lg:block lg:min-w-0 lg:space-y-5">
          <div className="order-1 lg:order-none">
            <ProgressGlanceCard
              weekRangeLabel={`Week of ${weekRangeLabel(weekStart)}`}
              completionPct={completionPct}
              completedTimeLabel={toHoursAndMinutes(totals.completed)}
              plannedTimeLabel={toHoursAndMinutes(totals.planned)}
              remainingTimeLabel={toHoursAndMinutes(remainingMinutes)}
              statusLabel={progressStatus}
              missedPlannedCount={missedPlannedSessions}
              unmatchedExtraCount={unmatchedExtraSessions}
              compact
            />
          </div>

          <article id="week-progress-details" className="priority-card-supporting dashboard-supporting-card order-4 scroll-mt-20 lg:order-none lg:min-w-0">
            <div className="dashboard-supporting-header">
              <p className="priority-kicker">Week progress</p>
            </div>
            <h2 className="text-base font-semibold text-[hsl(var(--fg))]">Discipline breakdown and gaps.</h2>
            <div className="mt-4 min-w-0">
              <WeekProgressCard
                plannedTotalMinutes={totals.planned}
                completedTotalMinutes={totals.completed}
                disciplines={progressBySport.map((item) => ({
                  key: item.sport,
                  label: item.label,
                  plannedMinutes: item.planned,
                  completedMinutes: item.completed,
                  extraMinutes: item.extraMinutes,
                  color: item.color
                }))}
                extraTotalMinutes={extraMinutesTotal}
                showStatusChip={false}
                compact
                defaultExpanded={false}
              />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
