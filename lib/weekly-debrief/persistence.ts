import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExtraCompletedActivities, hasConfirmedPlannedSessionLink, loadCompletedActivities } from "@/lib/activities/completed-activities";
import { getAthleteContextSnapshot } from "@/lib/athlete-context";
import { addDays } from "@/lib/date-utils";
import type {
  WeeklyDebriefSession,
  WeeklyDebriefActivity,
  WeeklyDebriefLink,
  WeeklyDebriefCheckIn,
  WeeklyDebriefInputs,
  WeeklyDebriefSourceInputs,
  WeeklyDebriefSourceState,
  WeeklyDebriefComputed,
  WeeklyDebriefRecord,
  WeeklyDebriefReadiness,
  WeeklyDebriefSnapshot,
  WeeklyDebriefFeedbackInput
} from "./types";
import {
  WEEKLY_DEBRIEF_GENERATION_VERSION,
  weeklyDebriefFactsSchema,
  weeklyDebriefFeedbackInputSchema
} from "./types";
import {
  isSkippedByTag,
  inferSessionStatus,
  computeWeeklyDebriefReadiness,
  buildCoachShare,
  getSourceUpdatedAt,
  normalizePersistedArtifact
} from "./deterministic";
import { buildWeeklyDebriefFacts } from "./facts";
import { generateNarrative } from "./narrative";
import { generateAnalyticFindings } from "./analytic-findings";

async function loadWeeklyDebriefInputs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const activityRangeStart = `${addDays(args.weekStart, -1)}T00:00:00.000Z`;
  const activityRangeEnd = `${addDays(args.weekEnd, 2)}T00:00:00.000Z`;

  const [{ data: sessionsData, error: sessionsError }, activities, { data: linksData, error: linksError }, athleteContext, { data: checkInData }, { data: feelsData }] = await Promise.all([
    args.supabase
      .from("sessions")
      .select("id,athlete_id,user_id,date,sport,type,session_name,subtype,workout_type,intent_category,session_role,notes,status,duration_minutes,updated_at,created_at,execution_result,is_key")
      .or(`athlete_id.eq.${args.athleteId},user_id.eq.${args.athleteId}`)
      .gte("date", args.weekStart)
      .lte("date", args.weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true }),
    loadCompletedActivities({
      supabase: args.supabase,
      userId: args.athleteId,
      rangeStart: activityRangeStart,
      rangeEnd: activityRangeEnd
    }),
    args.supabase
      .from("session_activity_links")
      .select("completed_activity_id,planned_session_id,confirmation_status,created_at")
      .eq("user_id", args.athleteId),
    getAthleteContextSnapshot(args.supabase, args.athleteId),
    args.supabase
      .from("athlete_checkins")
      .select("fatigue_score,stress_score,motivation_score,week_notes")
      .eq("user_id", args.athleteId)
      .eq("week_start", args.weekStart)
      .maybeSingle(),
    args.supabase
      .from("session_feels")
      .select("session_id,overall_feel,energy_level,legs_feel,motivation,sleep_quality,life_stress,note")
      .eq("user_id", args.athleteId)
      .not("overall_feel", "is", null)
  ]);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }
  if (linksError) {
    throw new Error(linksError.message);
  }

  const checkIn: WeeklyDebriefCheckIn | null = checkInData
    ? {
        fatigueScore: (checkInData as { fatigue_score?: number | null }).fatigue_score ?? null,
        stressScore: (checkInData as { stress_score?: number | null }).stress_score ?? null,
        motivationScore: (checkInData as { motivation_score?: number | null }).motivation_score ?? null,
        weekNotes: (checkInData as { week_notes?: string | null }).week_notes ?? null
      }
    : null;

  const sessionFeels = (feelsData ?? []).map((f) => ({
    sessionId: f.session_id as string,
    overallFeel: f.overall_feel as number,
    energyLevel: (f.energy_level as string) ?? null,
    legsFeel: (f.legs_feel as string) ?? null,
    motivation: (f.motivation as string) ?? null,
    sleepQuality: (f.sleep_quality as string) ?? null,
    lifeStress: (f.life_stress as string) ?? null,
    note: (f.note as string) ?? null
  }));

  return {
    sessions: (sessionsData ?? []) as WeeklyDebriefSession[],
    activities: activities as WeeklyDebriefActivity[],
    links: (linksData ?? []) as WeeklyDebriefLink[],
    sessionFeels,
    athleteContext,
    checkIn,
    timeZone: args.timeZone,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    todayIso: args.todayIso
  } satisfies WeeklyDebriefInputs;
}

