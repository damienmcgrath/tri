import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachAuthContext } from "@/lib/coach/types";
import {
  coachToolSchemas,
  type CoachToolName
} from "@/lib/coach/tools";
import { logCoachAudit } from "@/lib/coach/audit";

type ToolDeps = {
  supabase: SupabaseClient;
  ctx: CoachAuthContext;
};

function addDays(date: Date, days: number) {
  const clone = new Date(date);
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function derivePace(durationSec: number | null | undefined, distanceM: number | null | undefined) {
  if (!durationSec || !distanceM || durationSec <= 0 || distanceM <= 0) {
    return { avgPaceSecPerKm: null, avgPaceSecPer100m: null };
  }

  return {
    avgPaceSecPerKm: Number((durationSec / (distanceM / 1000)).toFixed(2)),
    avgPaceSecPer100m: Number((durationSec / (distanceM / 100)).toFixed(2))
  };
}

async function getAthleteSnapshot({ supabase, ctx }: ToolDeps) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name,race_name,race_date")
    .eq("id", ctx.athleteId)
    .maybeSingle();

  const { data: activePlan } = await supabase
    .from("training_plans")
    .select("id,name,start_date,duration_weeks")
    .eq("athlete_id", ctx.athleteId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    athlete: {
      displayName: profile?.display_name ?? null,
      raceName: profile?.race_name ?? null,
      raceDate: profile?.race_date ?? null
    },
    activePlan: activePlan
      ? {
        id: activePlan.id,
        name: activePlan.name,
        startDate: activePlan.start_date,
        durationWeeks: activePlan.duration_weeks
      }
      : null
  };
}

