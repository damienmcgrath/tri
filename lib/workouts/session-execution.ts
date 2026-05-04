import type { SupabaseClient } from "@supabase/supabase-js";
import { getAthleteContextSnapshot } from "@/lib/athlete-context";
import {
  buildExecutionEvidence,
  generateCoachVerdict,
  refreshObservedPatterns,
  toPersistedExecutionReview,
  type PersistedExecutionReview
} from "@/lib/execution-review";
import { fetchExecutionReviewPriorHeadlines } from "@/lib/ai/session-variance-corpus";
import { inferExtraIntent } from "@/lib/workouts/infer-extra-intent";
import { buildExtendedSignals, EMPTY_EXTENDED_SIGNALS, type ExtendedSignals } from "@/lib/analytics/extended-signals";
import {
  asRecord,
  type SessionExecutionActivityRow,
  type SessionExecutionSessionRow
} from "./session-execution-helpers";
import { buildDiagnosisInput, shouldRefreshExecutionResultFromActivity } from "./session-execution-builders";

// Re-export the public API so consumers can keep importing from
// "@/lib/workouts/session-execution".
export {
  buildExecutionResultForSession,
  buildDiagnosisInput,
  shouldRefreshExecutionResultFromActivity
} from "./session-execution-builders";
export { deriveWorkIntervalAvgPower } from "./session-execution-metrics";
export { parseTargetBands } from "./session-execution-targets";

