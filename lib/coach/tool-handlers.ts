import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachAuthContext } from "@/lib/coach/types";
import { buildWeeklyExecutionBrief, parsePersistedExecutionReview } from "@/lib/execution-review";
import { getAthleteContextSnapshot, getCurrentWeekStart } from "@/lib/athlete-context";
import { getMacroContext, formatMacroContextSummary } from "@/lib/training/macro-context";
import { detectAmbientSignals } from "@/lib/training/ambient-signals";
import { getLatestFitness, getTsbTrend, getReadinessState } from "@/lib/training/fitness-model";
import { computeWeeklyDisciplineBalance, detectDisciplineImbalance } from "@/lib/training/discipline-balance";
import { detectCrossDisciplineFatigue, detectDisciplineSpecificDecline } from "@/lib/training/fatigue-detection";
import { getBlockMetrics, getBlockComparison } from "@/lib/training/block-metrics";
import {
  coachToolSchemas,
  type CoachToolName
} from "@/lib/coach/tools";
import { logCoachAudit } from "@/lib/coach/audit";
import { getNestedNumber } from "@/lib/workouts/metrics-v2";
import { SESSION_BASE_COLUMNS } from "@/lib/supabase/queries";
import {
  getRaceObject,
  getRaceSegmentMetrics,
  getPriorRacesForComparison,
  getBestComparableTrainingForSegment,
  getAthleteThresholds
} from "@/lib/coach/race-tool-handlers";
import { RACE_SCOPED_TOOLS } from "@/lib/coach/tools";
import { runWhatIfScenario } from "@/lib/race-review/what-if-scenarios";

type ToolDeps = {
  supabase: SupabaseClient;
  ctx: CoachAuthContext;
  /** Set when the conversation is scoped to a race bundle. */
  raceBundleId?: string;
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
  const [snapshot, macroCtx, ambientSignals] = await Promise.all([
    getAthleteContextSnapshot(supabase, ctx.athleteId),
    getMacroContext(supabase, ctx.athleteId),
    detectAmbientSignals(supabase, ctx.athleteId).catch(() => [])
  ]);
  return {
    athleteContext: snapshot,
    macroContext: macroCtx,
    macroContextSummary: formatMacroContextSummary(macroCtx),
    ambientSignals
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
    .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,calories,moving_duration_sec,elapsed_duration_sec,pool_length_m,laps_count,avg_pace_per_100m_sec,metrics_v2")
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
    .select(`${SESSION_BASE_COLUMNS},execution_result`)
    .eq("athlete_id", deps.ctx.athleteId)
    .gte("date", since)
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(20);

  const uploadedActivitiesRealData = (uploadedActivities ?? []).map((activity) => {
    const activityDate = activity.start_time_utc.slice(0, 10);

    const movingDurationSec = activity.moving_duration_sec ? Number(activity.moving_duration_sec) : null;
    const elapsedDurationSec = activity.elapsed_duration_sec ? Number(activity.elapsed_duration_sec) : null;
    const distanceMeters = activity.distance_m ? Number(activity.distance_m) : null;
    const poolLengthMeters = activity.pool_length_m ? Number(activity.pool_length_m) : null;
    const lapsCount = activity.laps_count ? Number(activity.laps_count) : null;
    const avgPacePer100mSec = activity.sport_type === "swim" && activity.avg_pace_per_100m_sec
      ? Number(activity.avg_pace_per_100m_sec)
      : null;
    const normalizedPower = getNestedNumber(activity.metrics_v2, [["power", "normalizedPower"], ["power", "normalized_power"]]);
    const variabilityIndex = getNestedNumber(activity.metrics_v2, [["power", "variabilityIndex"], ["power", "variability_index"]]);
    const trainingStressScore = getNestedNumber(activity.metrics_v2, [["load", "trainingStressScore"], ["load", "training_stress_score"]]);
    const intensityFactor = getNestedNumber(activity.metrics_v2, [["power", "intensityFactor"], ["power", "intensity_factor"]]);
    const totalWorkKj = getNestedNumber(activity.metrics_v2, [["power", "totalWorkKj"], ["power", "total_work_kj"]]);
    const avgCadence = getNestedNumber(activity.metrics_v2, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]]);

    return {
      id: `activity:${activity.id}`,
      source: "uploaded_activity" as const,
      date: activityDate,
      sport: activity.sport_type,
      durationMinutes: activity.duration_sec ? Math.round(Number(activity.duration_sec) / 60) : null,
      movingDurationMinutes: movingDurationSec ? Math.round(movingDurationSec / 60) : null,
      elapsedDurationMinutes: elapsedDurationSec ? Math.round(elapsedDurationSec / 60) : null,
      distanceMeters,
      poolLengthMeters,
      lapsCount,
      avgPacePer100mSec,
      avgHr: activity.avg_hr ?? null,
      avgPower: activity.avg_power ?? null,
      normalizedPower,
      variabilityIndex,
      trainingStressScore,
      intensityFactor,
      totalWorkKj,
      avgCadence,
      calories: activity.calories ?? null,
      metricsV2: activity.metrics_v2 ?? null,
      avgPaceSecPerKm: null,
      avgPaceSecPer100m: avgPacePer100mSec,
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
          avgPaceSecPerKm: pace.avgPaceSecPerKm,
          avgPaceSecPer100m: pace.avgPaceSecPer100m,
          source: "legacy_completed_session"
        };
      }),
      ...uploadedActivitiesRealData
    ],
    planned: (planned ?? []).map((session) => {
      const review = parsePersistedExecutionReview((session as { execution_result?: Record<string, unknown> | null }).execution_result ?? null);
      return {
        id: session.id,
        date: session.date,
        sport: session.sport,
        type: session.type,
        durationMinutes: session.duration_minutes,
        status: session.status,
        reviewCitation: review
          ? {
            headline: review.verdict?.sessionVerdict.headline ?? review.executionScoreSummary,
            intentMatch: review.deterministic.rulesSummary.intentMatch,
            evidence: review.evidence
          }
          : null
      };
    })
  };
}