async function loadWeeklyDebriefSourceInputs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const activityRangeStart = `${addDays(args.weekStart, -1)}T00:00:00.000Z`;
  const activityRangeEnd = `${addDays(args.weekEnd, 2)}T00:00:00.000Z`;

  const [
    { data: sessionsData, error: sessionsError },
    activities,
    { data: linksData, error: linksError },
    { data: checkinData, error: checkinError },
    { data: latestFeelData }
  ] = await Promise.all([
    args.supabase
      .from("sessions")
      .select("id,date,sport,notes,status,duration_minutes,updated_at,created_at,is_key,session_role")
      .or(`athlete_id.eq.${args.athleteId},user_id.eq.${args.athleteId}`)
      .gte("date", args.weekStart)
      .lte("date", args.weekEnd)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true }),
    loadCompletedActivities({
      supabase: args.supabase,
      userId: args.athleteId,
      rangeStart: activityRangeStart,
      rangeEnd: activityRangeEnd
    }),
    args.supabase
      .from("session_activity_links")
      .select("completed_activity_id,planned_session_id,confirmation_status,created_at")
      .eq("user_id", args.athleteId),
    args.supabase
      .from("athlete_checkins")
      .select("updated_at")
      .eq("athlete_id", args.athleteId)
      .eq("week_start", args.weekStart)
      .maybeSingle(),
    args.supabase
      .from("session_feels")
      .select("created_at")
      .eq("user_id", args.athleteId)
      .not("overall_feel", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }
  if (linksError) {
    throw new Error(linksError.message);
  }
  if (checkinError) {
    throw new Error(checkinError.message);
  }

  return {
    sessions: (sessionsData ?? []) as WeeklyDebriefSourceInputs["sessions"],
    activities: activities as WeeklyDebriefActivity[],
    links: (linksData ?? []) as WeeklyDebriefLink[],
    weeklyCheckinUpdatedAt: checkinData?.updated_at ?? null,
    latestFeelUpdatedAt: latestFeelData?.created_at ?? null,
    timeZone: args.timeZone,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    todayIso: args.todayIso
  } satisfies WeeklyDebriefSourceInputs;
}

