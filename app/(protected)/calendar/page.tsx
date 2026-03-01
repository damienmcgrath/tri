import { createClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/date/iso";
import { WeekCalendar } from "./week-calendar";
import { computeWeekMinuteTotals, computeWeekSessionCounts } from "@/lib/training/week-metrics";
import { buildCalendarDisplayItems } from "@/lib/calendar/day-items";

type Session = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  status?: "planned" | "completed" | "skipped";
  is_key?: boolean | null;
};

type LegacyPlannedSession = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration: number | null;
  notes: string | null;
  created_at: string;
};

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

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

export default async function CalendarPage({ searchParams }: { searchParams?: { weekStart?: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const weekStart = isValidIsoDate(searchParams?.weekStart) ? searchParams.weekStart : getMonday().toISOString().slice(0, 10);
  const weekEnd = addDays(weekStart, 7);

  const weekDays = Array.from({ length: 7 }).map((_, index) => {
    const iso = addDays(weekStart, index);
    const date = new Date(`${iso}T00:00:00.000Z`);
    return {
      iso,
      weekday: weekdayFormatter.format(date),
      label: dayFormatter.format(date)
    };
  });

  let sessionData: unknown[] | null = null;
  let sessionError: { code?: string; message?: string } | null = null;

  {
    const query = await supabase
      .from("sessions")
      .select("id,date,sport,type,duration_minutes,notes,created_at,status,is_key")
      .gte("date", weekStart)
      .lt("date", weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });

    sessionData = query.data as unknown[] | null;
    sessionError = query.error;

    if (sessionError && sessionError.code !== "PGRST205" && /(is_key|schema cache|42703)/i.test(sessionError.message ?? "")) {
      const fallbackQuery = await supabase
        .from("sessions")
        .select("id,date,sport,type,duration_minutes,notes,created_at,status")
        .gte("date", weekStart)
        .lt("date", weekEnd)
        .order("date", { ascending: true })
        .order("created_at", { ascending: true });

      sessionData = fallbackQuery.data as unknown[] | null;
      sessionError = fallbackQuery.error;
    }
  }

  let normalizedSessions = (sessionData ?? []) as Session[];

  if (sessionError?.code === "PGRST205") {
    const { data: plannedData, error: plannedError } = await supabase
      .from("planned_sessions")
      .select("id,date,sport,type,duration,notes,created_at")
      .gte("date", weekStart)
      .lt("date", weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });

    if (plannedError && plannedError.code !== "PGRST205") {
      throw new Error(plannedError.message ?? "Failed to load calendar sessions.");
    }

    normalizedSessions = ((plannedData ?? []) as LegacyPlannedSession[]).map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      type: session.type,
      duration_minutes: session.duration ?? 0,
      notes: session.notes,
      created_at: session.created_at,
      status: undefined,
      is_key: false
    }));
  } else if (sessionError) {
    throw new Error(sessionError.message ?? "Failed to load calendar sessions.");
  }

  const [{ data: legacyCompleted }, { data: activities }, { data: links }] = await Promise.all([
    supabase.from("completed_sessions").select("date,sport").gte("date", weekStart).lt("date", weekEnd),
    supabase
      .from("completed_activities")
      .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power")
      .eq("user_id", user.id)
      .gte("start_time_utc", `${addDays(weekStart, -1)}T00:00:00.000Z`)
      .lt("start_time_utc", `${addDays(weekEnd, 1)}T00:00:00.000Z`),
    supabase
      .from("session_activity_links")
      .select("planned_session_id,completed_activity_id")
      .eq("user_id", user.id)
  ]);

  const timeZone =
    (user.user_metadata && typeof user.user_metadata.timezone === "string" && user.user_metadata.timezone) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";

  const sessions = buildCalendarDisplayItems({
    sessions: normalizedSessions,
    activities: (activities ?? []) as any[],
    links: (links ?? []) as any[],
    legacyCompleted: (legacyCompleted ?? []) as Array<{ date: string; sport: string }>,
    timeZone,
    weekStart,
    weekEndExclusive: weekEnd
  });

  const countMetrics = computeWeekSessionCounts(
    sessions.map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      durationMinutes: session.duration,
      status: session.status,
      isKey: session.is_key
    }))
  );
  const minuteMetrics = computeWeekMinuteTotals(
    sessions.map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      durationMinutes: session.duration,
      status: session.status,
      isKey: session.is_key
    }))
  );
  const unmatchedUploads = sessions.filter((item) => item.displayType === "completed_activity").length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextTodaySession = sessions.find((session) => session.date === todayIso && session.status === "planned") ?? null;


  return (
    <section className="space-y-3">
      <WeekCalendar
        weekDays={weekDays}
        sessions={sessions}
        executionLabel={nextTodaySession ? `Next key session: ${nextTodaySession.type}` : "No planned session today"}
        executionSubtext={unmatchedUploads > 0 ? `${unmatchedUploads} uploads need matching.` : "Uploads and schedule aligned"}
        completedCount={countMetrics.completedCount}
        plannedTotalCount={countMetrics.plannedTotalCount}
        skippedCount={countMetrics.skippedCount}
        plannedRemainingCount={countMetrics.plannedRemainingCount}
        plannedMinutes={minuteMetrics.plannedMinutes}
        completedMinutes={minuteMetrics.completedMinutes}
        remainingMinutes={minuteMetrics.remainingMinutes}
      />
    </section>
  );
}
