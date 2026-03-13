import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnoseCompletedSession, type PlannedTargetBand, type SessionDiagnosis, type SessionDiagnosisInput, type SplitMetrics } from "@/lib/coach/session-diagnosis";

type SessionExecutionSessionRow = {
  id: string;
  user_id: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  target?: string | null;
  intent_category?: string | null;
  status?: "planned" | "completed" | "skipped" | null;
};

type SessionExecutionActivityRow = {
  id: string;
  sport_type: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec?: number | null;
  laps_count?: number | null;
  parse_summary?: Record<string, unknown> | null;
  metrics_v2?: Record<string, unknown> | null;
};

type PersistedExecutionResult = SessionDiagnosis & {
  status: SessionDiagnosis["intentMatchStatus"];
  summary: string;
  suggestedWeekAdjustment: string;
  linkedActivityId: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getNumber(source: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function getNestedNumber(sources: Array<Record<string, unknown> | null | undefined>, keyPaths: string[][]) {
  for (const source of sources) {
    for (const path of keyPaths) {
      let cursor: unknown = source;
      for (const key of path) {
        if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(key in cursor)) {
          cursor = null;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[key];
      }
      if (typeof cursor === "number" && Number.isFinite(cursor)) return cursor;
    }
  }
  return null;
}

function parsePlannedIntervals(text: string | null | undefined) {
  if (!text) return null;
  const normalized = text.toLowerCase();
  const xMatch = normalized.match(/\b(\d{1,2})\s*x\s*\d/);
  if (xMatch) return Number(xMatch[1]);
  const repsMatch = normalized.match(/\b(\d{1,2})\s*(reps|intervals|laps)\b/);
  if (repsMatch) return Number(repsMatch[1]);
  return null;
}

function parseTargetBands(text: string | null | undefined): PlannedTargetBand | null {
  if (!text) return null;
  const targetBands: PlannedTargetBand = {};
  const normalized = text.toLowerCase();

  const hrRange = normalized.match(/(?:hr|heart rate)?\s*(\d{2,3})\s*[-–]\s*(\d{2,3})\s*bpm?/i);
  if (hrRange) {
    targetBands.hr = { min: Number(hrRange[1]), max: Number(hrRange[2]) };
  }

  const powerRange = normalized.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})\s*w\b/i);
  if (powerRange) {
    targetBands.power = { min: Number(powerRange[1]), max: Number(powerRange[2]) };
  }

  return Object.keys(targetBands).length > 0 ? targetBands : null;
}

function deriveAvgPaceSecPerKm(activity: SessionExecutionActivityRow) {
  if (activity.sport_type === "swim") return null;
  const parseSummary = asRecord(activity.parse_summary);
  const parsedPace = getNumber(parseSummary, ["avgPaceSecPerKm", "avg_pace_sec_per_km"]);
  if (parsedPace !== null) return parsedPace;
  if (!activity.duration_sec || !activity.distance_m || activity.distance_m <= 0) return null;
  return Number((activity.duration_sec / (activity.distance_m / 1000)).toFixed(2));
}

function deriveWeekAdjustment(diagnosis: SessionDiagnosis) {
  if (diagnosis.intentMatchStatus === "matched_intent") {
    return "Keep the next key session as planned and use the same execution approach.";
  }

  if (diagnosis.recommendedNextAction.toLowerCase().includes("easy") || diagnosis.whyItMatters.toLowerCase().includes("fatigue")) {
    return "Keep the week steady and protect recovery before adding more intensity.";
  }

  if (diagnosis.recommendedNextAction.toLowerCase().includes("repeat")) {
    return "Repeat the intent before progressing the load, and keep the rest of the week as planned.";
  }

  return "Keep the rest of the week stable and focus on executing the next similar session more cleanly.";
}

