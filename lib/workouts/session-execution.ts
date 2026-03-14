import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnoseCompletedSession, type PlannedTargetBand, type SessionDiagnosis, type SessionDiagnosisInput, type SplitMetrics } from "@/lib/coach/session-diagnosis";
import { getAthleteContextSnapshot } from "@/lib/athlete-context";
import { buildExecutionEvidence, generateCoachVerdict, refreshObservedPatterns, toPersistedExecutionReview, type PersistedExecutionReview } from "@/lib/execution-review";
import { getMetricsV2Laps, getNestedNumber as getMetricsNestedNumber } from "@/lib/workouts/metrics-v2";

type SessionExecutionSessionRow = {
  id: string;
  athlete_id?: string;
  user_id: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  target?: string | null;
  intent_category?: string | null;
  session_name?: string | null;
  session_role?: string | null;
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

type PersistedExecutionResult = PersistedExecutionReview;

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

function deriveCompletedIntervals(activity: SessionExecutionActivityRow) {
  const lapMetrics = getMetricsV2Laps(activity.metrics_v2);
  if (lapMetrics.length > 0) return lapMetrics.length;
  return activity.laps_count ?? null;
}

function deriveTimeAboveTargetPct(args: {
  targetBands: PlannedTargetBand | null;
  activity: SessionExecutionActivityRow;
}) {
  const metrics = asRecord(args.activity.metrics_v2);
  const lapMetrics = getMetricsV2Laps(args.activity.metrics_v2);
  const explicit =
    getNumber(metrics, ["timeAboveTargetPct", "time_above_target_pct"]) ??
    getNestedNumber([metrics], [["intensity", "timeAboveTargetPct"], ["intensity", "time_above_target_pct"]]);
  if (explicit !== null) return explicit;

  const totalLapDurationSec = lapMetrics.reduce((sum, lap) => sum + Math.max(0, lap.durationSec ?? 0), 0);
  if (totalLapDurationSec <= 0) return null;

  const targetPowerMax = args.targetBands?.power?.max;
  if (targetPowerMax) {
    const abovePowerSec = lapMetrics.reduce((sum, lap) => {
      if (!lap.durationSec || !lap.avgPower) return sum;
      return lap.avgPower > targetPowerMax ? sum + lap.durationSec : sum;
    }, 0);
    if (abovePowerSec > 0) return Number((abovePowerSec / totalLapDurationSec).toFixed(2));
  }

  const targetHrMax = args.targetBands?.hr?.max;
  if (targetHrMax) {
    const aboveHrSec = lapMetrics.reduce((sum, lap) => {
      if (!lap.durationSec || !lap.avgHr) return sum;
      return lap.avgHr > targetHrMax ? sum + lap.durationSec : sum;
    }, 0);
    if (aboveHrSec > 0) return Number((aboveHrSec / totalLapDurationSec).toFixed(2));
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

function asExecutionResult(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function shouldRefreshExecutionResultFromActivity(
  executionResult: Record<string, unknown> | null | undefined,
  activity: SessionExecutionActivityRow
) {
  const current = asExecutionResult(executionResult);
  if (!current) return true;

  const metrics = asRecord(activity.metrics_v2);
  const splitMetrics = extractSplitMetrics(activity);
  const normalizedPower = getMetricsNestedNumber(metrics, [["power", "normalizedPower"], ["power", "normalized_power"]]);
  const variabilityIndex =
    getMetricsNestedNumber(metrics, [["power", "variabilityIndex"], ["power", "variability_index"]]) ??
    getNumber(metrics, ["variabilityIndex", "variability_index"]);
  const trainingStressScore = getMetricsNestedNumber(metrics, [["load", "trainingStressScore"], ["load", "training_stress_score"]]);
  const avgCadence =
    getMetricsNestedNumber(metrics, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]]) ??
    getNumber(metrics, ["avgCadence", "avg_cadence"]);

  if (normalizedPower !== null && getNumber(current, ["normalizedPower", "normalized_power"]) === null) return true;
  if (variabilityIndex !== null && getNumber(current, ["variabilityIndex", "variability_index"]) === null) return true;
  if (trainingStressScore !== null && getNumber(current, ["trainingStressScore", "training_stress_score"]) === null) return true;
  if (avgCadence !== null && getNumber(current, ["avgCadence", "avg_cadence"]) === null) return true;

  if (splitMetrics) {
    const hasSplitMetricsInResult = [
      getNumber(current, ["firstHalfAvgHr", "first_half_avg_hr"]),
      getNumber(current, ["lastHalfAvgHr", "last_half_avg_hr"]),
      getNumber(current, ["firstHalfAvgPower", "first_half_avg_power"]),
      getNumber(current, ["lastHalfAvgPower", "last_half_avg_power"]),
      getNumber(current, ["firstHalfPaceSPerKm", "first_half_pace_s_per_km"]),
      getNumber(current, ["lastHalfPaceSPerKm", "last_half_pace_s_per_km"])
    ].some((value) => value !== null);

    if (!hasSplitMetricsInResult) return true;
  }

  return false;
}

function buildDiagnosisInput(session: SessionExecutionSessionRow, activity: SessionExecutionActivityRow): SessionDiagnosisInput {
  const metrics = asRecord(activity.metrics_v2);
  const parseSummary = asRecord(activity.parse_summary);
  const plannedIntervals = parsePlannedIntervals(session.target ?? session.type);
  const targetBands = parseTargetBands(session.target);
  const completedIntervals = deriveCompletedIntervals(activity);

  const intervalCompletionPct =
    getNumber(metrics, ["intervalCompletionPct", "interval_completion_pct"]) ??
    getNumber(parseSummary, ["intervalCompletionPct", "interval_completion_pct"]) ??
    (plannedIntervals && completedIntervals ? Number((Math.min(1, completedIntervals / plannedIntervals)).toFixed(2)) : null);

  const timeAboveTargetPct = deriveTimeAboveTargetPct({ targetBands, activity });

  const variabilityIndex =
    getNumber(metrics, ["variabilityIndex", "variability_index"]) ??
    getNestedNumber([metrics], [["power", "variabilityIndex"], ["power", "variability_index"]]);

  const normalizedPower =
    getMetricsNestedNumber(metrics, [["power", "normalizedPower"], ["power", "normalized_power"]]);
  const trainingStressScore =
    getMetricsNestedNumber(metrics, [["load", "trainingStressScore"], ["load", "training_stress_score"]]);
  const intensityFactor =
    getMetricsNestedNumber(metrics, [["power", "intensityFactor"], ["power", "intensity_factor"]]);
  const totalWorkKj =
    getMetricsNestedNumber(metrics, [["power", "totalWorkKj"], ["power", "total_work_kj"]]);
  const avgCadence =
    getMetricsNestedNumber(metrics, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]]) ??
    getNumber(metrics, ["avgCadence", "avg_cadence"]);
  const maxHr =
    getMetricsNestedNumber(metrics, [["heartRate", "maxHr"], ["heart_rate", "max_hr"]]) ??
    getNumber(parseSummary, ["maxHr", "max_hr"]);
  const maxPower =
    getMetricsNestedNumber(metrics, [["power", "maxPower"], ["power", "max_power"]]) ??
    getNumber(parseSummary, ["maxPower", "max_power"]);

  return {
    planned: {
      sport: (session.sport as SessionDiagnosisInput["planned"]["sport"]) ?? "other",
      plannedDurationSec: session.duration_minutes ? session.duration_minutes * 60 : null,
      intentCategory: session.intent_category ?? session.type,
      targetBands,
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
      completedIntervals,
      splitMetrics: extractSplitMetrics(activity),
      metrics: {
        avg_hr: activity.avg_hr ?? null,
        avg_power: activity.avg_power ?? null,
        normalized_power: normalizedPower,
        variability_index: variabilityIndex,
        training_stress_score: trainingStressScore,
        intensity_factor: intensityFactor,
        total_work_kj: totalWorkKj,
        avg_cadence: avgCadence,
        max_hr: maxHr,
        max_power: maxPower
      }
    }
  };
}

