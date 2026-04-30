import { createClient } from "@/lib/supabase/server";
import { isValidIsoDate } from "@/lib/date/iso";
import { WeekCalendar } from "./week-calendar";
import { CoachNoteCards } from "./components/coach-note-card";
import { computeWeekMinuteTotals, computeWeekSessionCounts } from "@/lib/training/week-metrics";
import { buildCalendarDisplayItems } from "@/lib/calendar/day-items";
import { loadCompletedActivities } from "@/lib/activities/completed-activities";
import { getSessionDisplayName } from "@/lib/training/session";
import { getBlockForDate } from "@/lib/training/race-profile";
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
  target?: string | null;
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
      .select("id,date,sport,type,session_name,discipline,subtype,workout_type,duration_minutes,intent_category,session_role,source_metadata,execution_result,notes,target,created_at,status,is_key")
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

  const activitiesData = await loadCompletedActivities({
    supabase,
    userId: user.id,
    rangeStart: `${addDays(weekStart, -1)}T00:00:00.000Z`,
    rangeEnd: `${addDays(weekEnd, 1)}T00:00:00.000Z`
  });
  const uploadStatusById = await loadUploadStatuses({
    supabase,
    userId: user.id,
    uploadIds: activitiesData
      .map((activity) => (typeof (activity as { upload_id?: unknown }).upload_id === "string" ? (activity as { upload_id: string }).upload_id : null))
      .filter((uploadId): uploadId is string => Boolean(uploadId))
  });

  const [{ data: legacyCompleted }, { data: links }, { data: pendingAdaptationsData }, { data: pendingRationalesData }] = await Promise.all([
    supabase.from("completed_sessions").select("date,sport").gte("date", weekStart).lt("date", weekEnd),
    supabase
      .from("session_activity_links")
      .select("planned_session_id,completed_activity_id,confirmation_status")
      .eq("user_id", user.id),
    supabase
      .from("adaptations")
      .select("id,trigger_type,options")
      .eq("athlete_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("adaptation_rationales")
      .select("id,trigger_type,rationale_text,changes_summary,preserved_elements,training_block,week_number,status,created_at")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5)
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
  const completedActivityItems = sessions.filter((item) => item.displayType === "completed_activity");
  const unmatchedUploadCount = sessions.filter((item) => item.displayType === "completed_activity" && !item.isUnplanned).length;
  const extraActivities = sessions.filter((item) => item.displayType === "completed_activity" && item.isUnplanned);
  const extraActivityCount = extraActivities.length;
  const plannedSessionCount = plannedSessions.length;

  const extraCompletionItems = extraActivities.map((activity) => ({
    id: activity.id,
    date: activity.date,
    sport: activity.sport,
    durationMinutes: activity.duration
  }));
  const countMetrics = computeWeekSessionCounts(
    plannedSessions.map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      durationMinutes: session.duration,
      status: session.status,
      isKey: session.is_key
    })),
    extraCompletionItems
  );
  const minuteMetrics = computeWeekMinuteTotals(
    plannedSessions.map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      durationMinutes: session.duration,
      status: session.status,
      isKey: session.is_key
    })),
    extraCompletionItems
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextTodaySession = sessions.find((session) => session.date === todayIso && session.status === "planned") ?? null;

  type AdaptationRow = { id: string; trigger_type: string; options: unknown };
  const pendingAdaptations = (pendingAdaptationsData ?? []) as AdaptationRow[];

  type ChangeItem = { session_id?: string | null; session_label: string; change_type: string; before: string; after: string };
  type RationaleRow = { id: string; trigger_type: string; rationale_text: string; changes_summary: ChangeItem[]; preserved_elements: string[] | null; training_block: string | null; week_number: number | null; status: string; created_at: string };
  const pendingRationales = (pendingRationalesData ?? []) as RationaleRow[];

  // Block context + race proximity
  let blockContextLine: string | null = null;
  let raceProximityLine: string | null = null;

  // Fetch active plan for block context
  const { data: profile } = await supabase
    .from("profiles")
    .select("active_plan_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.active_plan_id) {
    const { data: weekRow } = await supabase
      .from("training_weeks")
      .select("week_index,focus,block_id")
      .eq("plan_id", profile.active_plan_id)
      .lte("week_start_date", weekStart)
      .gte("week_start_date", addDays(weekStart, -6))
      .order("week_start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (weekRow?.block_id) {
      const [{ data: block }, { count: weekInBlockCount }] = await Promise.all([
        supabase
          .from("training_blocks")
          .select("name,block_type,sort_order")
          .eq("id", weekRow.block_id)
          .maybeSingle(),
        supabase
          .from("training_weeks")
          .select("id", { count: "exact", head: true })
          .eq("block_id", weekRow.block_id)
          .lte("week_start_date", weekStart)
      ]);

      if (block) {
        const blockNumber = (block.sort_order ?? 0) + 1;
        const blockLabel = block.name ?? block.block_type;
        const weekInBlock = typeof weekInBlockCount === "number" && weekInBlockCount > 0 ? weekInBlockCount : 1;
        blockContextLine = `Block ${blockNumber}: ${blockLabel} · Wk ${weekInBlock}`;
      }
    }
  }

  // Race proximity
  const { data: upcomingRaces } = await supabase
    .from("race_profiles")
    .select("name,date,distance_type,priority,course_profile")
    .eq("user_id", user.id)
    .gte("date", weekStart)
    .order("date", { ascending: true })
    .limit(3);

  const raceThisWeek = (upcomingRaces ?? []).find((r: { date: string }) => r.date >= weekStart && r.date <= addDays(weekStart, 6));
  const nextRace = (upcomingRaces ?? [])[0];

  if (nextRace && !raceThisWeek) {
    const daysToRace = Math.round((new Date(`${nextRace.date}T00:00:00Z`).getTime() - new Date(`${weekStart}T00:00:00Z`).getTime()) / 86400000);
    const weeksToRace = Math.round(daysToRace / 7);
    if (weeksToRace > 0 && weeksToRace <= 16) {
      raceProximityLine = `${weeksToRace} week${weeksToRace === 1 ? "" : "s"} to ${nextRace.name}`;
    }
  }

  // Taper detection for this week
  const currentBlock = await getBlockForDate(supabase, user.id, weekStart).catch(() => null);
  const isInTaper = currentBlock?.blockType === "Taper" || currentBlock?.blockType === "Race";

  // Build race distance string for display
  let raceDistanceLine: string | null = null;
  if (raceThisWeek) {
    const cp = ((raceThisWeek as any).course_profile ?? {}) as Record<string, unknown>;
    const parts: string[] = [];
    if (cp.swim_distance_m) parts.push(`${Number(cp.swim_distance_m) >= 1000 ? `${(Number(cp.swim_distance_m) / 1000).toFixed(1)}km` : `${cp.swim_distance_m}m`} swim`);
    if (cp.bike_distance_km) parts.push(`${cp.bike_distance_km}km bike`);
    if (cp.run_distance_km) parts.push(`${cp.run_distance_km}km run`);
    if (parts.length > 0) raceDistanceLine = parts.join(" / ");
  }

  return (
    <section className="space-y-3">
      {/* Block context header */}
      {(blockContextLine || raceProximityLine || raceThisWeek) ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[rgba(255,255,255,0.6)]">
          {blockContextLine ? <span>{blockContextLine}</span> : null}
          {blockContextLine && raceProximityLine ? <span className="text-[rgba(255,255,255,0.2)]">·</span> : null}
          {raceProximityLine ? <span className="text-cyan-400">{raceProximityLine}</span> : null}
        </div>
      ) : null}

      {/* Race marker for this week */}
      {raceThisWeek ? (
        <article className="rounded-xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.06)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🏁</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{raceThisWeek.name}</p>
              <p className="text-[11px] text-[rgba(255,255,255,0.6)]">
                {raceThisWeek.date} · {raceThisWeek.priority ?? "A"} Race{raceThisWeek.distance_type ? ` · ${raceThisWeek.distance_type}` : ""}
              </p>
              {raceDistanceLine ? (
                <p className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.5)]">{raceDistanceLine}</p>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-xs text-[rgba(255,255,255,0.72)]">Trust your training. Race smart.</p>
        </article>
      ) : null}

      {/* Taper context banner — show when in taper block but no race this specific week */}
      {isInTaper && !raceThisWeek ? (
        <div className="flex items-center gap-2 rounded-lg border border-[rgba(6,182,212,0.2)] bg-[rgba(6,182,212,0.04)] px-3 py-2 text-[11px] text-cyan-400">
          <span className="font-medium">Taper week</span>
          <span className="text-[rgba(255,255,255,0.4)]">·</span>
          <span className="text-[rgba(255,255,255,0.56)]">Sessions are about sharpness, not fitness building</span>
        </div>
      ) : null}

      <CoachNoteCards rationales={pendingRationales} />
      <WeekCalendar
        weekDays={weekDays}
        sessions={sessions}
        pendingAdaptations={pendingAdaptations}
        weekStart={weekStart}
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