function extractSplitMetrics(activity: SessionExecutionActivityRow): SplitMetrics | null {
  const metrics = asRecord(activity.metrics_v2);
  const parseSummary = asRecord(activity.parse_summary);
  const splits = asRecord(metrics?.splits);
  const halves = asRecord(metrics?.halves);
  const sources = [splits, halves, metrics, parseSummary];

  const firstHalfAvgHr = getNestedNumber(sources, [["firstHalfAvgHr"], ["first_half_avg_hr"], ["firstHalf", "avgHr"], ["first_half", "avg_hr"]]);
  const lastHalfAvgHr = getNestedNumber(sources, [["lastHalfAvgHr"], ["last_half_avg_hr"], ["lastHalf", "avgHr"], ["last_half", "avg_hr"]]);
  const firstHalfAvgPower = getNestedNumber(sources, [["firstHalfAvgPower"], ["first_half_avg_power"], ["firstHalf", "avgPower"], ["first_half", "avg_power"]]);
  const lastHalfAvgPower = getNestedNumber(sources, [["lastHalfAvgPower"], ["last_half_avg_power"], ["lastHalf", "avgPower"], ["last_half", "avg_power"]]);
  const firstHalfPaceSPerKm = getNestedNumber(sources, [["firstHalfPaceSPerKm"], ["first_half_pace_s_per_km"], ["firstHalf", "avgPaceSecPerKm"], ["first_half", "avg_pace_sec_per_km"]]);
  const lastHalfPaceSPerKm = getNestedNumber(sources, [["lastHalfPaceSPerKm"], ["last_half_pace_s_per_km"], ["lastHalf", "avgPaceSecPerKm"], ["last_half", "avg_pace_sec_per_km"]]);

  const splitMetrics: SplitMetrics = {};
  if (firstHalfAvgHr !== null) splitMetrics.firstHalfAvgHr = firstHalfAvgHr;
  if (lastHalfAvgHr !== null) splitMetrics.lastHalfAvgHr = lastHalfAvgHr;
  if (firstHalfAvgPower !== null) splitMetrics.firstHalfAvgPower = firstHalfAvgPower;
  if (lastHalfAvgPower !== null) splitMetrics.lastHalfAvgPower = lastHalfAvgPower;
  if (firstHalfPaceSPerKm !== null) splitMetrics.firstHalfPaceSPerKm = firstHalfPaceSPerKm;
  if (lastHalfPaceSPerKm !== null) splitMetrics.lastHalfPaceSPerKm = lastHalfPaceSPerKm;

  return Object.keys(splitMetrics).length > 0 ? splitMetrics : null;
}

function buildDiagnosisInput(session: SessionExecutionSessionRow, activity: SessionExecutionActivityRow): SessionDiagnosisInput {
  const metrics = asRecord(activity.metrics_v2);
  const parseSummary = asRecord(activity.parse_summary);
  const plannedIntervals = parsePlannedIntervals(session.target ?? session.type);

  const intervalCompletionPct =
    getNumber(metrics, ["intervalCompletionPct", "interval_completion_pct"]) ??
    getNumber(parseSummary, ["intervalCompletionPct", "interval_completion_pct"]) ??
    (plannedIntervals && activity.laps_count ? Number((Math.min(1, activity.laps_count / plannedIntervals)).toFixed(2)) : null);

  const timeAboveTargetPct =
    getNumber(metrics, ["timeAboveTargetPct", "time_above_target_pct"]) ??
    getNestedNumber([metrics], [["intensity", "timeAboveTargetPct"], ["intensity", "time_above_target_pct"]]);

  const variabilityIndex =
    getNumber(metrics, ["variabilityIndex", "variability_index"]) ??
    getNestedNumber([metrics], [["power", "variabilityIndex"], ["power", "variability_index"]]);

  return {
    planned: {
      sport: (session.sport as SessionDiagnosisInput["planned"]["sport"]) ?? "other",
      plannedDurationSec: session.duration_minutes ? session.duration_minutes * 60 : null,
      intentCategory: session.intent_category ?? session.type,
      targetBands: parseTargetBands(session.target),
      plannedIntervals
    },
    actual: {
      durationSec: activity.duration_sec,
      avgHr: activity.avg_hr,
      avgPower: activity.avg_power,
      avgPaceSPerKm: deriveAvgPaceSecPerKm(activity),
      variabilityIndex,
      timeAboveTargetPct,
      intervalCompletionPct,
      completedIntervals: activity.laps_count ?? null,
      splitMetrics: extractSplitMetrics(activity),
      metrics: {
        avg_hr: activity.avg_hr ?? null,
        avg_power: activity.avg_power ?? null
      }
    }
  };
}

export function buildExecutionResultForSession(session: SessionExecutionSessionRow, activity: SessionExecutionActivityRow): PersistedExecutionResult {
  const diagnosis = diagnoseCompletedSession(buildDiagnosisInput(session, activity));

  return {
    ...diagnosis,
    status: diagnosis.intentMatchStatus,
    summary: diagnosis.executionScoreSummary,
    suggestedWeekAdjustment: deriveWeekAdjustment(diagnosis),
    linkedActivityId: activity.id
  };
}