function computeWeeklyDebriefSourceState(input: WeeklyDebriefSourceInputs) {
  const completionLedger = input.sessions.reduce<Record<string, number>>((acc, session) => {
    if (session.status !== "completed") return acc;
    const key = `${session.date}:${session.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const sessionSummaries = input.sessions
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    .map((session) => ({
      ...session,
      resolvedStatus: inferSessionStatus(session as WeeklyDebriefSession, completionLedger),
      isKey: Boolean(session.is_key) || session.session_role?.toLowerCase() === "key",
      durationMinutes: Math.max(0, session.duration_minutes ?? 0)
    }));

  const confirmedLinks = input.links.filter(hasConfirmedPlannedSessionLink);
  const weekEndExclusive = addDays(input.weekEnd, 1);
  const extraActivities = buildExtraCompletedActivities({
    activities: input.activities,
    links: input.links,
    timeZone: input.timeZone,
    weekStart: input.weekStart,
    weekEndExclusive
  });

  // For completed sessions use actual activity minutes (same as the main card) so both cards show the
  // same effective total.  For skipped/planned sessions keep the planned duration.
  const activitiesById = new Map(input.activities.map((a) => [a.id, a]));
  const getEffectiveMinutes = (session: (typeof sessionSummaries)[number]) => {
    if (session.resolvedStatus !== "completed") return session.durationMinutes;
    const linkedMinutes = confirmedLinks
      .filter((link) => link.planned_session_id === session.id)
      .reduce((minutes, link) => {
        const activity = activitiesById.get(link.completed_activity_id);
        return minutes + Math.round((activity?.duration_sec ?? 0) / 60);
      }, 0);
    return linkedMinutes > 0 ? linkedMinutes : session.durationMinutes;
  };
  const plannedMinutes = sessionSummaries.reduce((sum, session) => sum + getEffectiveMinutes(session), 0);
  const completedMinutes =
    sessionSummaries
      .filter((session) => session.resolvedStatus === "completed")
      .reduce((sum, session) => sum + getEffectiveMinutes(session), 0) +
    extraActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0);
  const skippedMinutes = sessionSummaries
    .filter((session) => session.resolvedStatus === "skipped")
    .reduce((sum, session) => sum + session.durationMinutes, 0);
  const resolvedMinutes = completedMinutes + skippedMinutes;

  const keySessions = sessionSummaries.filter((session) => session.isKey);
  const resolvedKeySessions = keySessions.filter(
    (session) => session.resolvedStatus === "completed" || session.resolvedStatus === "skipped"
  ).length;

  return {
    readiness: computeWeeklyDebriefReadiness({
      todayIso: input.todayIso,
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      plannedMinutes,
      resolvedMinutes,
      totalKeySessions: keySessions.length,
      resolvedKeySessions
    }),
    sourceUpdatedAt: getSourceUpdatedAt([
      ...input.sessions.map((session) => session.updated_at ?? session.created_at),
      ...input.activities.map((activity) => activity.updated_at ?? activity.created_at ?? activity.start_time_utc),
      ...input.links.map((link) => link.created_at ?? null),
      input.weeklyCheckinUpdatedAt,
      input.latestFeelUpdatedAt
    ])
  } satisfies WeeklyDebriefSourceState;
}

export async function computeWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  todayIso: string;
}) {
  const inputs = await loadWeeklyDebriefInputs(args);
  const base = buildWeeklyDebriefFacts(inputs);

  // Load recent feedback, session comparison trends, and training scores in parallel
  const [{ data: feedbackRows }, { data: comparisonRows }, { data: scoreRows }] = await Promise.all([
    args.supabase
      .from("weekly_debriefs")
      .select("week_start, helpful, accurate, feedback_note")
      .eq("athlete_id", args.athleteId)
      .lt("week_start", args.weekStart)
      .or("helpful.is.not.null,accurate.is.not.null")
      .order("week_start", { ascending: false })
      .limit(4),
    args.supabase
      .from("session_comparisons")
      .select("discipline, trend_direction, trend_confidence, comparison_summary")
      .eq("user_id", args.athleteId)
      .gte("created_at", `${args.weekStart}T00:00:00.000Z`)
      .lte("created_at", `${addDays(args.weekEnd, 1)}T00:00:00.000Z`)
      .limit(10),
    args.supabase
      .from("training_scores")
      .select("score_date, composite_score, execution_quality, progression_signal, balance_score")
      .eq("user_id", args.athleteId)
      .gte("score_date", args.weekStart)
      .lte("score_date", args.weekEnd)
      .order("score_date", { ascending: true })
      .limit(7)
  ]);

  const recentFeedback = (feedbackRows ?? []).map((r) => ({
    weekStart: r.week_start as string,
    helpful: r.helpful as boolean | null,
    accurate: r.accurate as boolean | null,
    note: r.feedback_note as string | null,
  }));

  // Build trends summary from session comparisons
  type CompRow = { discipline: string; trend_direction: string; trend_confidence: string; comparison_summary: string };
  const comparisons = (comparisonRows ?? []) as CompRow[];
  const trendsThisWeek = comparisons.length > 0
    ? comparisons.map((c) => ({
        discipline: c.discipline,
        trend: c.trend_direction,
        confidence: c.trend_confidence,
        summary: c.comparison_summary
      }))
    : null;

  // Build score trajectory from daily scores
  type ScoreRow = { score_date: string; composite_score: number; execution_quality: number | null; progression_signal: number | null; balance_score: number | null };
  const scores = (scoreRows ?? []) as ScoreRow[];
  const scoreTrajectory = scores.length > 0
    ? scores.map((s) => ({
        date: s.score_date,
        composite: Math.round(s.composite_score),
        execution: s.execution_quality != null ? Math.round(s.execution_quality) : null,
        progression: s.progression_signal != null ? Math.round(s.progression_signal) : null,
        balance: s.balance_score != null ? Math.round(s.balance_score) : null
      }))
    : null;

  // Two-pass: analytic findings (gpt-5.4, effort: medium) → narrative (gpt-5-mini).
  // If the analytic pass falls back, the narrative pass runs single-pass on raw inputs.
  const analytic = await generateAnalyticFindings({
    facts: base.facts,
    evidence: base.evidence,
    activityEvidence: base.activityEvidence,
    athleteContext: inputs.athleteContext,
    checkIn: inputs.checkIn,
    recentFeedback: recentFeedback.length > 0 ? recentFeedback : undefined,
    trendsThisWeek,
    scoreTrajectory,
  });

  const generated = await generateNarrative({
    facts: base.facts,
    evidence: base.evidence,
    activityEvidence: base.activityEvidence,
    athleteContext: inputs.athleteContext,
    checkIn: inputs.checkIn,
    deterministicFallback: base.deterministicNarrative,
    recentFeedback: recentFeedback.length > 0 ? recentFeedback : undefined,
    trendsThisWeek,
    scoreTrajectory,
    findings: analytic.findings,
  });
  const narrative = generated.narrative;
  const facts = weeklyDebriefFactsSchema.parse({
    ...base.facts,
    narrativeSource: generated.source
  });
  const coachShare = buildCoachShare({
    facts,
    narrative
  });

  return {
    readiness: base.readiness,
    facts,
    narrative,
    coachShare,
    evidence: base.evidence,
    evidenceGroups: base.evidenceGroups,
    sourceUpdatedAt: base.sourceUpdatedAt
  } satisfies WeeklyDebriefComputed;
}

export async function persistWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  weekEnd: string;
  computed: WeeklyDebriefComputed;
}) {
  if (!args.computed.readiness.isReady) {
    throw new Error("Weekly Debrief cannot be persisted before readiness is met.");
  }

  const generatedAt = new Date().toISOString();
  const factsPayload = {
    ...args.computed.facts,
    evidence: args.computed.evidence,
    evidenceGroups: args.computed.evidenceGroups
  };

  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .upsert({
      athlete_id: args.athleteId,
      user_id: args.athleteId,
      week_start: args.weekStart,
      week_end: args.weekEnd,
      status: "ready",
      source_updated_at: args.computed.sourceUpdatedAt,
      generated_at: generatedAt,
      generation_version: WEEKLY_DEBRIEF_GENERATION_VERSION,
      facts: factsPayload,
      narrative: args.computed.narrative,
      coach_share: args.computed.coachShare
    }, {
      onConflict: "athlete_id,week_start"
    })
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Could not persist weekly debrief.");
  }

  return normalizePersistedArtifact(data as WeeklyDebriefRecord, "ready");
}

export async function getPersistedWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
}) {
  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .eq("athlete_id", args.athleteId)
    .eq("week_start", args.weekStart)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? (data as WeeklyDebriefRecord) : null;
}

export function isWeeklyDebriefStale(args: {
  persisted: Pick<WeeklyDebriefRecord, "generated_at" | "source_updated_at" | "status" | "generation_version"> | null;
  sourceUpdatedAt: string;
}) {
  if (!args.persisted) return false;
  if (args.persisted.status === "failed") return false;
  return args.persisted.generation_version !== WEEKLY_DEBRIEF_GENERATION_VERSION ||
    args.sourceUpdatedAt > args.persisted.generated_at ||
    args.persisted.source_updated_at !== args.sourceUpdatedAt;
}

export async function getWeeklyDebriefSnapshot(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  timeZone: string;
  todayIso: string;
}) {
  const weekEnd = addDays(args.weekStart, 6);
  const sourceState = computeWeeklyDebriefSourceState(await loadWeeklyDebriefSourceInputs({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    timeZone: args.timeZone,
    todayIso: args.todayIso
  }));

  if (!sourceState.readiness.isReady) {
    return {
      readiness: sourceState.readiness,
      artifact: null,
      stale: false,
      sourceUpdatedAt: sourceState.sourceUpdatedAt,
      weekStart: args.weekStart,
      weekEnd
    } satisfies WeeklyDebriefSnapshot;
  }

  const persisted = await getPersistedWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart
  });

  if (!persisted) {
    return {
      readiness: sourceState.readiness,
      artifact: null,
      stale: false,
      sourceUpdatedAt: sourceState.sourceUpdatedAt,
      weekStart: args.weekStart,
      weekEnd
    } satisfies WeeklyDebriefSnapshot;
  }

  const stale = isWeeklyDebriefStale({
    persisted,
    sourceUpdatedAt: sourceState.sourceUpdatedAt
  });
  const effectiveStatus = stale ? "stale" : persisted.status;
  return {
    readiness: sourceState.readiness,
    artifact: normalizePersistedArtifact(persisted, effectiveStatus),
    stale,
    sourceUpdatedAt: sourceState.sourceUpdatedAt,
    weekStart: args.weekStart,
    weekEnd
  } satisfies WeeklyDebriefSnapshot;
}

export async function refreshWeeklyDebrief(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
  timeZone: string;
  todayIso: string;
}) {
  const weekEnd = addDays(args.weekStart, 6);
  const computed = await computeWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    timeZone: args.timeZone,
    todayIso: args.todayIso
  });

  if (!computed.readiness.isReady) {
    return {
      readiness: computed.readiness,
      artifact: null
    };
  }

  const artifact = await persistWeeklyDebrief({
    supabase: args.supabase,
    athleteId: args.athleteId,
    weekStart: args.weekStart,
    weekEnd,
    computed
  });

  return {
    readiness: computed.readiness,
    artifact
  };
}

export async function saveWeeklyDebriefFeedback(args: {
  supabase: SupabaseClient;
  athleteId: string;
  input: WeeklyDebriefFeedbackInput;
}) {
  const parsed = weeklyDebriefFeedbackInputSchema.parse(args.input);
  const feedbackUpdatedAt = new Date().toISOString();
  const { data, error } = await args.supabase
    .from("weekly_debriefs")
    .update({
      helpful: parsed.helpful,
      accurate: parsed.accurate,
      feedback_note: parsed.note ?? null,
      feedback_updated_at: feedbackUpdatedAt
    })
    .eq("athlete_id", args.athleteId)
    .eq("week_start", parsed.weekStart)
    .select("week_start,week_end,status,source_updated_at,generated_at,generation_version,facts,narrative,coach_share,helpful,accurate,feedback_note,feedback_updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Weekly Debrief must be generated before feedback can be saved.");
  }

  return normalizePersistedArtifact(data as WeeklyDebriefRecord, data.status);
}

export async function getAdjacentWeeklyDebriefs(args: {
  supabase: SupabaseClient;
  athleteId: string;
  weekStart: string;
}) {
  const [{ data: prevData, error: prevError }, { data: nextData, error: nextError }] = await Promise.all([
    args.supabase
      .from("weekly_debriefs")
      .select("week_start")
      .eq("athlete_id", args.athleteId)
      .lt("week_start", args.weekStart)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
    args.supabase
      .from("weekly_debriefs")
      .select("week_start")
      .eq("athlete_id", args.athleteId)
      .gt("week_start", args.weekStart)
      .order("week_start", { ascending: true })
      .limit(1)
      .maybeSingle()
  ]);

  if (prevError) throw new Error(prevError.message);
  if (nextError) throw new Error(nextError.message);

  return {
    previousWeekStart: prevData?.week_start ?? null,
    nextWeekStart: nextData?.week_start ?? null
  };
}
