import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isMissingCompletedActivityColumnError } from "@/lib/activities/completed-activities";
import { createClient } from "@/lib/supabase/server";
import { RegenerateReviewButton } from "./regenerate-review-button";
import { createReviewViewModel, durationLabel, toneToBadgeClass, toneToTextClass, type SessionReviewRow } from "@/lib/session-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { buildExecutionResultForSession, shouldRefreshExecutionResultFromActivity, syncExtraActivityExecution } from "@/lib/workouts/session-execution";
import { parsePersistedExecutionReview } from "@/lib/execution-review";
import { FeelCaptureBanner } from "./components/feel-capture-banner";
import { IntentCaptureStep } from "./components/intent-capture-step";
import { SessionVerdictCard } from "./components/session-verdict-card";
import { BlockExecutionTable } from "@/components/session/BlockExecutionTable";
import { assembleAnalyzerContext } from "@/lib/execution-review";
import { loadResolvedIntent } from "@/lib/intent/persist";
import type { ResolvedIntent } from "@/lib/intent/types";
import type { DetectedBlock } from "@/lib/blocks/types";
import { ExtrasVerdictCard } from "./components/extras-verdict-card";
import { SessionComparisonCard } from "./components/session-comparison-card";
import { RaceSegmentList } from "./components/race-segment-list";
import type { RaceSegmentSummary } from "@/lib/race/types";
import { RaceReviewPlaceholder } from "./components/race-review-card";
import { renderRaceReview, type RaceReviewRow } from "./race-review-render";
import { RaceVerdictCard, type VerdictPayload } from "../../races/[bundleId]/components/race-verdict-card";
import { RaceStoryCard, type RaceStoryPayload } from "../../races/[bundleId]/components/race-story-card";
import { UnifiedPacingArc } from "../../races/[bundleId]/components/unified-pacing-arc";
import type { PacingArcData } from "@/lib/race-review/pacing-arc";
import { RegenerateRaceReviewButton } from "./components/regenerate-race-review-button";
import { isRaceSession } from "@/lib/training/race-session";
import { DetailsAccordion } from "../../details-accordion";
import { getMonday } from "../../week-context";

type SessionRow = SessionReviewRow;

type LegacySessionRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration?: number | null;
  notes?: string | null;
};

type ActivityReviewRow = {
  id: string;
  user_id: string;
  upload_id: string | null;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec?: number | null;
  laps_count?: number | null;
  parse_summary?: Record<string, unknown> | null;
  metrics_v2?: Record<string, unknown> | null;
  execution_result?: Record<string, unknown> | null;
  updated_at?: string | null;
};

function isMissingColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /(schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

type SessionsMinimalRow = {
  id: string;
  athlete_id?: string;
  user_id?: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes?: number | null;
  target?: string | null;
  notes?: string | null;
  status?: "planned" | "completed" | "skipped" | null;
};

function toSessionRow(row: SessionRow | SessionsMinimalRow): SessionRow {
  return {
    id: row.id,
    user_id: "user_id" in row ? row.user_id : undefined,
    date: row.date,
    sport: row.sport,
    type: row.type,
    session_name: "session_name" in row ? row.session_name ?? row.type : row.type,
    discipline: "discipline" in row ? row.discipline ?? row.sport : row.sport,
    subtype: "subtype" in row ? row.subtype ?? null : null,
    workout_type: "workout_type" in row ? row.workout_type ?? null : null,
    intent_category: "intent_category" in row ? row.intent_category ?? null : null,
    target: "target" in row ? row.target ?? null : null,
    duration_minutes: row.duration_minutes ?? null,
    status: row.status ?? "completed",
    execution_result: "execution_result" in row ? row.execution_result ?? null : null,
    has_linked_activity: false
  };
}

const reviewDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function narrativeSourceLabel(source: "ai" | "fallback" | "legacy_unknown") {
  if (source === "ai") return "AI review";
  if (source === "fallback") return "Fallback review";
  return "Source unknown";
}

function narrativeSourcePillClass(source: "ai" | "fallback" | "legacy_unknown") {
  if (source === "ai") {
    return "rounded-full border border-[rgba(190,255,0,0.25)] bg-[rgba(190,255,0,0.10)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--color-accent)]";
  }
  if (source === "fallback") {
    return "rounded-full border border-[rgba(255,180,60,0.3)] bg-[rgba(255,180,60,0.12)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--warning))]";
  }
  return "rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-tertiary";
}

async function loadActivityReviewRow(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  activityId: string;
}) {
  const { supabase, userId, activityId } = params;

  const queries = [
    () =>
      supabase
        .from("completed_activities")
        .select("id,user_id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2,execution_result,updated_at")
        .eq("id", activityId)
        .eq("user_id", userId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,user_id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2,updated_at")
        .eq("id", activityId)
        .eq("user_id", userId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,user_id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power")
        .eq("id", activityId)
        .eq("user_id", userId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2,execution_result,updated_at")
        .eq("id", activityId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power")
        .eq("id", activityId)
        .maybeSingle()
  ];

  for (const runQuery of queries) {
    const { data, error } = await runQuery();
    if (data && !error) {
      return data as ActivityReviewRow;
    }
    if (error && !isMissingCompletedActivityColumnError(error)) {
      break;
    }
  }

  return null;
}

export default async function SessionReviewPage({ params, searchParams }: { params: { sessionId: string }; searchParams?: { postUpload?: string } }) {
  const isPostUpload = searchParams?.postUpload === "true";
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  let session: SessionRow | null = null;
  const activityRouteMatch = params.sessionId.match(/^activity-(.+)$/);
  const activityId = activityRouteMatch?.[1] ?? null;

  if (activityId) {
    const activity = await loadActivityReviewRow({ supabase, userId: user.id, activityId });
    if (!activity) redirect(`/activities/${activityId}`);

    let storedExecutionResult = parsePersistedExecutionReview(activity.execution_result ?? null);

    // Auto-generate AI review for extra sessions that don't have one yet
    if (!storedExecutionResult) {
      try {
        const generated = await syncExtraActivityExecution({ supabase, userId: user.id, activityId });
        storedExecutionResult = parsePersistedExecutionReview(generated);
      } catch {
        // Fall back to local review if AI generation fails
        storedExecutionResult = null;
      }
    }

    const syntheticSession: SessionRow = {
      id: params.sessionId,
      user_id: user.id,
      date: new Date(activity.start_time_utc).toISOString().slice(0, 10),
      sport: activity.sport_type,
      type: "Extra workout",
      session_name: "Extra workout",
      discipline: activity.sport_type,
      target: null,
      duration_minutes: activity.duration_sec ? Math.round(activity.duration_sec / 60) : null,
      status: "completed",
      is_extra: true,
      execution_result: storedExecutionResult ?? buildExecutionResultForSession(
        {
          id: params.sessionId,
          user_id: user.id,
          sport: activity.sport_type,
          type: "Extra workout",
          // Extras have no planned duration — passing the actual duration
          // here would self-compare and falsely flag the session as matched.
          duration_minutes: null,
          target: null,
          intent_category: "extra workout",
          status: "completed"
        },
        {
          id: activity.id,
          sport_type: activity.sport_type,
          duration_sec: activity.duration_sec,
          distance_m: activity.distance_m,
          avg_hr: activity.avg_hr,
          avg_power: activity.avg_power,
          avg_pace_per_100m_sec: activity.avg_pace_per_100m_sec ?? null,
          laps_count: activity.laps_count ?? null,
          parse_summary: activity.parse_summary ?? null,
          metrics_v2: activity.metrics_v2 ?? null
        }
      ),
      has_linked_activity: true
    };

    session = syntheticSession;
  }

  const sessionQueries = activityId ? [] : [
    () =>
      supabase
        .from("sessions")
        .select("id,athlete_id,user_id,date,sport,type,session_name,discipline,subtype,workout_type,intent_category,target,duration_minutes,session_role,status,execution_result")
        .eq("id", params.sessionId)
        .eq("user_id", user.id)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,athlete_id,user_id,date,sport,type,session_name,discipline,subtype,workout_type,intent_category,target,duration_minutes,session_role,status,execution_result")
        .eq("id", params.sessionId)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,athlete_id,user_id,date,sport,type,target,duration_minutes,notes,status")
        .eq("id", params.sessionId)
        .eq("user_id", user.id)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,athlete_id,user_id,date,sport,type,target,duration_minutes,notes,status")
        .eq("id", params.sessionId)
        .maybeSingle()
  ];

  for (const runQuery of sessionQueries) {
    const { data, error } = await runQuery();
    if (data && !error) {
      session = toSessionRow(data as SessionRow | SessionsMinimalRow);
      break;
    }
    if (error && !isMissingColumnError(error)) {
      break;
    }
  }

  if (!session && !activityId) {
    const legacyQueries = [
      () =>
        supabase
          .from("planned_sessions")
          .select("id,date,sport,type,duration,notes")
          .eq("id", params.sessionId)
          .eq("user_id", user.id)
          .maybeSingle(),
      () => supabase.from("planned_sessions").select("id,date,sport,type,duration,notes").eq("id", params.sessionId).maybeSingle()
    ];

    for (const runQuery of legacyQueries) {
      const { data: legacyData, error: legacyError } = await runQuery();
      if (legacyData && !legacyError) {
        const legacy = legacyData as LegacySessionRow;
        session = {
          id: legacy.id,
          user_id: user.id,
          date: legacy.date,
          sport: legacy.sport,
          type: legacy.type,
          session_name: legacy.type,
          discipline: legacy.sport,
          target: null,
          duration_minutes: legacy.duration ?? null,
          status: "completed",
          execution_result: null
        };
        break;
      }
      if (legacyError && !isMissingColumnError(legacyError)) {
        break;
      }
    }
  }

  if (!session) notFound();

  let hasLinkedActivity = Boolean(activityId);
  let linkedActivityId: string | null = activityId;
  const linkQueries = activityId ? [] : [
    () =>
      supabase
        .from("session_activity_links")
        .select("completed_activity_id,confirmation_status")
        .eq("planned_session_id", session.id)
        .eq("user_id", user.id)
        .limit(5),
    () =>
      supabase
        .from("session_activity_links")
        .select("completed_activity_id")
        .eq("planned_session_id", session.id)
        .eq("user_id", user.id)
        .limit(5)
  ];

  for (const runQuery of linkQueries) {
    const { data, error } = await runQuery();
    if (error && !isMissingColumnError(error)) break;
    if (!error && Array.isArray(data)) {
      const confirmedLink = data.find((row) => {
        if (!("completed_activity_id" in row) || !row.completed_activity_id) return false;
        if (!("confirmation_status" in row)) return true;
        if (isPostUpload && row.confirmation_status === "suggested") return true;
        return row.confirmation_status === "confirmed" || row.confirmation_status === null;
      });
      hasLinkedActivity = Boolean(confirmedLink);
      linkedActivityId = confirmedLink?.completed_activity_id ?? null;
      break;
    }
  }

  if (hasLinkedActivity && linkedActivityId) {
    try {
      const { data: activity } = await supabase
        .from("completed_activities")
        .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2,updated_at")
        .eq("id", linkedActivityId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (activity) {
        const linkedActivityDetails = activity as {
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
          updated_at?: string | null;
        };
        if (!session.execution_result || shouldRefreshExecutionResultFromActivity(session.execution_result, linkedActivityDetails)) {
          session.execution_result = buildExecutionResultForSession(
            {
              id: session.id,
              athlete_id: (session as SessionRow & { athlete_id?: string }).athlete_id ?? user.id,
              user_id: session.user_id ?? user.id,
              sport: session.sport,
              type: session.type,
              duration_minutes: session.duration_minutes ?? null,
              target: session.target ?? null,
              intent_category: session.intent_category ?? null,
              session_name: session.session_name ?? session.type,
              session_role: (session as SessionRow & { session_role?: string | null }).session_role ?? null,
              status: session.status ?? "planned"
            },
            linkedActivityDetails
          );
          session.status = "completed";
        }
      }
    } catch {
      // Leave the session in the honest "analysis pending" state if local backfill fails.
    }
  }

  session.has_linked_activity = hasLinkedActivity;

  // Race bundle: load all linked segments when this is a race session.
  let raceSegmentList: RaceSegmentSummary[] | null = null;
  let raceBundleId: string | null = null;
  let raceReviewRow: RaceReviewRow | null = null;
  if (!activityId && isRaceSession({ type: session.type, session_name: session.session_name })) {
    try {
      const { data: raceLinks } = await supabase
        .from("session_activity_links")
        .select("completed_activity_id,confirmation_status")
        .eq("planned_session_id", session.id)
        .eq("user_id", user.id);

      const confirmedIds = (raceLinks ?? [])
        .filter((row: any) => row.confirmation_status === "confirmed" || row.confirmation_status === null)
        .map((row: any) => row.completed_activity_id as string);

      if (confirmedIds.length >= 3) {
        const { data: segmentRows } = await supabase
          .from("completed_activities")
          .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,race_segment_role,race_segment_index,race_bundle_id")
          .in("id", confirmedIds)
          .eq("user_id", user.id);

        const ordered = (segmentRows ?? [])
          .filter((row: any) => row.race_segment_role)
          .sort((a: any, b: any) => (a.race_segment_index ?? 0) - (b.race_segment_index ?? 0));

        if (ordered.length >= 3) {
          raceSegmentList = ordered.map((row: any) => ({
            activityId: row.id as string,
            role: row.race_segment_role as RaceSegmentSummary["role"],
            sport: row.sport_type as string,
            startTimeUtc: row.start_time_utc as string,
            durationSec: Number(row.duration_sec ?? 0),
            distanceM: row.distance_m !== null && row.distance_m !== undefined ? Number(row.distance_m) : null,
            avgHr: row.avg_hr !== null && row.avg_hr !== undefined ? Number(row.avg_hr) : null,
            avgPower: row.avg_power !== null && row.avg_power !== undefined ? Number(row.avg_power) : null
          }));

          // All segments share the same race_bundle_id by construction.
          raceBundleId = (ordered.find((row: any) => row.race_bundle_id)?.race_bundle_id as string | undefined) ?? null;
          if (raceBundleId) {
            const { data: reviewRow } = await supabase
              .from("race_reviews")
              .select(
                "headline,narrative,coach_take,transition_notes,pacing_notes," +
                  "discipline_distribution_actual,discipline_distribution_delta," +
                  "verdict,race_story,pacing_arc_data," +
                  "model_used,is_provisional,generated_at"
              )
              .eq("race_bundle_id", raceBundleId)
              .maybeSingle();
            raceReviewRow = (reviewRow ?? null) as unknown as RaceReviewRow | null;
          }
        }
      }
    } catch {
      raceSegmentList = null;
      raceBundleId = null;
      raceReviewRow = null;
    }
  }

  // Query session_feels for completed sessions (skip for activity-route synthetic sessions)
  let existingFeelData: {
    overall_feel: number | null;
    rpe: number | null;
    energy_level: string | null;
    legs_feel: string | null;
    motivation: string | null;
    sleep_quality: string | null;
    life_stress: string | null;
    note: string | null;
  } | null = null;
  if (session.status === "completed" && !activityId) {
    const { data: existingFeel } = await supabase
      .from("session_feels")
      .select("overall_feel, rpe, energy_level, legs_feel, motivation, sleep_quality, life_stress, note")
      .eq("session_id", session.id)
      .maybeSingle();
    existingFeelData = existingFeel as typeof existingFeelData;
  }

  const showFeelCapture = session.status === "completed" && !activityId;

  // Fetch existing session verdict for completed sessions (skip for activity-route synthetic sessions)
  type VerdictData = {
    purpose_statement: string;
    training_block_context: string | null;
    execution_summary: string;
    verdict_status: string;
    metric_comparisons: unknown[];
    key_deviations: unknown[] | null;
    adaptation_signal: string;
    adaptation_type: string | null;
    stale_reason: string | null;
    non_obvious_insight: string | null;
    teach: string | null;
  } | null;
  let existingVerdictData: VerdictData = null as VerdictData;
  if (session.status === "completed" && !activityId) {
    const { data: existingVerdict } = await supabase
      .from("session_verdicts")
      .select("purpose_statement, training_block_context, execution_summary, verdict_status, metric_comparisons, key_deviations, adaptation_signal, adaptation_type, stale_reason, raw_ai_response")
      .eq("session_id", session.id)
      .maybeSingle();
    if (existingVerdict) {
      // non_obvious_insight and teach live inside raw_ai_response JSONB (no
      // dedicated columns on session_verdicts). Surface them at the top level
      // so SessionVerdictCard can render without drilling into the blob.
      const raw = existingVerdict.raw_ai_response as Record<string, unknown> | null | undefined;
      const readStr = (key: string): string | null => {
        if (!raw || typeof raw !== "object") return null;
        const value = raw[key];
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      };
      existingVerdictData = {
        ...existingVerdict,
        non_obvious_insight: readStr("non_obvious_insight") ?? readStr("nonObviousInsight"),
        teach: readStr("teach"),
      } as VerdictData;
    }
  }

  // Phase 2 — resolved intent + detected blocks. Load the persisted intent so
  // the page can decide whether to show Intent Capture (post-upload, no
  // plan-prescribed structure, no resolved intent yet) and whether to render
  // the BlockExecutionTable below the verdict card (intent has structured
  // blocks, detector found them in the activity).
  let resolvedIntent: ResolvedIntent | null = null;
  let detectedBlocks: DetectedBlock[] = [];
  let detectedBlocksFtp: number | undefined;
  if (!activityId && session.status === "completed") {
    try {
      resolvedIntent = await loadResolvedIntent(session.id, supabase);
    } catch {
      resolvedIntent = null;
    }

    if (
      resolvedIntent &&
      resolvedIntent.structure !== "steady" &&
      (resolvedIntent.blocks?.length ?? 0) > 0 &&
      hasLinkedActivity
    ) {
      try {
        const analyzerCtx = await assembleAnalyzerContext(session.id, supabase);
        if (analyzerCtx?.detectedBlocks?.length) {
          detectedBlocks = analyzerCtx.detectedBlocks;
        }
        if (analyzerCtx?.physModel?.ftp) {
          detectedBlocksFtp = analyzerCtx.physModel.ftp;
        }
      } catch {
        detectedBlocks = [];
      }
    }
  }

  const hasPlanPrescribedStructure =
    Boolean(session.intent_category) && Boolean((session.target ?? "").trim());
  const showIntentCapture =
    !activityId &&
    session.status === "completed" &&
    hasLinkedActivity &&
    !hasPlanPrescribedStructure &&
    !resolvedIntent;

  // Load session comparison, AI comparisons, and trends for completed sessions
  let sessionComparison = null;
  let sessionTrends = null;
  let storedComparisons: Awaited<ReturnType<typeof import("@/lib/training/session-comparison-engine").getStoredComparisons>> = [];
  if (session.status === "completed") {
    const [comparisonResult, trendsResult, storedResult] = await Promise.allSettled([
      import("@/lib/training/session-comparison").then(({ getSessionComparison }) => getSessionComparison(supabase, session.id, user.id)),
      import("@/lib/training/trends").then(({ detectTrends }) => detectTrends(supabase, user.id, 6)),
      import("@/lib/training/session-comparison-engine").then(({ getStoredComparisons }) => getStoredComparisons(supabase, session.id, user.id))
    ]);
    sessionComparison = comparisonResult.status === "fulfilled" ? comparisonResult.value : null;
    sessionTrends = trendsResult.status === "fulfilled" ? trendsResult.value : null;
    storedComparisons = storedResult.status === "fulfilled" ? storedResult.value : [];
  }

  // Compute week start for breadcrumb links
  const sessionMonday = getMonday(new Date(`${session.date}T00:00:00.000Z`));
  const weekStartIso = sessionMonday.toISOString().slice(0, 10);

  // F41: fetch the ordered week in one query, then pick the siblings by
  // index. This makes same-day doubles resolve correctly — `gte`/`lte` on
  // date alone loses the ordering for rows that share `session.date`, so
  // the old prev/next pair would disagree about which same-day session
  // comes first. Indexing a single ordered list can't disagree.
  type NextSessionInfo = { id: string; session_name: string | null; type: string; date: string } | null;
  let nextSession: NextSessionInfo = null as NextSessionInfo;
  let prevSession: NextSessionInfo = null as NextSessionInfo;
  if (!activityId) {
    try {
      const weekEndIso = new Date(sessionMonday.getTime() + 6 * 86400000).toISOString().slice(0, 10);
      const weekStartIsoForNav = sessionMonday.toISOString().slice(0, 10);
      const { data: weekRows } = await supabase
        .from("sessions")
        .select("id,session_name,type,date,created_at")
        .eq("user_id", user.id)
        .gte("date", weekStartIsoForNav)
        .lte("date", weekEndIso)
        .in("status", ["planned", "completed"])
        .order("date", { ascending: true })
        .order("created_at", { ascending: true });
      if (Array.isArray(weekRows)) {
        const idx = weekRows.findIndex((row) => row.id === session.id);
        if (idx >= 0) {
          prevSession = (weekRows[idx - 1] ?? null) as typeof prevSession;
          nextSession = (weekRows[idx + 1] ?? null) as typeof nextSession;
        }
      }
    } catch {
      // Agent preview mock client may not support this shape — degrade gracefully
    }
  }

  // Week completion stats for post-upload flow
  let weekCompletedCount = 0;
  let weekTotalCount = 0;
  if (isPostUpload && !activityId) {
    const weekEndIso = new Date(sessionMonday.getTime() + 6 * 86400000).toISOString().slice(0, 10);
    const { data: weekSessions } = await supabase
      .from("sessions")
      .select("id,status")
      .eq("user_id", user.id)
      .gte("date", weekStartIso)
      .lte("date", weekEndIso);
    if (weekSessions) {
      weekTotalCount = weekSessions.length;
      weekCompletedCount = weekSessions.filter((s: { status?: string }) => s.status === "completed").length;
    }
  }

  const reviewVm = createReviewViewModel(session, { verdictAdaptationType: existingVerdictData?.adaptation_type ?? null });

  const sessionTitle = getSessionDisplayName({
    sessionName: session.session_name ?? session.type,
    discipline: session.discipline ?? session.sport,
    subtype: session.subtype,
    workoutType: session.workout_type,
    intentCategory: session.intent_category
  });

  const verdictAdaptationType = existingVerdictData?.adaptation_type ?? null;
  const disciplineLabel = getDisciplineMeta(session.sport).label;
  const sessionDateLabel = reviewDateFormatter.format(new Date(`${session.date}T00:00:00.000Z`));
  const hasSpecificPlannedIntent = reviewVm.plannedIntent.trim().toLowerCase() !== `${disciplineLabel.toLowerCase()} session intent`;
  const quietLabelClass = "card-kicker";

  // Use actual duration from execution_result when available, fall back to planned.
  // For race sessions, prefer the rolled-up segment-list total so the subtitle
  // reflects the real race time rather than the placeholder planned duration.
  const execReview = session.execution_result ? parsePersistedExecutionReview(session.execution_result) : null;
  const raceTotalDurationSec = raceSegmentList
    ? raceSegmentList.reduce((sum, segment) => sum + segment.durationSec, 0)
    : null;
  const actualDurationSec = raceTotalDurationSec ?? execReview?.deterministic?.actual?.durationSec ?? null;
  const actualDurationLabel = actualDurationSec
    ? durationLabel(Math.round(actualDurationSec / 60))
    : durationLabel(session.duration_minutes);

  // Training block context from verdict (e.g. "Week 8 of an 8-week Build block, 61 days to Warsaw 70.3")
  const blockContext = existingVerdictData?.training_block_context ?? null;

  // Score confidence qualifier for inline display.
  // Prefer a specific, actionable data-gap line when critical evidence is missing;
  // otherwise suppress generic hedging when the read is confident.
  const missingCriticalData = reviewVm.componentScores?.missingCriticalData ?? [];
  const dataCompletenessPct = reviewVm.componentScores?.dataCompletenessPct ?? 1;
  const intentMatchCapped = Boolean(reviewVm.componentScores?.intentMatch?.capped);
  const cappedDominantMetric = intentMatchCapped
    ? reviewVm.componentScores?.missingDominantMetric ?? null
    : null;
  const confidenceQualifier =
    cappedDominantMetric
      ? `${cappedDominantMetric} missing — likely on target`
      : missingCriticalData.length > 0
        ? `${missingCriticalData[0]} missing`
        : dataCompletenessPct < 0.6 && reviewVm.confidenceLabel === "low"
          ? "limited evidence"
          : null;

  // Determine the one-thing callout label — don't say "change" when the advice is "keep doing this"
  // Only treat as "keep doing" when the advice STARTS with maintenance language, not when those
  // words appear incidentally in change advice (e.g. "at the same effort" in a change recommendation).
  // Also override to "change" when the verdict explicitly suggests modifications.
  const verdictSuggestsChange = verdictAdaptationType && verdictAdaptationType !== "proceed";
  const isKeepDoingAdvice = !verdictSuggestsChange && reviewVm.oneThingToChange
    ? /^(maintain|keep doing|keep this|same targets|continue|no change)/i.test(reviewVm.oneThingToChange.trim())
    : false;
  const oneThingLabel = isKeepDoingAdvice ? "Keep doing" : "One thing to change";

  // Badge classes
  const sessionStatusBadgeClass =
    reviewVm.sessionStatusLabel.toLowerCase() === "completed"
      ? "rounded-full border border-[rgba(52,211,153,0.25)] bg-[rgba(52,211,153,0.12)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-success"
      : "rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-tertiary";
  const intentBadgeClass =
    reviewVm.intent.label === "Matched intent"
      ? "rounded-full border border-[rgba(190,255,0,0.25)] bg-[rgba(190,255,0,0.10)] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-[var(--color-accent)]"
      : `rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${toneToBadgeClass(reviewVm.intent.tone)}`;

  return (
    <section className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-tertiary" aria-label="Breadcrumb">
        <Link href="/dashboard" className="text-cyan-400 hover:text-cyan-300">Dashboard</Link>
        <span className="text-[rgba(255,255,255,0.3)]">/</span>
        <Link href={`/calendar?weekStart=${weekStartIso}`} className="text-cyan-400 hover:text-cyan-300">Calendar</Link>
        <span className="text-[rgba(255,255,255,0.3)]">/</span>
        <span className="truncate text-[rgba(255,255,255,0.6)]">{sessionTitle}</span>
      </nav>

      {/* ── Section 1: Header + score hero ──
          F38: score is the page's title — render it at 72px tabular-nums
          with an inline verdict label. The first 2-3 usefulMetrics sit
          beside the score so the user gets the headline stats without
          opening any accordion. */}
      <article className="surface p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[rgba(255,255,255,0.92)] sm:text-2xl">{sessionTitle}</h1>
            <p className="mt-1 text-sm text-muted">
              {disciplineLabel} · {sessionDateLabel} · {actualDurationLabel}
            </p>
          </div>
          <div className="flex flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            {raceSegmentList && raceBundleId ? (
              <RegenerateRaceReviewButton bundleId={raceBundleId} />
            ) : hasLinkedActivity ? (
              <RegenerateReviewButton sessionId={session.id} />
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={sessionStatusBadgeClass}>{reviewVm.sessionStatusLabel}</span>
          {!raceSegmentList ? (
            <>
              <span className={intentBadgeClass}>{reviewVm.intent.label}</span>
              {reviewVm.isReviewable ? (
                <span className={narrativeSourcePillClass(reviewVm.narrativeSource)}>
                  {narrativeSourceLabel(reviewVm.narrativeSource)}
                </span>
              ) : null}
            </>
          ) : null}
          {blockContext ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2.5 py-1 text-[11px] text-[rgba(255,255,255,0.78)]">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="text-tertiary" aria-hidden="true">
                <path d="M6 1L10.5 3.5V8.5L6 11L1.5 8.5V3.5L6 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              {blockContext}
            </span>
          ) : null}
        </div>

        {!raceSegmentList && reviewVm.isReviewable && reviewVm.score !== null ? (
          <div className="mt-5 flex flex-col gap-4 border-t border-[hsl(var(--border))] pt-5 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex items-baseline gap-3">
              <span
                className={`font-mono text-6xl font-semibold leading-none tabular-nums tracking-[-0.02em] sm:text-7xl ${toneToTextClass(reviewVm.scoreTone)}`}
              >
                {reviewVm.score}
              </span>
              <div className="min-w-0">
                <p className={`text-lg font-medium ${toneToTextClass(reviewVm.scoreTone)}`}>
                  {reviewVm.scoreBand}
                </p>
                {confidenceQualifier ? (
                  <p className="text-[11px] text-tertiary">{confidenceQualifier}</p>
                ) : null}
              </div>
            </div>
            {reviewVm.usefulMetrics.length > 0 ? (
              <div className="grid flex-1 grid-cols-3 gap-2">
                {reviewVm.usefulMetrics.slice(0, 3).map((metric) => (
                  <div
                    key={metric.label}
                    className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2"
                  >
                    <p className="text-[10px] uppercase tracking-[0.08em] text-tertiary">{metric.label}</p>
                    <p className="mt-1 text-sm font-medium tabular-nums text-white">{metric.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>

      {raceSegmentList && raceBundleId && raceReviewRow ? (
        renderRaceReview(raceBundleId, raceReviewRow)
      ) : raceSegmentList && raceBundleId ? (
        <RaceReviewPlaceholder bundleId={raceBundleId} />
      ) : null}

      {raceSegmentList && raceBundleId ? (
        <div className="flex justify-end">
          <Link
            href={`/races/${raceBundleId}`}
            className="inline-flex items-center gap-2 text-xs text-tertiary underline-offset-2 hover:underline"
          >
            View race summary →
          </Link>
        </div>
      ) : null}

      {raceSegmentList ? <RaceSegmentList segments={raceSegmentList} /> : null}

      {showFeelCapture ? <FeelCaptureBanner sessionId={session.id} existingFeel={existingFeelData} /> : null}

      {showIntentCapture ? <IntentCaptureStep sessionId={session.id} /> : null}

      {/* ── Section 2: "One thing" hero ──
          F37: promote this out of the old Coach's Take stack so the
          single most actionable takeaway gets its own emphasised card.
          The long-form analysis (purpose, execution assessment, metric
          table, why-it-matters, etc.) moves into the accordion below. */}
      {!raceSegmentList && reviewVm.isReviewable && reviewVm.oneThingToChange ? (
        <article
          className={`rounded-2xl border-l-[3px] p-5 ${
            isKeepDoingAdvice
              ? "border-l-[var(--color-success)] bg-[rgba(52,211,153,0.05)]"
              : "border-l-[var(--color-accent)] bg-[rgba(190,255,0,0.04)]"
          } border-y border-r border-[hsl(var(--border))]`}
        >
          <p className={`text-[11px] font-medium uppercase tracking-[0.14em] ${isKeepDoingAdvice ? "text-success" : "text-[var(--color-accent)]"}`}>
            {oneThingLabel}
          </p>
          <p className="mt-2 text-base font-medium leading-snug text-white">{reviewVm.oneThingToChange}</p>
          {reviewVm.whyItMatters ? (
            <p className="mt-2 text-sm text-[rgba(255,255,255,0.68)]">{reviewVm.whyItMatters}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: how do I apply "${reviewVm.oneThingToChange}" to my next session?`)}`}
              className="btn-primary px-3 text-xs"
            >
              Apply to next session
            </Link>
            {nextSession ? (
              <Link
                href={`/sessions/${nextSession.id}`}
                className="inline-flex items-center rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-tertiary transition-ui hover:border-[rgba(255,255,255,0.2)] hover:text-white"
              >
                Next: {nextSession.session_name ?? nextSession.type} →
              </Link>
            ) : null}
          </div>
        </article>
      ) : null}

      {/* Extras verdict card — reads from the CoachVerdict stored in execution_result */}
      {activityId && execReview?.verdict ? (
        <ExtrasVerdictCard
          verdict={execReview.verdict}
          intentCategory={execReview.deterministic?.planned?.intentCategory ?? session.intent_category ?? null}
          narrativeSource={execReview.narrativeSource}
          sessionId={session.id}
          sport={session.sport}
        />
      ) : null}

      {/* Post-upload: Impact on your week */}
      {isPostUpload && weekTotalCount > 0 ? (
        <article className="surface p-4 md:p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-tertiary">Impact on your week</p>
          <p className="mt-2 text-sm text-white">
            {weekCompletedCount} of {weekTotalCount} session{weekTotalCount === 1 ? "" : "s"} complete this week
          </p>
          {verdictAdaptationType === "modify" || verdictAdaptationType === "redistribute" ? (
            <p className="mt-2 text-sm text-[hsl(var(--warning))]">
              This session has triggered an adjustment to your upcoming training.{" "}
              <Link href={`/calendar?weekStart=${weekStartIso}`} className="text-cyan-400 hover:text-cyan-300">View adaptation →</Link>
            </p>
          ) : verdictAdaptationType === "proceed" ? (
            <p className="mt-2 text-sm text-muted">No changes needed — your plan continues as prescribed.</p>
          ) : null}
          {nextSession ? (
            <p className="mt-2 text-sm text-muted">
              Next up: <Link href={`/sessions/${nextSession.id}`} className="text-cyan-400 hover:text-cyan-300">{nextSession.session_name ?? nextSession.type}</Link> on {new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${nextSession.date}T00:00:00Z`))}
            </p>
          ) : null}
        </article>
      ) : null}

      {/* ── Section 3: Read full analysis (accordion) ──
          F37: everything long-form that used to live between the score
          and the sub-score breakdown now collapses here. Default closed.
          The SessionVerdictCard is rendered inside so its fetch still
          runs on mount, just behind a disclosure. */}
      {!raceSegmentList && reviewVm.isReviewable ? (
        <DetailsAccordion
          title="Read full analysis"
          summaryDetail={
            <span className="text-[11px] text-muted">
              Verdict · purpose · metric deltas · plan impact
            </span>
          }
        >
          <div className="space-y-4">
            {session.status === "completed" && !activityId ? (
              <SessionVerdictCard
                sessionId={session.id}
                existingVerdict={existingVerdictData as Parameters<typeof SessionVerdictCard>[0]["existingVerdict"]}
                sessionCompleted={true}
                discipline={session.discipline ?? session.sport}
              />
            ) : null}

            {resolvedIntent &&
            resolvedIntent.structure !== "steady" &&
            detectedBlocks.length > 0 ? (
              <BlockExecutionTable
                blocks={detectedBlocks}
                intent={resolvedIntent}
                highlightStrongest
                ftp={detectedBlocksFtp}
              />
            ) : null}

            {/* Execution diagnosis — shown for reviewable sessions without a verdict card (skipped, planned-sync) */}
            {session.status !== "completed" && reviewVm.actualExecutionSummary ? (
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Execution quality</p>
                <p className="mt-2 text-sm">{reviewVm.actualExecutionSummary}</p>
              </div>
            ) : null}
            {session.status !== "completed" && reviewVm.mainGap ? (
              <div className="border-t border-[hsl(var(--border))] pt-4">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{reviewVm.mainGapLabel}</p>
                <p className="mt-2 text-sm">{reviewVm.mainGap}</p>
              </div>
            ) : null}

            {/* This week — consolidated from old "This week" + "What this means for your plan" */}
            <div className="border-t border-[hsl(var(--border))] pt-4">
              <p className={quietLabelClass}>This week</p>
              <p className="mt-2 text-sm text-muted">{reviewVm.weekAction}</p>
              {reviewVm.loadContribution?.sessionTss != null ? (
                <p className="mt-1.5 text-xs text-tertiary">
                  {Math.round(reviewVm.loadContribution.sessionTss)} TSS
                  {reviewVm.loadContribution.weekTssPct != null
                    ? ` · ${Math.round(reviewVm.loadContribution.weekTssPct * 100)}% of weekly target`
                    : ""}
                </p>
              ) : null}
            </div>

            {/* Full metrics grid — 3 are already shown inline with the score,
                this exposes the rest (plus the first 3 for a consolidated view). */}
            {reviewVm.usefulMetrics.length > 3 ? (
              <div className="border-t border-[hsl(var(--border))] pt-4">
                <p className="mb-2 text-xs uppercase tracking-[0.14em] text-tertiary">All metrics</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {reviewVm.usefulMetrics.map((metric) => (
                    <div key={metric.label} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
                      <p className="text-xs text-muted">{metric.label}</p>
                      <p className="mt-1 text-base font-semibold text-white">{metric.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </DetailsAccordion>
      ) : !raceSegmentList ? (
        <section className="surface p-4 md:p-5">
          <div className="grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Planned intent</p>
              <p className="mt-2 text-sm">{reviewVm.plannedIntent}</p>
            </div>
            <div className="border-l border-[hsl(var(--border))] pl-5">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{reviewVm.unlockTitle}</p>
              <p className="mt-2 text-sm">{reviewVm.unlockDetail}</p>
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Section 4: Score Breakdown (visible by default) ── */}
      {!raceSegmentList && reviewVm.isReviewable && reviewVm.score !== null && reviewVm.componentScores ? (() => {
        const breakdownRows = [
          { key: "intentMatch", label: "Intent match", component: reviewVm.componentScores.intentMatch },
          { key: "pacingExecution", label: "Pacing & execution", component: reviewVm.componentScores.pacingExecution },
          { key: "completion", label: "Completion", component: reviewVm.componentScores.completion },
          { key: "recoveryCompliance", label: "Recovery compliance", component: reviewVm.componentScores.recoveryCompliance }
        ];
        // Refinement: flag the single lowest sub-score so the user's eye
        // lands on the metric pulling the headline down. Only highlight
        // when the lowest is actually weak (< 85) and genuinely trails the
        // rest (≥ 5 pts below the next-lowest) — otherwise a pack of
        // similar 90s would still render one as "bad".
        const sortedByScore = [...breakdownRows].sort((a, b) => a.component.score - b.component.score);
        const lowest = sortedByScore[0];
        const nextLowest = sortedByScore[1];
        const lowestKey =
          lowest && lowest.component.score < 85 && nextLowest && nextLowest.component.score - lowest.component.score >= 5
            ? lowest.key
            : null;
        return (
          <article className="surface p-4 md:p-5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">Score breakdown</p>
              <div className="flex flex-wrap items-center gap-2">
                {reviewVm.scoreBand ? (
                  <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] text-muted">
                    {reviewVm.scoreBand}
                  </span>
                ) : null}
                {reviewVm.executionCostLabel ? (
                  <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] text-muted">
                    Execution cost: {reviewVm.executionCostLabel}
                  </span>
                ) : null}
              </div>
            </div>
            {/* Refinement: weights collapse to a single explainer line so
                they stop fighting the sub-score numbers for attention. */}
            <p className="mt-1 text-[11px] text-tertiary">
              Weighted: Intent 40 · Pacing 25 · Completion 20 · Recovery 15
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:gap-x-5 sm:gap-y-4">
              {breakdownRows.map(({ key, label, component }) => {
                const isLowest = key === lowestKey;
                return (
                  <div key={label}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${isLowest ? "text-warning" : "text-white"}`}>{label}</span>
                        {isLowest ? (
                          <span className="rounded-full border border-warning/30 bg-warning/5 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-warning">Lowest</span>
                        ) : null}
                        {component.capped ? (
                          <span className="rounded-full border border-warning/30 bg-warning/5 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-warning">Capped</span>
                        ) : null}
                      </div>
                      <span className={`font-mono tabular-nums ${isLowest ? "text-sm font-semibold text-warning" : "text-xs font-medium text-white"}`}>{component.score}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-snug text-muted">{component.detail}</p>
                  </div>
                );
              })}
            </div>
            {cappedDominantMetric ? (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                {cappedDominantMetric} data missing — Intent Match is capped because the primary effort signal for this session isn&apos;t there to confirm.
              </p>
            ) : missingCriticalData.length > 0 ? (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                {missingCriticalData[0]} missing — pair the right sensor next time to unlock a confirmed read.
              </p>
            ) : null}
          </article>
        );
      })() : null}

      {/* ── Section 5: Compared to Previous ── */}
      {sessionComparison ? <SessionComparisonCard comparison={sessionComparison} trends={sessionTrends ?? []} aiComparisons={storedComparisons} sport={session.sport} /> : null}

      {/* ── Section 6: Details + Follow-up (progressive disclosure) ── */}

      {reviewVm.uncertaintyDetail && dataCompletenessPct < 0.6 ? (
        <DetailsAccordion title="Data confidence" summaryDetail={
          <span className="text-[11px] text-muted">{reviewVm.uncertaintyTitle ?? "Limited data"}</span>
        }>
          <p className="text-sm text-muted">{reviewVm.uncertaintyDetail}</p>
          {reviewVm.missingEvidence.length > 0 ? (
            <p className="mt-2 text-sm text-muted">Missing: {reviewVm.missingEvidence.join(", ")}.</p>
          ) : null}
        </DetailsAccordion>
      ) : null}

      {/* Ask coach follow-up — hidden for race sessions; the race review card
          owns the next-step prescription and the standard prompts ("Why was
          this session flagged?") don't apply to multi-segment races. */}
      {!raceSegmentList ? (
        <section className="border-t border-[hsl(var(--border))] pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Ask coach follow-up</h2>
              <p className="mt-1 text-sm text-muted">{reviewVm.followUpIntro}</p>
            </div>
            <Link
              href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${reviewVm.followUpPrompts[0] ?? "What should I change next time?"}`)}`}
              className="btn-primary px-3 text-xs"
            >
              Ask coach
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {reviewVm.followUpPrompts.map((prompt) => (
              <Link
                key={prompt}
                href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${prompt}`)}`}
                className="inline-flex min-h-[44px] items-center rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-2 text-xs text-[rgba(255,255,255,0.55)] transition hover:border-[rgba(255,255,255,0.16)] hover:text-[rgba(255,255,255,0.75)] lg:min-h-0 lg:py-1.5"
              >
                {prompt}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* F41: footer walks the week — prev on the left, next on the right.
          Breadcrumb at the top of the page handles back-to-calendar, and
          the Ask-coach section above already has the primary coach CTA,
          so no "Back to Calendar" or "Ask Coach about this" here. The
          post-upload flow keeps its dedicated Dashboard + Calendar pair
          because the user just arrived from a fresh upload and hasn't
          seen either yet. */}
      <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-4">
        {isPostUpload ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-medium text-white hover:bg-[rgba(255,255,255,0.14)] lg:min-h-0"
            >
              Back to Dashboard
            </Link>
            <Link
              href={`/calendar?weekStart=${weekStartIso}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] px-4 py-2 text-sm text-[rgba(255,255,255,0.7)] hover:border-[rgba(255,255,255,0.2)] hover:text-white lg:min-h-0"
            >
              View Calendar
            </Link>
          </div>
        ) : (
          <>
            {prevSession ? (
              <Link
                href={`/sessions/${prevSession.id}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-tertiary transition-ui hover:text-white lg:min-h-0"
              >
                ← Prev: {prevSession.session_name ?? prevSession.type}
              </Link>
            ) : <span />}
            {nextSession ? (
              <Link
                href={`/sessions/${nextSession.id}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-tertiary transition-ui hover:text-white lg:min-h-0"
              >
                Next: {nextSession.session_name ?? nextSession.type} →
              </Link>
            ) : <span />}
          </>
        )}
      </nav>
    </section>
  );
}
