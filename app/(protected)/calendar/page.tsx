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

type CompletedSession = {
  date: string;
  sport: string;
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
  const weekStart = isValidIsoDate(searchParams?.weekStart)
    ? searchParams.weekStart
    : currentWeekStart;
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

  const { data: completedData, error: completedError } = await supabase
    .from("completed_sessions")
    .select("date,sport")
    .gte("date", weekStart)
    .lt("date", weekEnd);

  if (completedError && completedError.code !== "PGRST205") {
    throw new Error(completedError.message ?? "Failed to load completed sessions.");
  }

  const completionLedger = ((completedData ?? []) as CompletedSession[]).reduce<Record<string, number>>((acc, item) => {
    const key = `${item.date}:${item.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const sessions = normalizedSessions.map((session) => ({
    id: session.id,
    date: session.date,
    sport: session.sport,
    type: session.type,
    duration: session.duration_minutes ?? 0,
    notes: session.notes,
    created_at: session.created_at,
    status: getSessionStatus(session, completionLedger)
  }));

  const raceDate = process.env.NEXT_PUBLIC_RACE_DATE;
  const raceCountdown = raceDate
    ? Math.max(0, Math.ceil((new Date(`${raceDate}T00:00:00.000Z`).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return <WeekCalendar weekDays={weekDays} sessions={sessions} weekStart={weekStart} isCurrentWeek={weekStart === currentWeekStart} raceCountdown={raceCountdown} />;
}