async function loadSessionAndActivity(supabase: SupabaseClient, userId: string, sessionId: string, activityId: string) {
  const [{ data: session, error: sessionError }, { data: activity, error: activityError }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id,user_id,sport,type,duration_minutes,target,intent_category,status")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("completed_activities")
      .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
      .eq("id", activityId)
      .eq("user_id", userId)
      .maybeSingle()
  ]);

  if (sessionError) throw new Error(sessionError.message);
  if (activityError) throw new Error(activityError.message);
  if (!session) throw new Error("Session not found while syncing execution result.");
  if (!activity) throw new Error("Activity not found while syncing execution result.");

  return {
    session: session as SessionExecutionSessionRow,
    activity: activity as SessionExecutionActivityRow
  };
}

export async function syncSessionExecutionFromActivityLink(args: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  activityId: string;
}) {
  const { session, activity } = await loadSessionAndActivity(args.supabase, args.userId, args.sessionId, args.activityId);
  const executionResult = buildExecutionResultForSession(session, activity);

  const { error } = await args.supabase
    .from("sessions")
    .update({
      status: "completed",
      execution_result: executionResult
    })
    .eq("id", session.id)
    .eq("user_id", args.userId);

  if (error) throw new Error(error.message);

  return executionResult;
}

export async function syncSessionExecutionAfterUnlink(args: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
}) {
  const { data: links, error: linkError } = await args.supabase
    .from("session_activity_links")
    .select("completed_activity_id,confirmation_status,created_at")
    .eq("planned_session_id", args.sessionId)
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (linkError) throw new Error(linkError.message);

  const confirmedLink = (links ?? []).find((link) => link.completed_activity_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null));

  if (confirmedLink?.completed_activity_id) {
    return syncSessionExecutionFromActivityLink({
      supabase: args.supabase,
      userId: args.userId,
      sessionId: args.sessionId,
      activityId: confirmedLink.completed_activity_id
    });
  }

  const { error: clearError } = await args.supabase
    .from("sessions")
    .update({
      status: "planned",
      execution_result: null
    })
    .eq("id", args.sessionId)
    .eq("user_id", args.userId);

  if (clearError) throw new Error(clearError.message);

  return null;
}

export async function backfillPendingSessionExecutions(args: {
  supabase: SupabaseClient;
  userId: string;
  limit?: number;
}) {
  const { data: links, error: linkError } = await args.supabase
    .from("session_activity_links")
    .select("planned_session_id,completed_activity_id,confirmation_status,created_at")
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false });

  if (linkError) throw new Error(linkError.message);

  const confirmedLinks = (links ?? []).filter(
    (link) => link.planned_session_id && link.completed_activity_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null)
  );

  if (confirmedLinks.length === 0) {
    return { updated: 0, attempted: 0 };
  }

  const sessionIds = [...new Set(confirmedLinks.map((link) => link.planned_session_id as string))];
  const { data: sessions, error: sessionError } = await args.supabase
    .from("sessions")
    .select("id,execution_result")
    .eq("user_id", args.userId)
    .in("id", sessionIds);

  if (sessionError) throw new Error(sessionError.message);

  const pendingSessionIds = new Set(
    ((sessions ?? []) as Array<{ id: string; execution_result?: Record<string, unknown> | null }>)
      .filter((session) => !session.execution_result)
      .map((session) => session.id)
  );

  const pendingLinks = confirmedLinks.filter((link) => pendingSessionIds.has(link.planned_session_id as string));
  const dedupedPendingLinks = [...new Map(pendingLinks.map((link) => [link.planned_session_id as string, link])).values()].slice(0, args.limit ?? 20);

  let updated = 0;
  for (const link of dedupedPendingLinks) {
    try {
      await syncSessionExecutionFromActivityLink({
        supabase: args.supabase,
        userId: args.userId,
        sessionId: link.planned_session_id as string,
        activityId: link.completed_activity_id as string
      });
      updated += 1;
    } catch {
      // Skip failed sessions so one bad row does not block the rest of the batch.
    }
  }

  return {
    updated,
    attempted: dedupedPendingLinks.length
  };
}