async function loadSessionAndActivity(supabase: SupabaseClient, userId: string, sessionId: string, activityId: string) {
  const [{ data: session, error: sessionError }, { data: activity, error: activityError }] = await Promise.all([
    supabase
      .from("sessions")
      .select("id,athlete_id,user_id,sport,type,duration_minutes,date,target,notes,intent_category,session_name,session_role,status")
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
  const { diagnosis, evidence } = buildExecutionEvidence({
    athleteId: session.athlete_id ?? args.userId,
    sessionId: session.id,
    sessionTitle: session.session_name ?? session.type,
    sessionRole: session.session_role,
    plannedStructure: [session.target, session.notes].filter(Boolean).join(" | ") || null,
    diagnosisInput,
    weeklyState: athleteContext ? { fatigue: athleteContext.weeklyState.fatigue } : null
  });
  let extendedSignals: ExtendedSignals = EMPTY_EXTENDED_SIGNALS;
  if (session.date) {
    try {
      extendedSignals = await buildExtendedSignals(args.supabase, {
        athleteId: session.athlete_id ?? args.userId,
        sessionId: session.id,
        sport: session.sport,
        intentCategory: session.intent_category ?? null,
        sessionDate: session.date,
        splitHalves: diagnosisInput.actual.splitMetrics ?? null,
        environment: asRecord(activity.metrics_v2)?.environment ?? null
      });
    } catch {
      extendedSignals = EMPTY_EXTENDED_SIGNALS;
    }
  }
  evidence.extendedSignals = extendedSignals;
  let priorHeadlines: Awaited<ReturnType<typeof fetchExecutionReviewPriorHeadlines>> = [];
  if (session.date) {
    try {
      priorHeadlines = await fetchExecutionReviewPriorHeadlines(
        args.supabase,
        session.athlete_id ?? args.userId,
        session.date
      );
    } catch {
      priorHeadlines = [];
    }
  }
  const generated = await generateCoachVerdict({
    evidence,
    athleteContext,
    recentReviewedSessions: [],
    priorHeadlines
  });
  const executionResult = toPersistedExecutionReview({
    linkedActivityId: activity.id,
    evidence,
    componentScores: diagnosis.componentScores,
    verdict: generated.verdict,
    narrativeSource: generated.source
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
  console.info("[execution-review-backfill] Starting backfill", {
    userId: args.userId,
    limit: args.limit ?? null,
    force: args.force === true
  });

  const { data: links, error: linkError } = await args.supabase
    .from("session_activity_links")
    .select("planned_session_id,completed_activity_id,confirmation_status,created_at")
    .eq("user_id", args.userId)
    .order("created_at", { ascending: false });

  if (linkError) throw new Error(linkError.message);

  const confirmedLinks = (links ?? []).filter(
    (link) => link.planned_session_id && link.completed_activity_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null)
  );

  console.info("[execution-review-backfill] Loaded links", {
    totalLinks: (links ?? []).length,
    confirmedLinks: confirmedLinks.length
  });

  if (confirmedLinks.length === 0) {
    console.info("[execution-review-backfill] No confirmed links found; nothing to do");
    return { updated: 0, attempted: 0 };
  }

  let candidateLinks = confirmedLinks;

  if (!args.force) {
    const sessionIds = [...new Set(confirmedLinks.map((link) => link.planned_session_id as string))];
    const activityIds = [...new Set(confirmedLinks.map((link) => link.completed_activity_id as string))];
    const { data: sessions, error: sessionError } = await args.supabase
      .from("sessions")
      .select("id,execution_result")
      .eq("user_id", args.userId)
      .in("id", sessionIds);

    if (sessionError) throw new Error(sessionError.message);
    const { data: activities, error: activityError } = await args.supabase
      .from("completed_activities")
      .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
      .eq("user_id", args.userId)
      .in("id", activityIds);

    if (activityError) throw new Error(activityError.message);

    const sessionById = new Map(
      ((sessions ?? []) as Array<{ id: string; execution_result?: Record<string, unknown> | null }>)
        .map((session) => [session.id, session])
    );
    const activityById = new Map(
      ((activities ?? []) as SessionExecutionActivityRow[])
        .map((activity) => [activity.id, activity])
    );

    const selectionLog: Array<{
      sessionId: string;
      activityId: string;
      action: "selected" | "skipped";
      reason: string;
    }> = [];

    candidateLinks = confirmedLinks.filter((link) => {
      const session = sessionById.get(link.planned_session_id as string);
      const activity = activityById.get(link.completed_activity_id as string);
      const sessionId = link.planned_session_id as string;
      const activityId = link.completed_activity_id as string;

      if (!session) {
        selectionLog.push({ sessionId, activityId, action: "skipped", reason: "session_not_found" });
        return false;
      }

      if (!activity) {
        selectionLog.push({ sessionId, activityId, action: "skipped", reason: "activity_not_found" });
        return false;
      }

      if (!session.execution_result) {
        selectionLog.push({ sessionId, activityId, action: "selected", reason: "missing_execution_result" });
        return true;
      }

      const shouldRefresh = shouldRefreshExecutionResultFromActivity(session.execution_result, activity);
      selectionLog.push({
        sessionId,
        activityId,
        action: shouldRefresh ? "selected" : "skipped",
        reason: shouldRefresh ? "stale_execution_result" : "already_fresh"
      });
      return shouldRefresh;
    });

    console.info("[execution-review-backfill] Candidate selection complete", {
      selected: selectionLog.filter((entry) => entry.action === "selected").length,
      skipped: selectionLog.filter((entry) => entry.action === "skipped").length,
      sample: selectionLog.slice(0, 20)
    });
  }

  const dedupedLinks = [...new Map(candidateLinks.map((link) => [link.planned_session_id as string, link])).values()];
  const linksToProcess = typeof args.limit === "number" ? dedupedLinks.slice(0, args.limit) : dedupedLinks;

  console.info("[execution-review-backfill] Prepared batch", {
    candidateLinks: candidateLinks.length,
    dedupedLinks: dedupedLinks.length,
    processing: linksToProcess.length
  });

  let updated = 0;
  for (const link of linksToProcess) {
    const sessionId = link.planned_session_id as string;
    const activityId = link.completed_activity_id as string;
    console.info("[execution-review-backfill] Rebuilding execution review", {
      sessionId,
      activityId
    });

    try {
      await syncSessionExecutionFromActivityLink({
        supabase: args.supabase,
        userId: args.userId,
        sessionId,
        activityId
      });
      updated += 1;
      console.info("[execution-review-backfill] Rebuild complete", {
        sessionId,
        activityId
      });
    } catch (error) {
      console.warn("[execution-review-backfill] Rebuild failed", {
        sessionId,
        activityId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Skip failed sessions so one bad row does not block the rest of the batch.
    }
  }

  console.info("[execution-review-backfill] Backfill finished", {
    updated,
    attempted: linksToProcess.length
  });

  return {
    updated,
    attempted: linksToProcess.length
  };
}

export async function syncExtraActivityExecution(args: {
  supabase: SupabaseClient;
  userId: string;
  activityId: string;
  /** When set, overrides the auto-inferred intent category. Persisted to
   *  `completed_activities.intent_override` so it survives regeneration. */
  intentOverride?: string;
}): Promise<PersistedExecutionReview> {
  const { data: activity, error: activityError } = await args.supabase
    .from("completed_activities")
    .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2,intent_override,start_time_utc")
    .eq("id", args.activityId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (activityError) throw new Error(activityError.message);
  if (!activity) throw new Error("Activity not found.");

  // Use the caller's explicit override first, then fall back to a previously
  // stored override from the DB, and only auto-classify as a last resort.
  // This ensures a user's reclassification survives plain regenerations.
  const effectiveOverride = args.intentOverride ?? (activity as Record<string, unknown>).intent_override as string | null;
  const intentResult = effectiveOverride
    ? { intentCategory: effectiveOverride, rationale: "User override" }
    : inferExtraIntent({
        sport_type: activity.sport_type,
        duration_sec: activity.duration_sec,
        metrics_v2: activity.metrics_v2 ?? null,
      });

  // Extras have no planned duration, so leave `duration_minutes` null.
  // Passing the actual activity duration here would be a self-comparison — it
  // makes `evaluateUnknown` trivially return `matched_intent` regardless of
  // how the session was actually executed.
  const syntheticSession: SessionExecutionSessionRow = {
    id: `activity:${activity.id}`,
    user_id: args.userId,
    sport: activity.sport_type,
    type: "Extra workout",
    duration_minutes: null,
    target: null,
    intent_category: intentResult.intentCategory,
    session_name: "Extra workout",
    session_role: null,
    status: "completed"
  };

  const diagnosisInput = buildDiagnosisInput(syntheticSession, activity as SessionExecutionActivityRow);

  let athleteContext = null;
  try {
    athleteContext = await getAthleteContextSnapshot(args.supabase, args.userId);
  } catch {
    athleteContext = null;
  }

  const intentSource = args.intentOverride ? "User override" : "Inferred intent";
  const { diagnosis, evidence } = buildExecutionEvidence({
    athleteId: args.userId,
    sessionId: syntheticSession.id,
    sessionTitle: "Extra workout",
    sessionRole: null,
    plannedStructure: `${intentSource}: ${intentResult.intentCategory} (${intentResult.rationale})`,
    diagnosisInput,
    weeklyState: athleteContext ? { fatigue: athleteContext.weeklyState.fatigue } : null
  });

  let extraExtendedSignals: ExtendedSignals = EMPTY_EXTENDED_SIGNALS;
  // `start_time_utc` MUST be included in the completed_activities select above;
  // without it `activityStartDate` collapses to null, `buildExtendedSignals`
  // never runs for extras, and every extra-activity review silently falls back
  // to the generic "no history" insight.
  const activityStartDate = typeof (activity as unknown as { start_time_utc?: unknown }).start_time_utc === "string"
    ? ((activity as unknown as { start_time_utc: string }).start_time_utc).slice(0, 10)
    : null;
  if (activityStartDate) {
    try {
      extraExtendedSignals = await buildExtendedSignals(args.supabase, {
        athleteId: args.userId,
        sessionId: syntheticSession.id,
        sport: syntheticSession.sport,
        intentCategory: intentResult.intentCategory,
        sessionDate: activityStartDate,
        splitHalves: diagnosisInput.actual.splitMetrics ?? null,
        environment: asRecord(activity.metrics_v2)?.environment ?? null
      });
    } catch {
      extraExtendedSignals = EMPTY_EXTENDED_SIGNALS;
    }
  }
  evidence.extendedSignals = extraExtendedSignals;

  let extraPriorHeadlines: Awaited<ReturnType<typeof fetchExecutionReviewPriorHeadlines>> = [];
  if (activityStartDate) {
    try {
      extraPriorHeadlines = await fetchExecutionReviewPriorHeadlines(
        args.supabase,
        args.userId,
        activityStartDate
      );
    } catch {
      extraPriorHeadlines = [];
    }
  }
  const generated = await generateCoachVerdict({ evidence, athleteContext, recentReviewedSessions: [], priorHeadlines: extraPriorHeadlines });
  const executionResult = toPersistedExecutionReview({
    linkedActivityId: activity.id,
    evidence,
    componentScores: diagnosis.componentScores,
    verdict: generated.verdict,
    narrativeSource: generated.source
  });

  const updatePayload: Record<string, unknown> = { execution_result: executionResult };
  // Persist the override so it survives future regenerations. Clear it when
  // no override is provided (user could have removed a previous override).
  if (args.intentOverride !== undefined) {
    updatePayload.intent_override = args.intentOverride || null;
  }

  const { error: saveError } = await args.supabase
    .from("completed_activities")
    .update(updatePayload)
    .eq("id", activity.id)
    .eq("user_id", args.userId);

  if (saveError) throw new Error(saveError.message);

  return executionResult;
}
