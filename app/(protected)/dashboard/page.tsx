import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { SessionStatusChip } from "@/lib/ui/status-chip";
import { markSkippedAction, moveSessionAction } from "./actions";
import { WeekProgressCard } from "./week-progress-card";
import { StatusStrip } from "../status-strip";
import { DetailsAccordion } from "../details-accordion";
import { computeWeekMinuteTotals, computeWeekSessionCounts, getKeySessionsRemaining } from "@/lib/training/week-metrics";

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
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = weekStart;
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

  const { data: previousWeekSessionsData } = activePlanId
    ? await supabase
        .from("sessions")
        .select("id,duration_minutes,status")
        .eq("plan_id", activePlanId)
        .gte("date", previousWeekStart)
        .lt("date", previousWeekEnd)
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
  const hasWeekSessions = sessions.length > 0;

  const weekDays = Array.from({ length: 7 }).map((_, index) => {
    const iso = addDays(weekStart, index);
    const daySessions = sessions.filter((session) => session.date === iso);
    const planned = daySessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
    const completed = daySessions
      .reduce((sum, session) => sum + getCompletedMinutes(session), 0);

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

  const minuteMetrics = computeWeekMinuteTotals(
    sessions.map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      durationMinutes: session.duration_minutes ?? 0,
      status: session.status,
      isKey: session.is_key
    }))
  );
  const totals = { planned: minuteMetrics.plannedMinutes, completed: minuteMetrics.completedMinutes };
  const countMetrics = computeWeekSessionCounts(
    sessions.map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      durationMinutes: session.duration_minutes ?? 0,
      status: session.status,
      isKey: session.is_key
    }))
  );
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


  const keyTodaySession = [...todaySessions]
    .filter((session) => session.status === "planned")
    .sort((a, b) => (b.duration_minutes ?? 0) - (a.duration_minutes ?? 0))[0];
  const biggestGap = [...progressBySport].sort((a, b) => b.planned - b.completed - (a.planned - a.completed))[0];

  const focusText = keyTodaySession
    ? `Prioritize ${getDisciplineMeta(keyTodaySession.sport).label.toLowerCase()} ${keyTodaySession.type.toLowerCase()} (${keyTodaySession.duration_minutes} min) today.`
    : biggestGap && biggestGap.planned > 0
      ? `Your biggest weekly gap is ${getDisciplineMeta(biggestGap.sport).label} (${biggestGap.completed}/${biggestGap.planned} min).`
      : "Start with one short session today to establish execution rhythm.";


  const keyRemainingIds = new Set(
    getKeySessionsRemaining(
      sessions.map((session) => ({
        id: session.id,
        date: session.date,
        sport: session.sport,
        durationMinutes: session.duration_minutes ?? 0,
        status: session.status,
        isKey: session.is_key
      })),
      todayIso
    )
      .slice(0, 4)
      .map((session) => session.id)
  );

  const keySessionsRemaining = sessions
    .filter((session) => keyRemainingIds.has(session.id))
    .sort((a, b) => a.date.localeCompare(b.date));
  const previousWeekSessions = (previousWeekSessionsData ?? []) as Array<{ duration_minutes: number | null; status: Session["status"] }>;
  const previousWeekTotals = previousWeekSessions.reduce(
    (acc, session) => {
      const minutes = session.duration_minutes ?? 0;
      acc.planned += minutes;
      if (session.status === "completed") {
        acc.completed += minutes;
      }
      return acc;
    },
    { planned: 0, completed: 0 }
  );

  const completionPct = totals.planned > 0 ? Math.round((totals.completed / totals.planned) * 100) : 0;
  const previousCompletionPct = previousWeekTotals.planned > 0 ? Math.round((previousWeekTotals.completed / previousWeekTotals.planned) * 100) : 0;
  const completionDelta = completionPct - previousCompletionPct;
  const remainingMinutes = Math.max(totals.planned - totals.completed, 0);
  const remainingMinutesDelta = remainingMinutes - Math.max(previousWeekTotals.planned - previousWeekTotals.completed, 0);
  const fatigueState = completionPct >= 85 ? "Controlled" : completionPct >= 60 ? "Balanced" : "Accumulating";
  const confidenceLabel = completionPct >= 85 ? "High" : completionPct >= 60 ? "Building" : "Low";
  const completionTrend = completionDelta > 2 ? "↑" : completionDelta < -2 ? "↓" : "→";
  const loadTrend = remainingMinutesDelta < -20 ? "↓" : remainingMinutesDelta > 20 ? "↑" : "→";
  const fatigueTrend = completionPct >= 85 ? "↓" : completionPct >= 60 ? "→" : "↑";
  const confidenceTrend = completionDelta > 2 ? "↑" : completionDelta < -2 ? "↓" : "→";


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
        <article className="priority-card-primary">
          <p className="priority-kicker">Weekly coaching takeaway</p>
          <h1 className="priority-title">{hasWeekSessions ? focusText : "Set one key workout and execute it."}</h1>
          <p className="priority-subtitle">
            {hasWeekSessions
              ? "Keep execution tight this week and protect recovery on non-key days."
              : "Add sessions for this week so your next best workout is always clear."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {hasWeekSessions ? (
              <>
                <Link href={nextPendingTodaySession ? `/calendar?focus=${nextPendingTodaySession.id}` : "/calendar"} className="btn-primary px-3 py-1.5 text-xs">
                  Open next session
                </Link>
                <Link href="/calendar" className="btn-secondary px-3 py-1.5 text-xs">Log completed work</Link>
              </>
            ) : (
              <>
                <Link href="/plan" className="btn-primary">Add session</Link>
                <Link href="/plan" className="btn-secondary">Duplicate last week</Link>
              </>
            )}
          </div>
        </article>

        <StatusStrip
          items={[
            { label: "Completion", value: `${completionPct}%`, hint: `${completionTrend} ${completionDelta >= 0 ? `+${completionDelta}` : completionDelta} pts` },
            { label: "Planned", value: `${countMetrics.plannedTotalCount} sessions`, hint: `${countMetrics.plannedRemainingCount} remaining` },
            { label: "Fatigue", value: fatigueState, hint: fatigueTrend },
            { label: "Confidence", value: confidenceLabel, hint: confidenceTrend }
          ]}
        />

        <div className="priority-layout">
          <article className="priority-card-emphasis">
            <p className="priority-kicker">Today&apos;s sessions</p>
            <h2 className="priority-title">Execute high-impact work first.</h2>
            <p className="priority-subtitle">{shortDateFormatter.format(new Date(`${todayIso}T00:00:00.000Z`))}</p>
            {todaySessions.length === 0 ? (
              <div className="surface-subtle mt-4 p-3 text-sm text-muted">
                <p>No sessions for today.</p>
                <Link href="/calendar" className="mt-2 inline-flex text-xs text-accent underline">Open calendar</Link>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {todaySessions.map((session) => {
                  const discipline = getDisciplineMeta(session.sport);
                  return (
                    <li key={session.id} className="surface-subtle p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span title={`${discipline.label} · ${discipline.shape}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${discipline.className} ${discipline.textureClassName}`}><span aria-hidden="true">{discipline.icon}</span><span>{discipline.label}</span></span>
                          <p className="mt-1 text-sm font-medium">{session.type}</p>
                          <p className="text-xs text-muted">{session.duration_minutes} min</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <SessionStatusChip status={session.status} />
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
          </article>

          <article className="priority-card-supporting">
            <p className="priority-kicker">On track this week</p>
            <h2 className="priority-title">Confirm your confidence trend.</h2>
            <p className="priority-subtitle">Check completion pace and close the largest discipline gap before week end.</p>
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

          <article className="surface-subtle p-3">
            <h2 className="mb-2 text-sm font-semibold text-muted">Key sessions remaining</h2>
            {keySessionsRemaining.length === 0 ? (
              <p className="text-sm text-muted">No key sessions remaining. Keep consistency by protecting recovery and showing up for planned sessions.</p>
            ) : (
              <ul className="space-y-2">
                {keySessionsRemaining.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.12em] text-muted">{weekdayFormatter.format(new Date(`${session.date}T00:00:00.000Z`))}</p>
                      <p className="truncate text-sm font-medium">{session.type}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold">{session.duration_minutes}m</p>
                      <Link href={`/calendar?focus=${session.id}`} className="text-xs text-accent underline">Open</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