async function getActivityDetails(args: unknown, deps: ToolDeps) {
  const parsed = coachToolSchemas.get_activity_details.parse(args);

  const { data: activity, error } = await deps.supabase
    .from("completed_activities")
    .select("id,sport_type,start_time_utc,end_time_utc,duration_sec,distance_m,avg_hr,avg_power,calories,moving_duration_sec,elapsed_duration_sec,pool_length_m,laps_count,avg_pace_per_100m_sec,best_pace_per_100m_sec,avg_stroke_rate_spm,avg_swolf,avg_cadence,max_hr,max_power,elevation_gain_m,elevation_loss_m,activity_vendor,activity_type_raw,activity_subtype_raw,metrics_v2")
    .eq("id", parsed.activityId)
    .eq("user_id", deps.ctx.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`get_activity_details query failed: ${error.message}`);
  }

  if (!activity) {
    throw new Error("get_activity_details activity not found.");
  }

  const { data: linkedSession } = await deps.supabase
    .from("session_activity_links")
    .select("planned_session_id,confirmation_status,confidence")
    .eq("user_id", deps.ctx.userId)
    .eq("completed_activity_id", activity.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    source: "uploaded_activity",
    activity,
    linkedSession: linkedSession ?? null
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

async function getWeeklyBrief({ supabase, ctx }: ToolDeps) {
  const weekStart = getCurrentWeekStart();
  const weekEnd = isoDate(addDays(new Date(`${weekStart}T00:00:00.000Z`), 6));
  const athleteContext = await getAthleteContextSnapshot(supabase, ctx.athleteId);
  const brief = await buildWeeklyExecutionBrief({
    supabase,
    athleteId: ctx.athleteId,
    weekStart,
    weekEnd,
    athleteContext
  });

  return {
    weekStart,
    weekEnd,
    athleteContextCue: athleteContext.observed.recurringPatterns[0] ?? athleteContext.declared.limiters[0] ?? null,
    brief
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

async function getTrainingLoad({ supabase, ctx }: ToolDeps) {
  const now = new Date();
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = isoDate(addDays(now, mondayOffset));

  const [fitness, tsbTrend, balance, crossFatigue, specificDecline] = await Promise.all([
    getLatestFitness(supabase, ctx.userId),
    getTsbTrend(supabase, ctx.userId),
    computeWeeklyDisciplineBalance(supabase, ctx.userId, weekStart),
    detectCrossDisciplineFatigue(supabase, ctx.userId).catch(() => null),
    detectDisciplineSpecificDecline(supabase, ctx.userId).catch(() => [])
  ]);

  const totalFitness = fitness?.total ?? null;
  const readiness = totalFitness
    ? getReadinessState(totalFitness.tsb, tsbTrend)
    : null;

  const imbalances = detectDisciplineImbalance(balance);
  const fatigueSignals = [
    ...(crossFatigue ? [crossFatigue] : []),
    ...specificDecline
  ];

  // Per-discipline summary
  const perDiscipline: Record<string, { ctl: number; atl: number; tsb: number; rampRate: number | null }> = {};
  if (fitness) {
    for (const sport of ["swim", "bike", "run", "strength"] as const) {
      const snap = fitness[sport];
      if (snap && (snap.ctl > 0 || snap.atl > 0)) {
        perDiscipline[sport] = {
          ctl: snap.ctl,
          atl: snap.atl,
          tsb: snap.tsb,
          rampRate: snap.rampRate
        };
      }
    }
  }

  return {
    fitness: totalFitness ? {
      ctl: totalFitness.ctl,
      atl: totalFitness.atl,
      tsb: totalFitness.tsb,
      rampRate: totalFitness.rampRate,
      readiness,
      tsbTrend
    } : null,
    perDiscipline,
    weekBalance: {
      weekStart: balance.weekStart,
      totalActualTss: balance.totalActualTss,
      actual: balance.actual,
      imbalances
    },
    fatigueSignals
  };
}

async function resolveBlockId(args: unknown, deps: ToolDeps, schema: typeof coachToolSchemas.get_block_summary): Promise<string | null> {
  const parsed = schema.parse(args ?? {});
  if (parsed.blockId) return parsed.blockId;
  const macro = await getMacroContext(deps.supabase, deps.ctx.athleteId).catch(() => null);
  return macro?.trainingBlockId ?? null;
}

async function getBlockSummary(args: unknown, deps: ToolDeps) {
  const blockId = await resolveBlockId(args, deps, coachToolSchemas.get_block_summary);
  if (!blockId) {
    return { error: "no_active_block", message: "No active training block for this athlete." };
  }
  const metrics = await getBlockMetrics(deps.supabase, blockId);
  if (!metrics) {
    return { error: "block_not_found", message: `Block ${blockId} not found.` };
  }
  return metrics;
}

async function getBlockComparisonTool(args: unknown, deps: ToolDeps) {
  const blockId = await resolveBlockId(args, deps, coachToolSchemas.get_block_comparison);
  if (!blockId) {
    return { error: "no_active_block", message: "No active training block for this athlete." };
  }
  const comparison = await getBlockComparison(deps.supabase, blockId);
  if (!comparison) {
    return { error: "block_not_found", message: `Block ${blockId} not found.` };
  }
  return comparison;
}

export async function executeCoachTool(name: CoachToolName, args: unknown, deps: ToolDeps) {
  logCoachAudit("info", "coach.tool.execute", {
    ctx: deps.ctx,
    toolName: name,
    args
  });

  // Race-scoped tools refuse to execute outside a race-scoped conversation.
  if (RACE_SCOPED_TOOLS.has(name) && !deps.raceBundleId) {
    throw new Error("This tool is only available when the conversation is scoped to a race.");
  }

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
      case "get_weekly_brief":
        coachToolSchemas.get_weekly_brief.parse(args);
        result = await getWeeklyBrief(deps);
        break;
      case "get_activity_details":
        result = await getActivityDetails(args, deps);
        break;
      case "get_training_load":
        coachToolSchemas.get_training_load.parse(args);
        result = await getTrainingLoad(deps);
        break;
      case "get_block_summary":
        result = await getBlockSummary(args, deps);
        break;
      case "get_block_comparison":
        result = await getBlockComparisonTool(args, deps);
        break;
      case "create_plan_change_proposal":
        result = await createPlanChangeProposal(args, deps);
        break;
      case "get_race_object":
        coachToolSchemas.get_race_object.parse(args);
        result = await getRaceObject({ supabase: deps.supabase, ctx: deps.ctx, bundleId: deps.raceBundleId! });
        break;
      case "get_race_segment_metrics":
        result = await getRaceSegmentMetrics(
          coachToolSchemas.get_race_segment_metrics.parse(args),
          { supabase: deps.supabase, ctx: deps.ctx, bundleId: deps.raceBundleId! }
        );
        break;
      case "get_prior_races_for_comparison":
        result = await getPriorRacesForComparison(
          coachToolSchemas.get_prior_races_for_comparison.parse(args),
          { supabase: deps.supabase, ctx: deps.ctx, bundleId: deps.raceBundleId! }
        );
        break;
      case "get_best_comparable_training_for_segment":
        result = await getBestComparableTrainingForSegment(
          coachToolSchemas.get_best_comparable_training_for_segment.parse(args),
          { supabase: deps.supabase, ctx: deps.ctx, bundleId: deps.raceBundleId! }
        );
        break;
      case "get_athlete_thresholds":
        coachToolSchemas.get_athlete_thresholds.parse(args);
        result = await getAthleteThresholds({
          supabase: deps.supabase,
          ctx: deps.ctx,
          bundleId: deps.raceBundleId ?? ""
        });
        break;
      case "get_what_if_scenario": {
        const scenario = coachToolSchemas.get_what_if_scenario.parse(args);
        result = await runWhatIfScenario(deps.supabase, deps.ctx.userId, scenario);
        break;
      }
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