async function getRecentSessions(args: unknown, deps: ToolDeps) {
  const parsed = coachToolSchemas.get_recent_sessions.parse(args);
  const since = isoDate(addDays(new Date(), -parsed.daysBack));
  const today = isoDate(new Date());
  const sinceUtc = `${since}T00:00:00.000Z`;
  const todayUtc = `${today}T23:59:59.999Z`;

  const { data: completed, error: completedError } = await deps.supabase
    .from("completed_sessions")
    .select("id,date,sport,metrics")
    .eq("athlete_id", deps.ctx.athleteId)
    .gte("date", since)
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(20);

  if (completedError) {
    throw new Error(`get_recent_sessions completed query failed: ${completedError.message}`);
  }

  const { data: uploadedActivities, error: uploadedActivitiesError } = await deps.supabase
    .from("completed_activities")
    .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,calories,parse_summary")
    .eq("user_id", deps.ctx.userId)
    .gte("start_time_utc", sinceUtc)
    .lte("start_time_utc", todayUtc)
    .order("start_time_utc", { ascending: false })
    .limit(20);

  if (uploadedActivitiesError) {
    throw new Error(`get_recent_sessions uploaded activities query failed: ${uploadedActivitiesError.message}`);
  }

  const { data: planned } = await deps.supabase
    .from("sessions")
    .select("id,date,sport,type,duration_minutes,status")
    .eq("athlete_id", deps.ctx.athleteId)
    .gte("date", since)
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(20);

  const uploadedActivitiesRealData = (uploadedActivities ?? []).map((activity) => {
    const activityDate = activity.start_time_utc.slice(0, 10);

    const parseSummary = typeof activity.parse_summary === "object" && activity.parse_summary
      ? activity.parse_summary as Record<string, unknown>
      : null;
    const movingDurationSec = Number(parseSummary?.movingDurationSec ?? parseSummary?.moving_duration_sec ?? 0);
    const elapsedDurationSec = Number(parseSummary?.elapsedDurationSec ?? parseSummary?.elapsed_duration_sec ?? activity.duration_sec ?? 0);
    const poolLengthMeters = Number(parseSummary?.poolLengthMeters ?? parseSummary?.pool_length_meters ?? 0);

    const durationSec = activity.duration_sec ? Number(activity.duration_sec) : null;
    const distanceMeters = activity.distance_m ? Number(activity.distance_m) : null;
    const pace = derivePace(durationSec, distanceMeters);

    return {
      id: `activity:${activity.id}`,
      source: "uploaded_activity" as const,
      date: activityDate,
      sport: activity.sport_type,
      durationMinutes: durationSec ? Math.round(durationSec / 60) : null,
      distanceMeters,
      avgHr: activity.avg_hr ?? null,
      avgPower: activity.avg_power ?? null,
      calories: activity.calories ?? null,
      parseSummary: activity.parse_summary ?? null,
      avgPaceSecPerKm: pace.avgPaceSecPerKm,
      avgPaceSecPer100m: pace.avgPaceSecPer100m,
    };
  });

  return {
    range: { since, until: today },
    completed: [
      ...(completed ?? []).map((session) => {
        const durationMinutes = typeof session.metrics === "object" && session.metrics && "duration" in session.metrics
          ? Number((session.metrics as { duration?: number }).duration ?? 0)
          : null;
        const distanceMeters = typeof session.metrics === "object" && session.metrics && "distance" in session.metrics
          ? Number((session.metrics as { distance?: number }).distance ?? 0)
          : null;
        const pace = derivePace(durationMinutes ? durationMinutes * 60 : null, distanceMeters);

        return {
          id: session.id,
          date: session.date,
          sport: session.sport,
          durationMinutes,
          distanceMeters,
          avgHr: typeof session.metrics === "object" && session.metrics && "avg_hr" in session.metrics
            ? Number((session.metrics as { avg_hr?: number }).avg_hr ?? 0)
            : null,
          avgPower: typeof session.metrics === "object" && session.metrics && "avg_power" in session.metrics
            ? Number((session.metrics as { avg_power?: number }).avg_power ?? 0)
            : null,
          calories: typeof session.metrics === "object" && session.metrics && "calories" in session.metrics
            ? Number((session.metrics as { calories?: number }).calories ?? 0)
            : null,
          parseSummary: typeof session.metrics === "object" && session.metrics && "parse_summary" in session.metrics
            ? (session.metrics as { parse_summary?: unknown }).parse_summary ?? null
            : null,
          avgPaceSecPerKm: pace.avgPaceSecPerKm,
          avgPaceSecPer100m: pace.avgPaceSecPer100m,
          source: "legacy"
        };
      }),
      ...uploadedActivitiesRealData
    ],
    planned: (planned ?? []).map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      type: session.type,
      durationMinutes: session.duration_minutes,
      status: session.status
    }))
  };
}

async function getUpcomingSessions(args: unknown, deps: ToolDeps) {
  const parsed = coachToolSchemas.get_upcoming_sessions.parse(args);
  const today = isoDate(new Date());
  const until = isoDate(addDays(new Date(), parsed.daysAhead));

  const { data, error } = await deps.supabase
    .from("sessions")
    .select("id,date,sport,type,duration_minutes,status,notes")
    .eq("athlete_id", deps.ctx.athleteId)
    .gte("date", today)
    .lte("date", until)
    .order("date", { ascending: true })
    .limit(25);

  if (error) {
    throw new Error(`get_upcoming_sessions query failed: ${error.message}`);
  }

  return {
    range: { from: today, to: until },
    sessions: (data ?? []).map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      type: session.type,
      durationMinutes: session.duration_minutes,
      status: session.status,
      notes: session.notes ?? null
    }))
  };
}

