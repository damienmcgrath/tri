import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { markSkippedAction, moveSessionAction, swapSessionDayAction } from "./actions";

type PlannedSession = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration: number | null;
  notes: string | null;
  created_at: string;
};

type CompletedSession = {
  date: string;
  sport: string;
  metrics: {
    duration_s?: number;
    tss?: number;
  };
};

type Profile = {
  race_date: string | null;
  race_name: string | null;
};

const sports = ["swim", "bike", "run", "strength"] as const;
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function isPlannedSessionTableMissing(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return /could not find the table 'public\.planned_sessions' in the schema cache/i.test(error.message ?? "");
}

function isPlannedSessionColumnMissing(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "42703") {
    return true;
  }

  return /column\s+planned_sessions\./i.test(error.message ?? "") && /does not exist/i.test(error.message ?? "");
}

function isMissingProfilesTable(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return /could not find the table 'public\.profiles' in the schema cache/i.test(error.message ?? "");
}

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

function getSessionStatus(session: PlannedSession, completionLedger: Record<string, number>) {
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

function formatWeekRange(startIso: string) {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${shortDateFormatter.format(start)}–${shortDateFormatter.format(end)}`;
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
  const weekStart = requestedWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeekStart)
    ? requestedWeekStart
    : getMonday().toISOString().slice(0, 10);
  const weekEnd = addDays(weekStart, 7);
  const todayIso = new Date().toISOString().slice(0, 10);
  const isCurrentWeek = weekStart === getMonday().toISOString().slice(0, 10);

  const { data: plannedData, error: plannedError } = await supabase
    .from("planned_sessions")
    .select("id,date,sport,type,duration,notes,created_at")
    .gte("date", weekStart)
    .lt("date", weekEnd)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

  const { data: legacyPlannedData, error: legacyPlannedError } = plannedError && isPlannedSessionColumnMissing(plannedError)
    ? await supabase
        .from("planned_sessions")
        .select("id,date,sport,session_type,duration_minutes,notes,created_at")
        .gte("date", weekStart)
        .lt("date", weekEnd)
        .order("date", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: null, error: null };

  const { data: completedData, error: completedError } = await supabase
    .from("completed_sessions")
    .select("date,sport,metrics")
    .gte("date", weekStart)
    .lt("date", weekEnd)
    .order("date", { ascending: true });

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("race_date,race_name")
    .eq("id", user.id)
    .maybeSingle();

  if (completedError) {
    throw new Error(completedError.message ?? "Failed to load dashboard data.");
  }

  if (plannedError && !isPlannedSessionTableMissing(plannedError) && !isPlannedSessionColumnMissing(plannedError)) {
    throw new Error(plannedError.message ?? "Failed to load dashboard data.");
  }

  if (legacyPlannedError) {
    throw new Error(legacyPlannedError.message ?? "Failed to load dashboard data.");
  }

  if (profileError && !isMissingProfilesTable(profileError)) {
    throw new Error(profileError.message ?? "Failed to load profile data.");
  }

  const plannedSessions = ((plannedData ?? []) as PlannedSession[]).length > 0
    ? ((plannedData ?? []) as PlannedSession[])
    : ((legacyPlannedData ?? []) as Array<
        Omit<PlannedSession, "type" | "duration"> & { session_type: string; duration_minutes: number | null }
      >).map((session) => ({
        id: session.id,
        date: session.date,
        sport: session.sport,
        type: session.session_type,
        duration: session.duration_minutes,
        notes: session.notes,
        created_at: session.created_at
      }));

  const sortedPlannedSessions = plannedSessions.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const completedSessions = (completedData ?? []) as CompletedSession[];
  const profile = (profileData ?? null) as Profile | null;
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;

  const completionLedger = completedSessions.reduce<Record<string, number>>((acc, session) => {
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const withStatus = sortedPlannedSessions.map((session) => ({
    ...session,
    duration: session.duration ?? 0,
    status: getSessionStatus(session, completionLedger)
  }));

  const todaySessions = withStatus.filter((session) => session.date === todayIso);
  const nextPendingTodaySession = todaySessions.find((session) => session.status === "planned") ?? null;
  const upcomingSession = withStatus.find((session) => session.status === "planned" && session.date >= todayIso);

  const totals = withStatus.reduce(
    (acc, session) => {
      acc.planned += session.duration;
      if (session.status === "completed") {
        acc.completed += session.duration;
      }
      return acc;
    },
    { planned: 0, completed: 0 }
  );

  const progressBySport = sports.map((sport) => {
    const planned = withStatus.filter((session) => session.sport === sport).reduce((sum, session) => sum + session.duration, 0);
    const completed = withStatus
      .filter((session) => session.sport === sport && session.status === "completed")
      .reduce((sum, session) => sum + session.duration, 0);

    return {
      sport,
      planned,
      completed,
      pct: planned === 0 ? 0 : Math.min(100, Math.round((completed / planned) * 100))
    };
  });

  const keyTodaySession = [...todaySessions]
    .filter((session) => session.status === "planned")
    .sort((a, b) => b.duration - a.duration)[0];

  const biggestGap = [...progressBySport].sort((a, b) => b.planned - b.completed - (a.planned - a.completed))[0];

  const focusSession = keyTodaySession ?? null;
  const focusText = focusSession
    ? `Your key session is ${getDisciplineMeta(focusSession.sport).label.toLowerCase()} ${focusSession.type.toLowerCase()} (${focusSession.duration} min). Protect this slot and keep execution smooth over intensity spikes.`
    : biggestGap && biggestGap.planned > 0
      ? `Biggest weekly gap is ${getDisciplineMeta(biggestGap.sport).label.toLowerCase()} (${biggestGap.completed}/${biggestGap.planned} min). Shifting one quality session into an open day will keep the week balanced.`
      : "Week just started. Lock in your first session today to establish rhythm and momentum.";

  const weekDays = Array.from({ length: 7 }).map((_, index) => {
    const iso = addDays(weekStart, index);
    const planned = withStatus.filter((session) => session.date === iso).reduce((sum, session) => sum + session.duration, 0);
    const completed = withStatus
      .filter((session) => session.date === iso && session.status === "completed")
      .reduce((sum, session) => sum + session.duration, 0);

    return {
      iso,
      weekday: weekdayFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
      day: shortDateFormatter.format(new Date(`${iso}T00:00:00.000Z`)),
      planned,
      completed,
      isToday: iso === todayIso
    };
  });

  const raceDate = profile?.race_date ?? (typeof metadata.race_date === "string" ? metadata.race_date : null);
  const raceNameFromMetadata = typeof metadata.race_name === "string" ? metadata.race_name : null;
  const raceName = profile?.race_name?.trim() || raceNameFromMetadata?.trim() || "Target race";
  const daysToRace = raceDate
    ? Math.max(0, Math.ceil((new Date(`${raceDate}T00:00:00.000Z`).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <section className="space-y-4">
      <header className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-muted">Week:</span>
          <span className="font-semibold">{formatWeekRange(weekStart)}</span>
          <Link href={`/dashboard?weekStart=${addDays(weekStart, -7)}`} className="btn-secondary px-3 py-1.5 text-xs">
            Prev week
          </Link>
          <Link href="/dashboard" className={`btn-secondary px-3 py-1.5 text-xs ${isCurrentWeek ? "border-cyan-400/40" : ""}`}>
            Current week
          </Link>
          <Link href={`/dashboard?weekStart=${addDays(weekStart, 7)}`} className="btn-secondary px-3 py-1.5 text-xs">
            Next week
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {daysToRace !== null ? (
            <p className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-100">
              {raceName} • {daysToRace} days
            </p>
          ) : (
            <Link href="/settings/race" className="text-xs text-cyan-300 underline-offset-2 hover:underline">
              Set race date
            </Link>
          )}
          <Link href="/coach" className="btn-secondary px-3 py-1.5 text-xs">
            Ask tri.ai
          </Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <article className="surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h1 className="text-xl font-semibold">Today</h1>
            <p className="text-xs text-muted">{shortDateFormatter.format(new Date(`${todayIso}T00:00:00.000Z`))}</p>
          </div>

          {todaySessions.length === 0 ? (
            <p className="surface-subtle p-3 text-sm text-muted">
              Rest day. Want to review your week or add an easy session?
            </p>
          ) : (
            <ul className="space-y-2">
              {todaySessions.map((session) => {
                const discipline = getDisciplineMeta(session.sport);
                return (
                  <li key={session.id} className="surface-subtle p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${discipline.className}`}>
                          {discipline.label}
                        </span>
                        <p className="mt-1 text-sm font-medium">{session.type}</p>
                        <p className="text-xs text-muted">{session.duration} min</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                          session.status === "completed"
                            ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                            : session.status === "skipped"
                              ? "border border-amber-400/30 bg-amber-500/10 text-amber-200"
                              : "border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] text-muted"
                        }`}
                      >
                        {session.status}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <form action={moveSessionAction} className="flex gap-2">
                        <input type="hidden" name="sessionId" value={session.id} />
                        <select name="newDate" defaultValue={session.date} className="input-base py-1 text-xs" aria-label="Move session day">
                          {weekDays.map((day) => (
                            <option key={day.iso} value={day.iso}>
                              {day.weekday}
                            </option>
                          ))}
                        </select>
                        <button className="btn-secondary px-2 py-1 text-xs">Move</button>
                      </form>

                      <form action={swapSessionDayAction} className="flex gap-2">
                        <input type="hidden" name="sourceSessionId" value={session.id} />
                        <select name="targetSessionId" defaultValue="" className="input-base py-1 text-xs" aria-label="Swap session day">
                          <option value="" disabled>
                            Swap with...
                          </option>
                          {withStatus
                            .filter((candidate) => candidate.id !== session.id)
                            .map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {weekdayFormatter.format(new Date(`${candidate.date}T00:00:00.000Z`))} • {candidate.type}
                              </option>
                            ))}
                        </select>
                        <button className="btn-secondary px-2 py-1 text-xs">Swap</button>
                      </form>

                      <form action={markSkippedAction}>
                        <input type="hidden" name="sessionId" value={session.id} />
                        <button className="btn-secondary w-full px-2 py-1 text-xs">Skip</button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-4">
            {nextPendingTodaySession || upcomingSession ? (
              <Link href="/calendar" className="btn-primary">
                Open next session
              </Link>
            ) : (
              <Link href="/calendar" className="btn-secondary">
                Review week
              </Link>
            )}
          </div>
        </article>

        <article className="surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Week Progress</h2>
            <div className="flex items-center gap-1 text-xs">
              <span className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">Minutes</span>
              <span title="Coming soon" className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-muted">
                Load (TSS)
              </span>
            </div>
          </div>

          <p className="mt-2 text-2xl font-semibold text-cyan-200">
            Completed {totals.completed} / {totals.planned} min
          </p>
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
                    <span className="text-muted">
                      {item.completed}/{item.planned} min
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--bg-card))]">
                    <div className={`h-full ${discipline.className}`} style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </div>

      <article className="surface p-4">
        <h2 className="text-lg font-semibold">Coach Focus — Today</h2>
        <p className="mt-2 text-sm text-[hsl(var(--fg))]">{focusText}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {focusSession ? (
            <>
              <form action={moveSessionAction} className="flex items-center gap-2">
                <input type="hidden" name="sessionId" value={focusSession.id} />
                <select name="newDate" defaultValue={focusSession.date} className="input-base py-1 text-xs" aria-label="Move focus session">
                  {weekDays.map((day) => (
                    <option key={day.iso} value={day.iso}>
                      {day.weekday}
                    </option>
                  ))}
                </select>
                <button className="btn-secondary px-3 py-1.5 text-xs">Move session</button>
              </form>
              <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">
                Swap days
              </Link>
              <form action={markSkippedAction}>
                <input type="hidden" name="sessionId" value={focusSession.id} />
                <button className="btn-secondary px-3 py-1.5 text-xs">Mark skipped</button>
              </form>
            </>
          ) : (
            <>
              <button disabled className="btn-secondary cursor-not-allowed px-3 py-1.5 text-xs opacity-60">
                Move session
              </button>
              <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">
                Swap days
              </Link>
              <button disabled className="btn-secondary cursor-not-allowed px-3 py-1.5 text-xs opacity-60">
                Mark skipped
              </button>
            </>
          )}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-cyan-300">Why?</summary>
          <div className="mt-2 surface-subtle p-3 text-sm text-muted">
            {focusSession ? (
              <p>
                This is today&apos;s longest planned session and carries the biggest endurance signal for your week. Executing it on schedule protects volume progression.
              </p>
            ) : (
              <p>
                Insight is based on planned vs completed minutes this week by discipline. Focus first on the largest remaining gap.
              </p>
            )}
            <Link href="/calendar" className="mt-2 inline-block text-xs text-cyan-300 underline-offset-2 hover:underline">
              View details
            </Link>
          </div>
        </details>
      </article>

      <article className="surface p-3">
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day) => {
            const pct = day.planned === 0 ? 0 : Math.min(100, Math.round((day.completed / day.planned) * 100));
            return (
              <Link
                key={day.iso}
                href="/calendar"
                className={`surface-subtle block p-2 text-center transition hover:border-cyan-400/60 hover:bg-[hsl(var(--bg-card))] ${day.isToday ? "border-cyan-400/60 bg-cyan-500/10" : ""}`}
              >
                <p className="text-[10px] uppercase tracking-wide text-muted">{day.weekday}</p>
                <p className="text-xs font-medium">{day.day}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[hsl(var(--bg))]">
                  <div className="h-full bg-cyan-300" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-muted">
                  {day.completed}/{day.planned}m
                </p>
              </Link>
            );
          })}
        </div>
      </article>

      {withStatus.length === 0 ? (
        <article className="surface p-4 text-sm text-muted">
          No plan loaded yet. Build a plan first, then come back for your day-by-day dashboard.
          <Link href="/plan" className="ml-2 text-cyan-300 underline-offset-2 hover:underline">
            Open plan setup
          </Link>
        </article>
      ) : null}
    </section>
  );
}
