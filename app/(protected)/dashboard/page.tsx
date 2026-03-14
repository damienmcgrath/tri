import Link from "next/link";
import { WeekRiskCard, WeeklyInterventionCard } from "@/components/training/dashboard-cards";
import { StatusPill } from "@/components/training/status-pill";
import { buildWeekStateSummary, type WeekSessionInput } from "@/lib/training/week-state";
import { SESSION_LIFECYCLE_META } from "@/lib/training/semantics";
import { getSessionDisplayName } from "@/lib/training/session";
import { createClient } from "@/lib/supabase/server";
import { addDays, getMonday, weekRangeLabel } from "../week-context";

type SessionRow = {
  id: string;
  plan_id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  discipline?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  intent_category?: string | null;
  intent_summary?: string | null;
  target?: string | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  status?: "planned" | "completed" | "skipped" | null;
  execution_result?: Record<string, unknown> | null;
  is_key?: boolean | null;
  is_protected?: boolean | null;
  is_flexible?: boolean | null;
  session_role?: "key" | "supporting" | "recovery" | "optional" | "Key" | "Supporting" | "Recovery" | "Optional" | null;
};

type LegacySessionRow = {
  id: string;
  plan_id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  status?: "planned" | "completed" | "skipped" | null;
};

type CompletedSessionRow = {
  date: string;
  sport: string;
};

type CompletedActivityRow = {
  id: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  schedule_status?: "scheduled" | "unscheduled" | null;
  is_unplanned?: boolean | null;
};

type Profile = {
  active_plan_id: string | null;
};

type Plan = {
  id: string;
};

function isMissingSessionColumnError(message?: string) {
  return /(target|intent_summary|is_key|is_protected|is_flexible|session_name|discipline|subtype|workout_type|intent_category|execution_result|schema cache|column .* does not exist|42703)/i.test(
    message ?? ""
  );
}

function isMissingActivityColumnError(message?: string) {
  return /(schedule_status|is_unplanned|schema cache|column .* does not exist|42703)/i.test(message ?? "");
}

function toHoursAndMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}h ${mins}m`;
}

function getLocalTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getFallbackStoredStatus(
  session: Pick<SessionRow, "date" | "sport" | "notes" | "status">,
  completionLedger: Record<string, number>,
  linkedSessionIds: Set<string>,
  sessionId: string
) {
  if (linkedSessionIds.has(sessionId)) return "completed" as const;
  if (session.status === "completed" || session.status === "skipped") return session.status;
  if (/\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(session.notes ?? "")) return "skipped" as const;

  const key = `${session.date}:${session.sport}`;
  const completedCount = completionLedger[key] ?? 0;
  if (completedCount > 0) {
    completionLedger[key] = completedCount - 1;
    return "completed" as const;
  }

  return "planned" as const;
}

function getDaySummary(params: {
  iso: string;
  todayIso: string;
  sessions: ReturnType<typeof buildWeekStateSummary>["sessions"];
}) {
  const daySessions = params.sessions.filter((session) => session.date === params.iso && !session.isExtra);
  const completed = daySessions.filter((session) => session.lifecycle === "completed");
  const skipped = daySessions.filter((session) => session.lifecycle === "skipped");
  const missed = daySessions.filter((session) => session.lifecycle === "missed");
  const remaining = daySessions.filter((session) => session.lifecycle === "today" || session.lifecycle === "planned");
  const totalMinutes = daySessions.reduce((sum, session) => sum + session.durationMinutes, 0);

  if (remaining.length > 0 && params.iso === params.todayIso) {
    return {
      label: "Today",
      detail: `${remaining.reduce((sum, session) => sum + session.durationMinutes, 0)}m left`,
      tone: "info" as const
    };
  }

  if (missed.length > 0) {
    return {
      label: "Missed",
      detail: `${missed.reduce((sum, session) => sum + session.durationMinutes, 0)}m behind`,
      tone: "attention" as const
    };
  }

  if (completed.length > 0 && completed.length === daySessions.length) {
    return {
      label: "Completed",
      detail: `${completed.reduce((sum, session) => sum + session.durationMinutes, 0)}m done`,
      tone: "success" as const
    };
  }

  if (skipped.length > 0 && skipped.length === daySessions.length) {
    return {
      label: "Skipped",
      detail: `${skipped.reduce((sum, session) => sum + session.durationMinutes, 0)}m dropped`,
      tone: "warning" as const
    };
  }

  if (remaining.length > 0) {
    return {
      label: "Planned",
      detail: `${remaining.reduce((sum, session) => sum + session.durationMinutes, 0)}m planned`,
      tone: "neutral" as const
    };
  }

  return {
    label: "Recovery",
    detail: totalMinutes > 0 ? `${totalMinutes}m mixed` : "No sessions",
    tone: "neutral" as const
  };
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
  const todayIso = getLocalTodayIso();

  const [{ data: profileData }, { data: plansData }, { data: completedData }, activitiesQuery, { data: linksData }] = await Promise.all([
    supabase.from("profiles").select("active_plan_id").eq("id", user.id).maybeSingle(),
    supabase.from("training_plans").select("id").order("start_date", { ascending: false }),
    supabase.from("completed_sessions").select("date,sport").gte("date", weekStart).lt("date", weekEnd),
    supabase
      .from("completed_activities")
      .select("id,sport_type,start_time_utc,duration_sec,schedule_status,is_unplanned")
      .eq("user_id", user.id)
      .gte("start_time_utc", `${weekStart}T00:00:00.000Z`)
      .lt("start_time_utc", `${weekEnd}T00:00:00.000Z`),
    supabase
      .from("session_activity_links")
      .select("completed_activity_id,planned_session_id,confirmation_status")
      .eq("user_id", user.id)
  ]);

  const profile = (profileData ?? null) as Profile | null;
  const plans = (plansData ?? []) as Plan[];
  const hasAnyPlan = plans.length > 0;
  const activePlanId = profile?.active_plan_id ?? plans[0]?.id ?? null;

  if (!activePlanId && !hasAnyPlan) {
    return (
      <section className="space-y-4">
        <article className="surface p-6">
          <p className="text-xs uppercase tracking-[0.16em] text-accent">Get started</p>
          <h1 className="mt-2 text-2xl font-semibold">Build your first week</h1>
          <p className="mt-2 text-sm text-muted">
            Create a plan to unlock week status, today priorities, and coach-grade review.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/plan" className="btn-primary">Create a plan</Link>
            <Link href="/settings/integrations" className="btn-secondary">Connect Garmin</Link>
          </div>
        </article>
      </section>
    );
  }

  let sessionData: unknown[] | null = [];

  if (activePlanId) {
    const primary = await supabase
      .from("sessions")
      .select("id,plan_id,date,sport,type,session_name,discipline,subtype,workout_type,intent_category,intent_summary,target,duration_minutes,notes,created_at,status,execution_result,is_key,is_protected,is_flexible,session_role")
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

      if (fallback.error) {
        throw new Error(fallback.error.message);
      }

      sessionData = fallback.data as unknown[] | null;
    } else if (primary.error) {
      throw new Error(primary.error.message);
    } else {
      sessionData = primary.data as unknown[] | null;
    }
  }

  let normalizedActivities = (activitiesQuery.data ?? []) as CompletedActivityRow[];

  if (activitiesQuery.error && isMissingActivityColumnError(activitiesQuery.error.message)) {
    const fallbackActivities = await supabase
      .from("completed_activities")
      .select("id,sport_type,start_time_utc,duration_sec")
      .eq("user_id", user.id)
      .gte("start_time_utc", `${weekStart}T00:00:00.000Z`)
      .lt("start_time_utc", `${weekEnd}T00:00:00.000Z`);

    if (fallbackActivities.error) {
      throw new Error(fallbackActivities.error.message);
    }

    normalizedActivities = ((fallbackActivities.data ?? []) as Array<Record<string, unknown>>).map((activity) => ({
      id: String(activity.id),
      sport_type: String(activity.sport_type),
      start_time_utc: String(activity.start_time_utc),
      duration_sec: typeof activity.duration_sec === "number" ? activity.duration_sec : null,
      schedule_status: null,
      is_unplanned: false
    }));
  } else if (activitiesQuery.error) {
    throw new Error(activitiesQuery.error.message);
  }

  const links = (linksData ?? []) as Array<{
    completed_activity_id: string;
    planned_session_id?: string | null;
    confirmation_status?: "suggested" | "confirmed" | "rejected" | null;
  }>;
  const confirmedLinks = links.filter((item) => item.confirmation_status === "confirmed" || item.confirmation_status === null || typeof item.confirmation_status === "undefined");
  const linkedSessionIds = new Set(confirmedLinks.map((item) => item.planned_session_id).filter((value): value is string => Boolean(value)));
  const linkedActivityIds = new Set(confirmedLinks.map((item) => item.completed_activity_id));
  const rejectedActivityIds = new Set(
    links
      .filter((item) => item.confirmation_status === "rejected")
      .map((item) => item.completed_activity_id)
  );

  const completionLedger = ((completedData ?? []) as CompletedSessionRow[]).reduce<Record<string, number>>((acc, session) => {
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const sessions = ((sessionData ?? []) as Array<SessionRow | LegacySessionRow>).map((row) => {
    const session = row as SessionRow;

    return {
      id: session.id,
      date: session.date,
      sport: session.sport,
      title: getSessionDisplayName({
        sessionName: session.session_name ?? session.type,
        discipline: session.discipline ?? session.sport,
        subtype: session.subtype,
        workoutType: session.workout_type,
        intentCategory: session.intent_category
      }),
      durationMinutes: session.duration_minutes ?? 0,
      storedStatus: getFallbackStoredStatus(session, completionLedger, linkedSessionIds, session.id),
      isKey: Boolean(session.is_key),
      isProtected: Boolean(session.is_protected || session.is_key),
      isFlexible: Boolean(session.is_flexible),
      isOptional: String(session.session_role ?? "").toLowerCase() === "optional",
      intentSummary: session.intent_summary ?? null,
      intentCategory: session.intent_category ?? null,
      target: session.target ?? null,
      executionResult: session.execution_result ?? null
    } satisfies WeekSessionInput;
  });

  const extraSessions = normalizedActivities
    .filter((activity) => !linkedActivityIds.has(activity.id))
    .filter((activity) => Boolean(activity.is_unplanned) || activity.schedule_status === "unscheduled" || rejectedActivityIds.has(activity.id))
    .map((activity) => ({
      id: `activity:${activity.id}`,
      date: activity.start_time_utc.slice(0, 10),
      sport: activity.sport_type,
      title: "Extra workout",
      durationMinutes: Math.round((activity.duration_sec ?? 0) / 60),
      storedStatus: "completed" as const,
      isExtra: true
    } satisfies WeekSessionInput));

  const weekSummary = buildWeekStateSummary({
    sessions: [...sessions, ...extraSessions],
    todayIso
  });

  const completionPct = weekSummary.plannedMinutes > 0
    ? Math.round((weekSummary.completedMinutes / weekSummary.plannedMinutes) * 100)
    : 0;

  const todaySessions = weekSummary.sessions
    .filter((session) => session.date === todayIso)
    .sort((left, right) => {
      const leftPriority = left.isProtected ? 0 : left.isKey ? 1 : 2;
      const rightPriority = right.isProtected ? 0 : right.isKey ? 1 : 2;
      return leftPriority - rightPriority;
    });
  const todayRemaining = todaySessions.filter((session) => session.lifecycle === "today");
  const todayCompleted = todaySessions.filter((session) => session.lifecycle === "completed");
  const todayExtra = todaySessions.filter((session) => session.lifecycle === "extra");
  const currentPrioritySession = todayRemaining[0] ?? null;

  const weekDays = Array.from({ length: 7 }).map((_, index) => {
    const iso = addDays(weekStart, index);
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00.000Z`));
    return {
      iso,
      weekday,
      summary: getDaySummary({
        iso,
        todayIso,
        sessions: weekSummary.sessions
      })
    };
  });

  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <article className="surface p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-accent">This week</p>
              <p className="mt-1 text-sm text-muted">Week of {weekRangeLabel(weekStart)}</p>
            </div>
            <StatusPill
              label={weekSummary.weekRiskLabel}
              tone={weekSummary.weekRisk === "on_track" ? "success" : weekSummary.weekRisk === "watch" ? "warning" : "attention"}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-5xl font-semibold leading-none">{completionPct}%</p>
              <p className="mt-2 text-base font-medium">
                {toHoursAndMinutes(weekSummary.completedMinutes)} / {toHoursAndMinutes(weekSummary.plannedMinutes)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {weekSummary.counts.completed} completed · {weekSummary.counts.remaining} remaining · {weekSummary.counts.missed} missed · {weekSummary.counts.extra} extra
              </p>
            </div>
            <div className="grid gap-2 text-right text-sm">
              <p>
                Remaining
                <span className="mt-0.5 block text-lg font-semibold text-[hsl(var(--text-primary))]">
                  {toHoursAndMinutes(weekSummary.remainingMinutes)}
                </span>
              </p>
              <p className="text-muted">
                Protected sessions left: {weekSummary.protected.remaining}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-7 gap-2">
            {weekDays.map((day) => (
              <div key={day.iso} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.7)] px-2 py-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.04em] text-[hsl(var(--fg-muted))]">{day.weekday}</p>
                <p className="mt-1 text-[11px] font-semibold leading-tight">{day.summary.label}</p>
                <div className="mt-1">
                  <StatusPill label={day.summary.label} tone={day.summary.tone} compact />
                </div>
                <p className="mt-1 text-[10px] text-[hsl(var(--fg-muted))]">{day.summary.detail}</p>
              </div>
            ))}
          </div>

          <WeekRiskCard
            risk={weekSummary.weekRisk}
            summary={weekSummary.focusStatement}
            detail={`Protected completed: ${weekSummary.protected.completed}. Protected still open: ${weekSummary.protected.remaining}.`}
          />
        </article>

        <article className="surface p-5 md:p-6">
          <h2 className="text-xl font-semibold">Today</h2>
          {currentPrioritySession ? (
            <>
              <p className="mt-1 text-sm text-muted">Current priority</p>
              <h3 className="mt-3 text-lg font-semibold">{currentPrioritySession.title}</h3>
              <p className="mt-2 text-sm text-muted">
                {currentPrioritySession.durationMinutes} min
                {currentPrioritySession.target ? ` · ${currentPrioritySession.target}` : ""}
                {currentPrioritySession.isProtected ? " · Protected" : currentPrioritySession.isFlexible ? " · Flexible" : ""}
              </p>
              {currentPrioritySession.intentSummary ? (
                <p className="mt-2 text-sm text-muted">{currentPrioritySession.intentSummary}</p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">Current priority</p>
              <h3 className="mt-3 text-lg font-semibold">
                {todayCompleted.length > 0 ? "Today is done" : "No session scheduled today"}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {todayCompleted.length > 0
                  ? "Use the rest of the day to protect recovery and keep the week steady."
                  : "Use Calendar if you need to move anything. Otherwise keep the next protected session fixed."}
              </p>
            </>
          )}

          <div className="mt-4 space-y-2">
            {todayRemaining.map((session) => {
              const meta = SESSION_LIFECYCLE_META[session.lifecycle];
              return (
                <div key={session.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{session.title}</p>
                    <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} compact />
                  </div>
                  <p className="mt-1 text-xs text-muted">{session.durationMinutes} min{session.target ? ` · ${session.target}` : ""}</p>
                </div>
              );
            })}

            {todayCompleted.map((session) => {
              const meta = SESSION_LIFECYCLE_META[session.lifecycle];
              return (
                <div key={session.id} className="rounded-lg border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.08)] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{session.title}</p>
                    <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} compact />
                  </div>
                  <p className="mt-1 text-xs text-muted">{session.durationMinutes} min</p>
                </div>
              );
            })}

            {todayExtra.map((session) => {
              const meta = SESSION_LIFECYCLE_META[session.lifecycle];
              return (
                <div key={session.id} className="rounded-lg border border-[hsl(var(--accent-performance)/0.35)] bg-[hsl(var(--accent-performance)/0.08)] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{session.title}</p>
                    <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} compact />
                  </div>
                  <p className="mt-1 text-xs text-muted">{session.durationMinutes} min</p>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={currentPrioritySession ? `/calendar?focus=${currentPrioritySession.id}` : "/calendar"} className="btn-primary px-3 py-1.5 text-xs">
              Open Calendar
            </Link>
            <Link href="/plan" className="btn-secondary px-3 py-1.5 text-xs">
              Open Plan
            </Link>
          </div>
        </article>
      </div>

      <WeeklyInterventionCard
        title={weekSummary.topIntervention.title}
        statusLine={weekSummary.topIntervention.statusLine}
        why={weekSummary.topIntervention.why}
        recommendedAction={weekSummary.topIntervention.recommendedAction}
        impactIfIgnored={weekSummary.topIntervention.impactIfIgnored}
        href={weekSummary.topIntervention.href}
      />
    </section>
  );
}