async function getWeekProgress({ supabase, ctx }: ToolDeps) {
  const now = new Date();
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = isoDate(addDays(now, mondayOffset));
  const weekEnd = isoDate(addDays(now, mondayOffset + 6));

  const { data: planned, error: plannedError } = await supabase
    .from("sessions")
    .select("id,status,duration_minutes")
    .eq("athlete_id", ctx.athleteId)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  if (plannedError) {
    throw new Error(`get_week_progress planned query failed: ${plannedError.message}`);
  }

  const { data: completed, error: completedError } = await supabase
    .from("completed_sessions")
    .select("id")
    .eq("athlete_id", ctx.athleteId)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  if (completedError) {
    throw new Error(`get_week_progress completed query failed: ${completedError.message}`);
  }

  const plannedMinutes = (planned ?? []).reduce((sum, row) => sum + (row.duration_minutes ?? 0), 0);

  return {
    weekStart,
    weekEnd,
    plannedSessionCount: planned?.length ?? 0,
    completedSessionCount: completed?.length ?? 0,
    plannedMinutes,
    completionRatio: planned && planned.length > 0 ? Number(((completed?.length ?? 0) / planned.length).toFixed(2)) : null
  };
}

async function createPlanChangeProposal(args: unknown, deps: ToolDeps) {
  const parsed = coachToolSchemas.create_plan_change_proposal.parse(args);

  if (parsed.targetSessionId) {
    const { data: targetSession, error } = await deps.supabase
      .from("sessions")
      .select("id")
      .eq("id", parsed.targetSessionId)
      .eq("athlete_id", deps.ctx.athleteId)
      .maybeSingle();

    if (error) {
      throw new Error(`create_plan_change_proposal target lookup failed: ${error.message}`);
    }

    if (!targetSession) {
      throw new Error("create_plan_change_proposal target session not owned by current athlete.");
    }
  }

  const { data, error } = await deps.supabase
    .from("coach_plan_change_proposals")
    .insert({
      athlete_id: deps.ctx.athleteId,
      user_id: deps.ctx.userId,
      title: parsed.title,
      rationale: parsed.rationale,
      target_session_id: parsed.targetSessionId ?? null,
      proposed_date: parsed.proposedDate ?? null,
      proposed_duration_minutes: parsed.proposedDurationMinutes ?? null,
      change_summary: parsed.changeSummary,
      status: "pending"
    })
    .select("id,title,rationale,status,proposed_date,proposed_duration_minutes")
    .single();

  if (error || !data) {
    throw new Error(`create_plan_change_proposal insert failed: ${error?.message ?? "unknown"}`);
  }

  logCoachAudit("info", "coach.proposal.created", {
    ctx: deps.ctx,
    toolName: "create_plan_change_proposal",
    success: true,
    proposalId: data.id
  });

  return {
    id: data.id,
    title: data.title,
    rationale: data.rationale,
    status: data.status,
    proposedDate: data.proposed_date,
    proposedDurationMinutes: data.proposed_duration_minutes
  };
}

export async function executeCoachTool(name: CoachToolName, args: unknown, deps: ToolDeps) {
  logCoachAudit("info", "coach.tool.execute", {
    ctx: deps.ctx,
    toolName: name,
    args
  });

  try {
    let result: unknown;

    switch (name) {
      case "get_athlete_snapshot":
        coachToolSchemas.get_athlete_snapshot.parse(args);
        result = await getAthleteSnapshot(deps);
        break;
      case "get_recent_sessions":
        result = await getRecentSessions(args, deps);
        break;
      case "get_upcoming_sessions":
        result = await getUpcomingSessions(args, deps);
        break;
      case "get_week_progress":
        coachToolSchemas.get_week_progress.parse(args);
        result = await getWeekProgress(deps);
        break;
      case "create_plan_change_proposal":
        result = await createPlanChangeProposal(args, deps);
        break;
      default:
        throw new Error(`Unsupported tool: ${String(name)}`);
    }

    logCoachAudit("info", "coach.tool.success", {
      ctx: deps.ctx,
      toolName: name,
      success: true,
      resultCount: Array.isArray(result) ? result.length : undefined
    });

    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown tool error";

    logCoachAudit("warn", "coach.tool.failure", {
      ctx: deps.ctx,
      toolName: name,
      success: false,
      reason,
      args
    });

    throw error;
  }
}
