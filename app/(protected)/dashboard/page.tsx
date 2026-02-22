import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/date/iso";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { markSkippedAction, moveSessionAction } from "./actions";

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
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

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

function formatWeekRange(startIso: string) {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${shortDateFormatter.format(start)}–${shortDateFormatter.format(end)}`;
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
  const isCurrentWeek = weekStart === currentWeekStart;

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

  const { data: sessionsData } = activePlanId
    ? await supabase
        .from("sessions")
        .select("id,plan_id,date,sport,type,duration_minutes,notes,created_at,status")
        .eq("plan_id", activePlanId)
        .gte("date", weekStart)
        .lt("date", weekEnd)
        .order("date", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: [] };

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

  const sessions = ((sessionsData ?? []) as Session[]).map((session) => ({
    ...session,
    duration_minutes: session.duration_minutes ?? 0,
    status: linkedSessionIds.has(session.id) ? ("completed" as const) : getSessionStatus(session, completionLedger)
  }));

  const hasActivePlan = Boolean(activePlanId);
  const hasWeekSessions = sessions.length > 0;

  const weekDays = Array.from({ length: 7 }).map((_, index) => {
    const iso = addDays(weekStart, index);
    const daySessions = sessions.filter((session) => session.date === iso);
    const planned = daySessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
    const completed = daySessions
      .filter((session) => session.status === "completed")
      .reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);

    return {
      iso,
      weekday: weekdayFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
      day: shortDateFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
      planned,
      completed,
      isToday: iso === todayIso,
      sports: [...new Set(daySessions.map((session) => session.sport))]
    };
  });

  const todaySessions = sessions.filter((session) => session.date === todayIso);
  const nextPendingTodaySession = todaySessions.find((session) => session.status === "planned") ?? null;

  const totals = sessions.reduce(
    (acc, session) => {
      acc.planned += session.duration_minutes ?? 0;
      if (session.status === "completed") {
        acc.completed += session.duration_minutes ?? 0;
      }
      return acc;
    },
    { planned: 0, completed: 0 }
  );


  const unassignedMinutes = unassignedUploads.reduce((sum, activity) => sum + Math.round((activity.duration_sec ?? 0) / 60), 0);

  const progressBySport = sports.map((sport) => {
    const planned = sessions.filter((session) => session.sport === sport).reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
    const completed = sessions
      .filter((session) => session.sport === sport && session.status === "completed")
      .reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);

    return {
      sport,
      planned,
      completed,
      pct: planned === 0 ? 0 : Math.min(100, Math.round((completed / planned) * 100))
    };
  });

  const keyTodaySession = [...todaySessions]
    .filter((session) => session.status === "planned")
    .sort((a, b) => (b.duration_minutes ?? 0) - (a.duration_minutes ?? 0))[0];

  const biggestGap = [...progressBySport].sort((a, b) => b.planned - b.completed - (a.planned - a.completed))[0];

  const focusText = keyTodaySession
    ? `Prioritize ${getDisciplineMeta(keyTodaySession.sport).label.toLowerCase()} ${keyTodaySession.type.toLowerCase()} (${keyTodaySession.duration_minutes} min) today.`
    : biggestGap && biggestGap.planned > 0
      ? `Your biggest weekly gap is ${getDisciplineMeta(biggestGap.sport).label} (${biggestGap.completed}/${biggestGap.planned} min).`
      : "Start the week by locking one short session today to build momentum.";

  const raceName = profile?.race_name?.trim() || "Target race";
  const daysToRace = profile?.race_date
    ? Math.max(0, Math.ceil((new Date(`${profile.race_date}T00:00:00.000Z`).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  if (!hasActivePlan && !hasAnyPlan) {
    return (
      <section className="space-y-4">
        <header className="surface sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">WEEK: {formatWeekRange(weekStart)}</span>
          </div>
          {daysToRace !== null ? (
            <p className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-100">
              {raceName} • {daysToRace} days
            </p>
          ) : (
            <Link href="/settings/race" className="btn-primary px-3 py-1.5 text-xs">
              Set race date
            </Link>
          )}
        </header>

        <article className="surface p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">Get started</p>
          <h1 className="mt-2 text-2xl font-semibold">Build your first week</h1>
          <p className="mt-2 text-sm text-muted">
            Create a plan to unlock Today, Week Progress, and Coach Focus. You can also connect Garmin to backfill completed sessions.
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
      <header className="surface sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">WEEK: {formatWeekRange(weekStart)}</span>
          <Link href={`/dashboard?weekStart=${addDays(weekStart, -7)}`} className="btn-secondary px-3 py-1.5 text-xs">Prev</Link>
          <Link href="/dashboard" className={`btn-secondary px-3 py-1.5 text-xs ${isCurrentWeek ? "border-cyan-400/50" : ""}`}>Current</Link>
          <Link href={`/dashboard?weekStart=${addDays(weekStart, 7)}`} className="btn-secondary px-3 py-1.5 text-xs">Next</Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {daysToRace !== null ? (
            <p className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-100">
              {raceName} • {daysToRace} days
            </p>
          ) : (
            <Link href="/settings/race" className="btn-secondary px-3 py-1.5 text-xs">Set race date</Link>
          )}
          <Link href="/plan" className="btn-primary px-3 py-1.5 text-xs">+ Add</Link>
          <Link href="/coach" className="btn-primary px-3 py-1.5 text-xs">Ask tri.ai</Link>
        </div>
      </header>

      {hasActivePlan && !hasWeekSessions ? (
        <article className="surface p-6">
          <h1 className="text-xl font-semibold">No sessions planned for this week.</h1>
          <p className="mt-2 text-sm text-muted">Schedule this week to start tracking execution and coaching insights.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/plan" className="btn-primary">Add session</Link>
            <Link href="/plan" className="btn-secondary">Duplicate last week</Link>
            <Link href="/plan" className="btn-secondary">Go to Plan</Link>
          </div>
        </article>
      ) : (
        <>
          {unassignedUploads.length > 0 ? (
            <article className="surface border border-amber-400/30 bg-amber-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.12em] text-amber-200">Garmin uploads</p>
              <p className="mt-1 text-sm text-amber-100">{unassignedUploads.length} unassigned uploaded activit{unassignedUploads.length === 1 ? "y" : "ies"} this week ({unassignedMinutes} min).</p>
              <Link href="/settings/integrations" className="mt-2 inline-block text-xs text-cyan-200 underline">Attach uploads to planned sessions</Link>
            </article>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <article className="surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h1 className="text-xl font-semibold">Today + Next up</h1>
                <p className="text-xs text-muted">{shortDateFormatter.format(new Date(`${todayIso}T00:00:00.000Z`))}</p>
              </div>

              {todaySessions.length === 0 ? (
                <p className="surface-subtle p-3 text-sm text-muted">No sessions for today.</p>
              ) : (
                <ul className="space-y-2">
                  {todaySessions.map((session) => {
                    const discipline = getDisciplineMeta(session.sport);
                    return (
                      <li key={session.id} className="surface-subtle p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${discipline.className}`}>
                              {discipline.label}
                            </span>
                            <p className="mt-1 text-sm font-medium">{session.type}</p>
                            <p className="text-xs text-muted">{session.duration_minutes} min</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-2 py-1 text-[11px] font-medium capitalize text-muted">
                              {session.status}
                            </span>
                            <details className="relative">
                              <summary aria-label="Session actions" className="list-none cursor-pointer rounded-lg border border-[hsl(var(--border))] px-2 py-1 text-xs">⋯</summary>
                              <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-2">
                                <form action={markSkippedAction}>
                                  <input type="hidden" name="sessionId" value={session.id} />
                                  <button className="w-full rounded-md px-2 py-1 text-left text-xs hover:bg-[hsl(var(--bg-card))]">Mark skipped</button>
                                </form>
                              </div>
                            </details>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={nextPendingTodaySession ? `/calendar?focus=${nextPendingTodaySession.id}` : "/calendar"} className="btn-primary px-3 py-1.5 text-xs">
                  Open next session
                </Link>
                <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">Log done</Link>
              </div>
            </article>

            <article className="surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Week Progress</h2>
                <div className="flex items-center gap-1 text-xs">
                  <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">Minutes</span>
                  <span title="Coming soon" className="cursor-not-allowed rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-muted">Load (TSS)</span>
                </div>
              </div>
              <p className="mt-2 text-2xl font-semibold text-cyan-200">Completed {totals.completed} / {totals.planned} min</p>
              <p className="text-sm text-muted">
                {toHoursAndMinutes(totals.completed)} / {toHoursAndMinutes(totals.planned)} • Remaining {Math.max(0, totals.planned - totals.completed)} min
              </p>

              <div className="mt-4 space-y-3">
                {progressBySport.map((item) => {
                  const discipline = getDisciplineMeta(item.sport);
                  return (
                    <div key={item.sport}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${discipline.className}`}>{discipline.label}</span>
                        <span className="text-muted">{item.completed}/{item.planned} min</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--bg-card))]">
                        <div className={`${discipline.className} h-full`} style={{ width: `${item.pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </div>

          <article className="surface p-4">
            <h2 className="text-lg font-semibold">Coach Focus — Today</h2>
            <p className="mt-2 text-sm">{focusText}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {keyTodaySession ? (
                <>
                  <form action={moveSessionAction} className="flex items-center gap-2">
                    <input type="hidden" name="sessionId" value={keyTodaySession.id} />
                    <select name="newDate" defaultValue={keyTodaySession.date} className="input-base py-1 text-xs" aria-label="Move session day">
                      {weekDays.map((day) => (
                        <option key={day.iso} value={day.iso}>{day.weekday}</option>
                      ))}
                    </select>
                    <button className="btn-secondary px-3 py-1.5 text-xs">Move session</button>
                  </form>
                  <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">Swap days</Link>
                  <form action={markSkippedAction}>
                    <input type="hidden" name="sessionId" value={keyTodaySession.id} />
                    <button className="btn-secondary px-3 py-1.5 text-xs">Mark skipped</button>
                  </form>
                </>
              ) : null}
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-cyan-300">Why?</summary>
              <div className="mt-2 surface-subtle p-3 text-sm text-muted">
                <p>Insight uses today&apos;s longest pending session or the largest weekly discipline gap in planned vs completed minutes.</p>
                <Link href="/calendar" className="mt-2 inline-block text-xs text-cyan-300 underline-offset-2 hover:underline">View details</Link>
              </div>
            </details>
          </article>

          <article className="surface p-3">
            <h2 className="mb-2 text-sm font-semibold text-muted">Week at a glance</h2>
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map((day) => (
                <Link
                  key={day.iso}
                  href={`/calendar?date=${day.iso}`}
                  className={`surface-subtle block p-2 text-center transition hover:border-cyan-400/60 ${day.isToday ? "border-cyan-400/60 bg-cyan-500/10" : ""}`}
                >
                  <p className="text-[10px] uppercase tracking-wide text-muted">{day.weekday}</p>
                  <p className="text-xs font-medium">{day.day}</p>
                  <p className="mt-1 text-[10px] text-muted">{day.completed}/{day.planned}m</p>
                  <div className="mt-1 flex flex-wrap justify-center gap-1">
                    {day.sports.slice(0, 3).map((sport) => {
                      const d = getDisciplineMeta(sport);
                      return <span key={`${day.iso}-${sport}`} className={`h-1.5 w-3 rounded-full ${d.className}`} aria-hidden="true" />;
                    })}
                  </div>
                </Link>
              ))}
            </div>
          </article>
        </>
      )}
    </section>
  );
}
