import { createClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/date/iso";
import { WeekCalendar } from "./week-calendar";

type Session = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  status?: "planned" | "completed" | "skipped";
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

type CompletedItem = {
  id: string;
  date: string;
  sport: string;
  duration_min: number;
  distance_km: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  linked_session_id?: string;
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

function getSessionStatus(session: Pick<Session, "date" | "sport" | "notes" | "status">, completionLedger: Record<string, number>) {
  if (session.status) {
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

export default async function CalendarPage({ searchParams }: { searchParams?: { weekStart?: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const currentWeekStart = getMonday().toISOString().slice(0, 10);
  const weekStart = isValidIsoDate(searchParams?.weekStart) ? searchParams.weekStart : currentWeekStart;
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

  const { data: sessionData, error: sessionError } = await supabase
    .from("sessions")
    .select("id,date,sport,type,duration_minutes,notes,created_at,status")
    .gte("date", weekStart)
    .lt("date", weekEnd)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });

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
      status: undefined
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
      .gte("start_time_utc", `${weekStart}T00:00:00.000Z`)
      .lt("start_time_utc", `${weekEnd}T00:00:00.000Z`),
    supabase
      .from("session_activity_links")
      .select("planned_session_id,completed_activity_id")
      .eq("user_id", user.id)
  ]);

  const activityById = new Map<string, CompletedItem>();
  (activities ?? []).forEach((activity: any) => {
    activityById.set(activity.id, {
      id: activity.id,
      date: String(activity.start_time_utc).slice(0, 10),
      sport: activity.sport_type,
      duration_min: Math.round(Number(activity.duration_sec ?? 0) / 60),
      distance_km: activity.distance_m ? Number(activity.distance_m) / 1000 : null,
      avg_hr: activity.avg_hr,
      avg_power: activity.avg_power
    });
  });

  const linkedBySession = new Map<string, CompletedItem[]>();
  const linkedActivityIds = new Set<string>();
  (links ?? []).forEach((link: any) => {
    const activity = activityById.get(link.completed_activity_id);
    if (!activity) return;
    linkedActivityIds.add(activity.id);
    const list = linkedBySession.get(link.planned_session_id) ?? [];
    list.push({ ...activity, linked_session_id: link.planned_session_id });
    linkedBySession.set(link.planned_session_id, list);
  });

  const unassignedByDate = new Map<string, number>();
  [...activityById.values()]
    .filter((item) => !linkedActivityIds.has(item.id))
    .forEach((item) => {
      unassignedByDate.set(item.date, (unassignedByDate.get(item.date) ?? 0) + 1);
    });

  const completionLedger = ((legacyCompleted ?? []) as Array<{ date: string; sport: string }>).reduce<Record<string, number>>((acc, item) => {
    const key = `${item.date}:${item.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  for (const activity of activityById.values()) {
    const key = `${activity.date}:${activity.sport}`;
    completionLedger[key] = (completionLedger[key] ?? 0) + 1;
  }

  const sessions = normalizedSessions.map((session) => {
    const linked = linkedBySession.get(session.id) ?? [];
    const linkedStats = linked[0]
      ? {
          durationMin: linked.reduce((sum, item) => sum + item.duration_min, 0),
          distanceKm: linked.reduce((sum, item) => sum + (item.distance_km ?? 0), 0),
          avgHr: linked[0].avg_hr,
          avgPower: linked[0].avg_power
        }
      : null;

    return {
      id: session.id,
      date: session.date,
      sport: session.sport,
      type: session.type,
      duration: session.duration_minutes ?? 0,
      notes: session.notes,
      created_at: session.created_at,
      status: linked.length > 0 ? ("completed" as const) : getSessionStatus(session, completionLedger),
      linkedActivityCount: linked.length,
      linkedStats,
      unassignedSameDayCount: linked.length > 0 ? 0 : (unassignedByDate.get(session.date) ?? 0)
    };
  });

  const raceDate = process.env.NEXT_PUBLIC_RACE_DATE;
  const raceCountdown = raceDate
    ? Math.max(0, Math.ceil((new Date(`${raceDate}T00:00:00.000Z`).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <WeekCalendar
      weekDays={weekDays}
      sessions={sessions}
      weekStart={weekStart}
      isCurrentWeek={weekStart === currentWeekStart}
      raceCountdown={raceCountdown}
    />
  );
}