export function buildExecutionResultForSession(session: SessionExecutionSessionRow, activity: SessionExecutionActivityRow): PersistedExecutionResult {
  const diagnosisInput = buildDiagnosisInput(session, activity);
  const { diagnosis, evidence } = buildExecutionEvidence({
    athleteId: session.athlete_id ?? session.user_id,
    sessionId: session.id,
    sessionTitle: session.session_name ?? session.type,
    sessionRole: session.session_role,
    diagnosisInput
  });

  return toPersistedExecutionReview({
    linkedActivityId: activity.id,
    evidence,
    verdict: {
      sessionVerdict: {
        headline: diagnosis.intentMatchStatus === "matched_intent" ? "Intent landed" : diagnosis.intentMatchStatus === "missed_intent" ? "Intent came up short" : "Intent partially landed",
        summary: diagnosis.executionScoreSummary,
        intentMatch: evidence.rulesSummary.intentMatch,
        executionCost: evidence.rulesSummary.executionCost,
        confidence: diagnosis.diagnosisConfidence,
        nextCall:
          diagnosis.intentMatchStatus === "matched_intent"
            ? "move_on"
            : diagnosis.intentMatchStatus === "missed_intent"
              ? "repeat_session"
              : "proceed_with_caution"
      },
      explanation: {
        whatHappened: diagnosis.executionSummary,
        whyItMatters: diagnosis.whyItMatters,
        whatToDoNextTime: diagnosis.recommendedNextAction,
        whatToDoThisWeek: deriveWeekAdjustment(diagnosis)
      },
      uncertainty: {
        label: diagnosis.diagnosisConfidence === "high" ? "confident_read" : diagnosis.evidenceCount > 0 ? "early_read" : "insufficient_data",
        detail:
          diagnosis.diagnosisConfidence === "high"
            ? "This read is grounded in enough execution evidence to use with confidence."
            : "This is a useful early read, but some execution detail is still missing.",
        missingEvidence: evidence.missingEvidence
      },
      citedEvidence: [
        {
          claim: diagnosis.executionScoreSummary,
          support: evidence.detectedIssues.flatMap((issue) => issue.supportingMetrics).slice(0, 4)
        }
      ]
    }
  });
}

