import { createClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/date/iso";
import { WeekCalendar } from "./week-calendar";
import { computeWeekMinuteTotals, computeWeekSessionCounts } from "@/lib/training/week-metrics";
import { buildCalendarDisplayItems } from "@/lib/calendar/day-items";
import { getSessionDisplayName } from "@/lib/training/session";
import type { SessionLifecycleState } from "@/lib/training/semantics";

type Session = {
  id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  discipline?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  intent_category?: string | null;
  session_role?: "key" | "supporting" | "recovery" | "optional" | "Key" | "Supporting" | "Recovery" | "Optional" | null;
  source_metadata?: { uploadId?: string | null; assignmentId?: string | null; assignedBy?: "planner" | "upload" | "coach" | null } | null;
  execution_result?: { status?: "matched_intent" | "partial_intent" | "missed_intent" | null; summary?: string | null; executionScore?: number | null; execution_score?: number | null; executionScoreBand?: string | null; execution_score_band?: string | null; executionScoreSummary?: string | null; recommendedNextAction?: string | null; recommended_next_action?: string | null; executionScoreProvisional?: boolean | null; execution_score_provisional?: boolean | null } | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  status?: SessionLifecycleState;
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

type CalendarActivityRow = {
  id: string;
  upload_id: string | null;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  schedule_status: string;
  is_unplanned: boolean;
};

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function isMissingActivityColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703" || /(schedule_status|is_unplanned|schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

async function loadCalendarActivities(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  weekStart: string;
  weekEnd: string;
}): Promise<CalendarActivityRow[]> {
  const { supabase, userId, weekStart, weekEnd } = params;
  const rangeStart = `${addDays(weekStart, -1)}T00:00:00.000Z`;
  const rangeEnd = `${addDays(weekEnd, 1)}T00:00:00.000Z`;

  const selectVariants = [
    "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned",
    "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,notes",
    "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,is_unplanned,notes",
    "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,notes",
    "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,notes",
    "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power"
  ] as const;

  let lastError: { code?: string; message?: string } | null = null;

  for (const selectClause of selectVariants) {
    const query = await supabase
      .from("completed_activities")
      .select(selectClause)
      .eq("user_id", userId)
      .gte("start_time_utc", rangeStart)
      .lt("start_time_utc", rangeEnd);

    if (!query.error) {
      return ((query.data ?? []) as unknown as Array<Record<string, unknown>>).map((activity) => ({
        id: String(activity.id),
        upload_id: typeof activity.upload_id === "string" ? activity.upload_id : null,
        sport_type: String(activity.sport_type),
        start_time_utc: String(activity.start_time_utc),
        duration_sec: typeof activity.duration_sec === "number" ? activity.duration_sec : null,
        distance_m: typeof activity.distance_m === "number" ? activity.distance_m : null,
        avg_hr: typeof activity.avg_hr === "number" ? activity.avg_hr : null,
        avg_power: typeof activity.avg_power === "number" ? activity.avg_power : null,
        schedule_status: typeof activity.schedule_status === "string" ? activity.schedule_status : "unscheduled",
        is_unplanned: typeof activity.is_unplanned === "boolean" ? activity.is_unplanned : false
      }));
    }

    lastError = query.error;
    if (!isMissingActivityColumnError(query.error)) {
      break;
    }
  }

  throw new Error(lastError?.message ?? "Failed to load uploaded activities for calendar.");
}

async function loadUploadStatuses(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  uploadIds: string[];
}) {
  const { supabase, userId, uploadIds } = params;
  if (uploadIds.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("activity_uploads")
    .select("id,status")
    .eq("user_id", userId)
    .in("id", uploadIds);

  if (error) {
    throw new Error(error.message ?? "Failed to load upload statuses for calendar.");
  }

  return new Map((data ?? []).map((upload: { id: string; status: string }) => [upload.id, upload.status]));
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
      .select("id,date,sport,type,session_name,discipline,subtype,workout_type,duration_minutes,intent_category,session_role,source_metadata,execution_result,notes,created_at,status,is_key")
      .eq("user_id", user.id)
      .gte("date", weekStart)
      .lt("date", weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });

    sessionData = query.data as unknown[] | null;
    sessionError = query.error;

    const isMissingColumnError =
      sessionError?.code === "42703" ||
      /(is_key|session_name|status|schema cache|column .* does not exist|42703)/i.test(sessionError?.message ?? "");

    if (sessionError && sessionError.code !== "PGRST205" && isMissingColumnError) {
      const fallbackQuery = await supabase
        .from("sessions")
        .select("id,date,sport,type,duration_minutes,notes,created_at,status")
        .eq("user_id", user.id)
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
      is_key: false,
      session_name: null,
      discipline: session.sport,
      subtype: null,
      workout_type: null,
      intent_category: null,
      session_role: null,
      source_metadata: null,
      execution_result: null
    }));
  } else if (sessionError) {
    throw new Error(sessionError.message ?? "Failed to load calendar sessions.");
  }

  const activitiesData = await loadCalendarActivities({
    supabase,
    userId: user.id,
    weekStart,
    weekEnd
  });
  const uploadStatusById = await loadUploadStatuses({
    supabase,
    userId: user.id,
    uploadIds: activitiesData
      .map((activity) => (typeof (activity as { upload_id?: unknown }).upload_id === "string" ? (activity as { upload_id: string }).upload_id : null))
      .filter((uploadId): uploadId is string => Boolean(uploadId))
  });

  const [{ data: legacyCompleted }, { data: links }] = await Promise.all([
    supabase.from("completed_sessions").select("date,sport").gte("date", weekStart).lt("date", weekEnd),
    supabase
      .from("session_activity_links")
      .select("planned_session_id,completed_activity_id,confirmation_status")
      .eq("user_id", user.id)
  ]);

  const timeZone =
    (user.user_metadata && typeof user.user_metadata.timezone === "string" && user.user_metadata.timezone) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";

  const sessions = buildCalendarDisplayItems({
    sessions: normalizedSessions,
    activities: activitiesData.map((activity) => ({
      ...activity,
      upload_status:
        typeof activity.upload_id === "string"
          ? (uploadStatusById.get(activity.upload_id) ?? "parsed")
          : "parsed"
    })) as any[],
    links: (links ?? []) as any[],
    legacyCompleted: (legacyCompleted ?? []) as Array<{ date: string; sport: string }>,
    timeZone,
    weekStart,
    weekEndExclusive: weekEnd
  });

  const plannedSessions = sessions.filter((item) => item.displayType === "planned_session");
  const unmatchedUploadCount = sessions.filter((item) => item.displayType === "completed_activity" && !item.isUnplanned).length;
  const extraActivityCount = sessions.filter((item) => item.displayType === "completed_activity" && item.isUnplanned).length;
  const plannedSessionCount = plannedSessions.length;

  const countMetrics = computeWeekSessionCounts(
    plannedSessions.map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      durationMinutes: session.duration,
      status: session.status,
      isKey: session.is_key
    }))
  );
  const minuteMetrics = computeWeekMinuteTotals(
    plannedSessions.map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      durationMinutes: session.duration,
      status: session.status,
      isKey: session.is_key
    }))
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextTodaySession = sessions.find((session) => session.date === todayIso && session.status === "planned") ?? null;


  return (
    <section className="space-y-3">
      <WeekCalendar
        weekDays={weekDays}
        sessions={sessions}
        executionLabel={nextTodaySession ? `Next key session: ${getSessionDisplayName(nextTodaySession)}` : plannedSessionCount > 0 ? "No planned session today" : "No planned sessions this week yet"}
        executionSubtext={unmatchedUploadCount > 0
          ? `${unmatchedUploadCount} upload${unmatchedUploadCount > 1 ? "s" : ""} not matched yet — keep them as extra work or assign them to a planned session.`
          : plannedSessionCount === 0
            ? "Start by adding 1–2 sessions so uploads have clear matching targets."
            : "Uploads and schedule aligned"}
        completedCount={countMetrics.completedCount}
        plannedTotalCount={countMetrics.plannedTotalCount}
        skippedCount={countMetrics.skippedCount}
        extraSessionCount={extraActivityCount}
        plannedRemainingCount={countMetrics.plannedRemainingCount}
        plannedMinutes={minuteMetrics.plannedMinutes}
        completedMinutes={minuteMetrics.completedMinutes}
        remainingMinutes={minuteMetrics.remainingMinutes}
      />
    </section>
  );
}
