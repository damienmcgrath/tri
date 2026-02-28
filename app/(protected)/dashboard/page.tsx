import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { WeekProgressCard } from "./week-progress-card";
import { ProgressGlanceCard } from "./progress-glance-card";
import { DetailsAccordion } from "../details-accordion";
import { computeWeekMinuteTotals } from "@/lib/training/week-metrics";

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
function getMonday(date = new Date()) {
  const day = date.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - distanceFromMonday);
  return monday;
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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
      .select("id,sport_type,start_time_utc,duration_sec")
      .eq("user_id", user.id)
      .gte("start_time_utc", `${weekStart}T00:00:00.000Z`)
      .lt("start_time_utc", `${weekEnd}T00:00:00.000Z`),
    supabase.from("session_activity_links").select("completed_activity_id,planned_session_id").eq("user_id", user.id)
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
  const links = (linksData ?? []) as Array<{ completed_activity_id: string; planned_session_id?: string | null }>;
  const linkedActivityIds = new Set(links.map((item) => item.completed_activity_id));
  const linkedSessionIds = new Set(links.map((item) => item.planned_session_id).filter((value): value is string => Boolean(value)));
  const unassignedUploads = uploadedActivities.filter((item) => !linkedActivityIds.has(item.id));

  const durationByActivityId = new Map(uploadedActivities.map((activity) => [activity.id, Math.round((activity.duration_sec ?? 0) / 60)]));
  const linkedMinutesBySession = links.reduce<Map<string, number>>((acc, link) => {
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
  const unassignedMinutes = unassignedUploads.reduce((sum, activity) => sum + Math.round((activity.duration_sec ?? 0) / 60), 0);

  const progressBySport = sports.map((sport) => {
    const planned = sessions.filter((session) => session.sport === sport).reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
    const completed = sessions
      .filter((session) => session.sport === sport)
      .reduce((sum, session) => sum + getCompletedMinutes(session), 0);

    return {
      sport,
      planned,
      completed,
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
  const keyRemainingCount = weekMetricSessions.filter((session) => session.isKey && session.status === "planned").length;
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
      <div className="space-y-4">
        <ProgressGlanceCard
          completionPct={completionPct}
          completedTimeLabel={toHoursAndMinutes(totals.completed)}
          plannedTimeLabel={toHoursAndMinutes(totals.planned)}
          remainingTimeLabel={toHoursAndMinutes(remainingMinutes)}
          statusLabel={progressStatus}
          keyRemainingCount={keyRemainingCount}
        />

        <article className="priority-card-primary">
          <p className="priority-kicker">Next action</p>
          {nextPendingTodaySession ? (
            <>
              <h1 className="priority-title">Today: {nextPendingTodaySession.type}</h1>
              <p className="priority-subtitle">
                {nextPendingTodaySession.duration_minutes} min • {getDisciplineMeta(nextPendingTodaySession.sport).label}
                {nextPendingTodaySession.is_key ? <span className="ml-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Key session</span> : null}
              </p>
              <p className="mt-1 text-sm text-muted">Why today matters: lock in today to keep your key-session quality intact.</p>
            </>
          ) : overdueKeySession ? (
            <>
              <h1 className="priority-title">Key session missed: {overdueKeySession.type}</h1>
              <p className="priority-subtitle">Reschedule now to protect this week&apos;s intent.</p>
            </>
          ) : (
            <>
              <h1 className="priority-title">No session planned today</h1>
              <p className="priority-subtitle">
                Keep momentum by pulling one session forward
                {hasGapSuggestion ? ` — 30–45m easy ${biggestGap!.label.toLowerCase()} is the best fit.` : "."}
              </p>
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
              ) : null}
              {!nextPendingTodaySession && !overdueKeySession ? (
                <Link href="/calendar" className="btn-primary px-3 py-1.5 text-xs">Open calendar</Link>
              ) : null}
            </div>
            {!nextPendingTodaySession && !overdueKeySession ? (
              <Link href="/calendar" className="text-xs text-muted underline underline-offset-2">Why no session?</Link>
            ) : null}
          </div>
        </article>

        <div className="space-y-4">
          <article className="priority-card-supporting">
            <p className="priority-kicker">This week&apos;s focus</p>
            <h2 className="priority-title">{weeklyFocusText}</h2>
            <p className="priority-subtitle">Make one scheduling decision now, then return to execution.</p>
            <div className="mt-4">
              <Link href="/calendar" className="btn-primary px-3 py-1.5 text-xs">Add suggested sessions</Link>
            </div>
          </article>

          <article id="week-progress-details" className="priority-card-supporting scroll-mt-20">
            <p className="priority-kicker">Week progress</p>
            <h2 className="priority-title">Discipline breakdown and gaps.</h2>
            <div className="mt-4">
              <WeekProgressCard
                plannedTotalMinutes={totals.planned}
                completedTotalMinutes={totals.completed}
                disciplines={progressBySport.map((item) => ({
                  key: item.sport,
                  label: item.label,
                  plannedMinutes: item.planned,
                  completedMinutes: item.completed,
                  color: item.color
                }))}
              />
            </div>
          </article>

          <DetailsAccordion title="Details">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="priority-card-supporting">
                <h3 className="text-sm font-semibold">Sport breakdown</h3>
                <ul className="mt-2 space-y-2">
                  {progressBySport.map((sport) => (
                    <li key={sport.sport} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-medium">{sport.label}</span>
                      <span className="text-muted">{sport.completed}/{sport.planned} min</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="priority-card-supporting">
                <h3 className="text-sm font-semibold">Unmatched uploads</h3>
                {unassignedUploads.length > 0 ? (
                  <>
                    <p className="mt-2 text-sm text-muted">
                      {unassignedUploads.length} upload{unassignedUploads.length === 1 ? "" : "s"} still need matching ({unassignedMinutes} min).
                    </p>
                    <Link href="/settings/integrations" className="mt-2 inline-block text-xs text-accent underline">Match uploads now</Link>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {unassignedUploads.slice(0, 3).map((item) => (
                        <Link key={item.id} href={`/activities/${item.id}`} className="rounded-full border border-[hsl(var(--border))] px-2 py-1">
                          View {item.sport_type}
                        </Link>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-muted">Great job—every uploaded activity is already matched to your plan.</p>
                )}
              </div>
            </div>
          </DetailsAccordion>

        </div>
      </div>
    </section>
  );
}