async function loadSessionAndActivity(supabase: SupabaseClient, userId: string, sessionId: string, activityId: string) {
  const [{ data: session, error: sessionError }, { data: activity, error: activityError }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id,athlete_id,user_id,sport,type,duration_minutes,target,intent_category,session_name,session_role,status")
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
  const diagnosisInput = buildDiagnosisInput(session, activity);
  let athleteContext = null;
  try {
    athleteContext = await getAthleteContextSnapshot(args.supabase, session.athlete_id ?? args.userId);
  } catch {
    athleteContext = null;
  }
  const { evidence } = buildExecutionEvidence({
    athleteId: session.athlete_id ?? args.userId,
    sessionId: session.id,
    sessionTitle: session.session_name ?? session.type,
    sessionRole: session.session_role,
    diagnosisInput,
    weeklyState: athleteContext ? { fatigue: athleteContext.weeklyState.fatigue } : null
  });
  const verdict = await generateCoachVerdict({
    evidence,
    athleteContext,
    recentReviewedSessions: []
  });
  const executionResult = toPersistedExecutionReview({
    linkedActivityId: activity.id,
    evidence,
    verdict
  });

  const { error } = await args.supabase
    .from("sessions")
    .update({
      status: "completed",
      execution_result: executionResult
    })
    .eq("id", session.id)
    .eq("user_id", args.userId);

  if (error) throw new Error(error.message);

  try {
    await refreshObservedPatterns(args.supabase, session.athlete_id ?? args.userId);
  } catch {
    // Pattern refresh is non-blocking.
  }

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
  force?: boolean;
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

  let candidateLinks = confirmedLinks;

  if (!args.force) {
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

    candidateLinks = confirmedLinks.filter((link) => pendingSessionIds.has(link.planned_session_id as string));
  }

  const dedupedLinks = [...new Map(candidateLinks.map((link) => [link.planned_session_id as string, link])).values()];
  const linksToProcess = typeof args.limit === "number" ? dedupedLinks.slice(0, args.limit) : dedupedLinks;

  let updated = 0;
  for (const link of linksToProcess) {
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
    attempted: linksToProcess.length
  };
}
