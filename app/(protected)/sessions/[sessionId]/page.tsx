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
import { SessionVerdictCard } from "./components/session-verdict-card";
import { SessionComparisonCard } from "./components/session-comparison-card";
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
          duration_minutes: activity.duration_sec ? Math.round(activity.duration_sec / 60) : null,
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
  } | null;
  let existingVerdictData: VerdictData = null as VerdictData;
  if (session.status === "completed" && !activityId) {
    const { data: existingVerdict } = await supabase
      .from("session_verdicts")
      .select("purpose_statement, training_block_context, execution_summary, verdict_status, metric_comparisons, key_deviations, adaptation_signal, adaptation_type")
      .eq("session_id", session.id)
      .maybeSingle();
    existingVerdictData = existingVerdict as typeof existingVerdictData;
  }

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

  // Query for next session in the same week for forward navigation
  // Uses gte + neq to include same-day sessions, filters out skipped, and
  // orders by date then created_at so double-session days resolve correctly.
  type NextSessionInfo = { id: string; session_name: string | null; type: string; date: string } | null;
  let nextSession: NextSessionInfo = null as NextSessionInfo;
  if (!activityId) {
    try {
      const weekEndIso = new Date(sessionMonday.getTime() + 6 * 86400000).toISOString().slice(0, 10);
      const { data: nextCandidates } = await supabase
        .from("sessions")
        .select("id,session_name,type,date,created_at")
        .eq("user_id", user.id)
        .gte("date", session.date)
        .lte("date", weekEndIso)
        .in("status", ["planned", "completed"])
        .neq("id", session.id)
        .order("date", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(5);
      // The query already excludes the current session (neq) and orders by date + created_at,
      // so the first candidate is the correct next session, even for same-day doubles.
      nextSession = (nextCandidates?.[0] ?? null) as typeof nextSession;
    } catch {
      // Agent preview mock client may not support .neq() — degrade gracefully
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

  const reviewVm = createReviewViewModel(session);

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

  // Use actual duration from execution_result when available, fall back to planned
  const execReview = session.execution_result ? parsePersistedExecutionReview(session.execution_result) : null;
  const actualDurationSec = execReview?.deterministic?.actual?.durationSec ?? null;
  const actualDurationLabel = actualDurationSec
    ? durationLabel(Math.round(actualDurationSec / 60))
    : durationLabel(session.duration_minutes);

  // Training block context from verdict (e.g. "Week 8 of an 8-week Build block, 61 days to Warsaw 70.3")
  const blockContext = existingVerdictData?.training_block_context ?? null;

  // Score confidence qualifier for inline display
  const confidenceQualifier =
    reviewVm.confidenceLabel === "low" ? "early read"
    : reviewVm.confidenceLabel === "medium" ? "moderate confidence"
    : null;

  // Determine the one-thing callout label — don't say "change" when the advice is "keep doing this"
  const isKeepDoingAdvice = reviewVm.oneThingToChange
    ? /maintain|keep|same|continue|no change/i.test(reviewVm.oneThingToChange)
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

      {/* ── Section 1: Header ── */}
      <article className="surface p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{sessionTitle}</h1>
            <p className="mt-1.5 text-sm text-muted">
              {disciplineLabel} · {sessionDateLabel} · {actualDurationLabel}
            </p>
            {blockContext ? (
              <p className="mt-1 text-xs text-tertiary">{blockContext}</p>
            ) : null}
          </div>
          <div className="flex flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            {hasLinkedActivity ? <RegenerateReviewButton sessionId={session.id} /> : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={sessionStatusBadgeClass}>{reviewVm.sessionStatusLabel}</span>
          <span className={intentBadgeClass}>{reviewVm.intent.label}</span>
          {reviewVm.isReviewable ? (
            <span className={narrativeSourcePillClass(reviewVm.narrativeSource)}>
              {narrativeSourceLabel(reviewVm.narrativeSource)}
            </span>
          ) : null}
        </div>

        {reviewVm.isReviewable && reviewVm.score !== null ? (
          <div className="mt-4 flex items-baseline gap-3">
            <span className={`font-mono text-3xl font-semibold ${toneToTextClass(reviewVm.scoreTone)}`}>
              {reviewVm.score}
            </span>
            <span className={`text-base font-medium ${toneToTextClass(reviewVm.scoreTone)}`}>
              {reviewVm.scoreBand}
            </span>
            {confidenceQualifier ? (
              <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10px] text-tertiary">
                {confidenceQualifier}
              </span>
            ) : null}
          </div>
        ) : null}
      </article>

      {showFeelCapture ? <FeelCaptureBanner sessionId={session.id} existingFeel={existingFeelData} /> : null}

      {/* ── Section 2: The Numbers (promoted to hero position) ── */}
      {session.status === "completed" && !activityId ? (
        <SessionVerdictCard
          sessionId={session.id}
          existingVerdict={existingVerdictData as Parameters<typeof SessionVerdictCard>[0]["existingVerdict"]}
          sessionCompleted={true}
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

      {/* ── Section 3: Coach's Take (consolidated narrative) ── */}
      <section className="surface p-4 md:p-5">
        {reviewVm.isReviewable ? (
          <div className="space-y-4">
            {/* One thing to change / Keep doing */}
            {reviewVm.oneThingToChange ? (
              <div className={`rounded-xl border p-4 ${isKeepDoingAdvice
                ? "border-[rgba(52,211,153,0.3)] bg-[rgba(52,211,153,0.06)]"
                : "border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent)/0.06)]"
              }`}>
                <p className={`text-xs uppercase tracking-[0.14em] ${isKeepDoingAdvice ? "text-success" : "text-[hsl(var(--accent))]"}`}>
                  {oneThingLabel}
                </p>
                <p className="mt-2 text-sm font-medium text-white">{reviewVm.oneThingToChange}</p>
              </div>
            ) : null}

            {/* Why it matters */}
            {reviewVm.whyItMatters ? (
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Why it matters</p>
                <p className="mt-2 text-sm text-muted">{reviewVm.whyItMatters}</p>
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

            {/* Metrics grid — pulled from right sidebar to be inline */}
            {reviewVm.usefulMetrics.length > 0 ? (
              <div className="border-t border-[hsl(var(--border))] pt-4">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {reviewVm.usefulMetrics.map((metric) => (
                    <div key={metric.label} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
                      <p className="text-xs text-muted">{metric.label}</p>
                      <p className="mt-1 text-base font-semibold text-white">{metric.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
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
        )}
      </section>

      {/* ── Section 4: Compared to Previous ── */}
      {sessionComparison ? <SessionComparisonCard comparison={sessionComparison} trends={sessionTrends ?? []} aiComparisons={storedComparisons} /> : null}

      {/* ── Section 5: Details + Follow-up (progressive disclosure) ── */}

      {reviewVm.uncertaintyDetail ? (
        <DetailsAccordion title="Data confidence" summaryDetail={
          <span className="text-[11px] text-muted">{reviewVm.uncertaintyTitle ?? "Limited data"}</span>
        }>
          <p className="text-sm text-muted">{reviewVm.uncertaintyDetail}</p>
          {reviewVm.missingEvidence.length > 0 ? (
            <p className="mt-2 text-sm text-muted">Missing: {reviewVm.missingEvidence.join(", ")}.</p>
          ) : null}
        </DetailsAccordion>
      ) : null}

      {reviewVm.isReviewable && reviewVm.score !== null ? (
        <DetailsAccordion
          title="How is this scored?"
          summaryDetail={
            <span className="rounded-full border border-[rgba(190,255,0,0.25)] bg-[rgba(190,255,0,0.08)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-accent)]">
              {reviewVm.score}/100
            </span>
          }
        >
          <div className="space-y-3">
            {reviewVm.componentScores ? (
              <div className="space-y-3">
                {[
                  { label: "Intent match", weightLabel: "40%", score: reviewVm.componentScores.intentMatch.score, detail: reviewVm.componentScores.intentMatch.detail },
                  { label: "Pacing & execution", weightLabel: "25%", score: reviewVm.componentScores.pacingExecution.score, detail: reviewVm.componentScores.pacingExecution.detail },
                  { label: "Completion", weightLabel: "20%", score: reviewVm.componentScores.completion.score, detail: reviewVm.componentScores.completion.detail },
                  { label: "Recovery compliance", weightLabel: "15%", score: reviewVm.componentScores.recoveryCompliance.score, detail: reviewVm.componentScores.recoveryCompliance.detail }
                ].map((component) => {
                  const barColor = component.score >= 80 ? "bg-[hsl(var(--success))]"
                    : component.score >= 60 ? "bg-[hsl(var(--warning))]"
                    : component.score >= 40 ? "bg-[hsl(35,100%,50%)]"
                    : "bg-[hsl(var(--signal-risk))]";
                  return (
                    <div key={component.label}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-white">{component.label}</span>
                          <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-1.5 py-0.5 text-[9px] text-tertiary">{component.weightLabel}</span>
                        </div>
                        <span className="text-xs font-mono font-medium text-white">{component.score}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${component.score}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted">{component.detail}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted">
                Execution scores compare what actually happened against what was planned —
                across duration, intensity, intent alignment, and consistency. A higher score means the
                session delivered the intended training stimulus.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {reviewVm.scoreBand ? (
                <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2.5 py-1 text-[11px] text-muted">
                  Band: {reviewVm.scoreBand}
                </span>
              ) : null}
              {reviewVm.executionCostLabel ? (
                <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2.5 py-1 text-[11px] text-muted">
                  Execution cost: {reviewVm.executionCostLabel}
                </span>
              ) : null}
            </div>
          </div>
        </DetailsAccordion>
      ) : null}

      {/* Ask coach follow-up */}
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

      {/* Navigation footer */}
      <nav className="flex flex-wrap items-center gap-3 border-t border-[hsl(var(--border))] pt-4">
        {isPostUpload ? (
          <>
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
          </>
        ) : (
          <>
            <Link
              href={`/calendar?weekStart=${weekStartIso}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-medium text-white hover:bg-[rgba(255,255,255,0.14)] lg:min-h-0"
            >
              ← Back to Calendar
            </Link>
            {nextSession ? (
              <Link
                href={`/sessions/${nextSession.id}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.12)] px-4 py-2 text-sm text-[rgba(255,255,255,0.7)] hover:border-[rgba(255,255,255,0.2)] hover:text-white lg:min-h-0"
              >
                Next: {nextSession.session_name ?? nextSession.type} →
              </Link>
            ) : null}
          </>
        )}
        <Link
          href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: What should I focus on for my next session?`)}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300 lg:min-h-0"
        >
          Ask Coach about this
        </Link>
      </nav>
    </section>
  );
}
