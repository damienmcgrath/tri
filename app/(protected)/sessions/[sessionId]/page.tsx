import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isMissingCompletedActivityColumnError } from "@/lib/activities/completed-activities";
import { createClient } from "@/lib/supabase/server";
import { RegenerateReviewButton } from "./regenerate-review-button";
import { createReviewViewModel, durationLabel, toneToBadgeClass, toneToTextClass, type SessionReviewRow } from "@/lib/session-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { buildExecutionResultForSession, shouldRefreshExecutionResultFromActivity } from "@/lib/workouts/session-execution";
import { parsePersistedExecutionReview } from "@/lib/execution-review";
import { FeelCaptureBanner } from "./components/feel-capture-banner";
import { SessionComparisonCard } from "./components/session-comparison-card";
import { DetailsAccordion } from "../../details-accordion";

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

export default async function SessionReviewPage({ params }: { params: { sessionId: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  let session: SessionRow | null = null;
  const activityRouteMatch = params.sessionId.match(/^activity:(.+)$/);
  const activityId = activityRouteMatch?.[1] ?? null;

  if (activityId) {
    const activity = await loadActivityReviewRow({ supabase, userId: user.id, activityId });
    if (!activity) redirect(`/activities/${activityId}`);

    const storedExecutionResult = parsePersistedExecutionReview(activity.execution_result ?? null);
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
  let hasExistingFeel = false;
  if (session.status === "completed" && !activityId) {
    const { data: existingFeel } = await supabase
      .from("session_feels")
      .select("id")
      .eq("session_id", session.id)
      .maybeSingle();
    hasExistingFeel = Boolean(existingFeel);
  }

  const showFeelCapture = session.status === "completed" && !activityId && !hasExistingFeel;

  // Load session comparison and trends for completed sessions
  let sessionComparison = null;
  let sessionTrends = null;
  if (session.status === "completed" && !activityId) {
    const [comparisonResult, trendsResult] = await Promise.allSettled([
      import("@/lib/training/session-comparison").then(({ getSessionComparison }) => getSessionComparison(supabase, session.id, user.id)),
      import("@/lib/training/trends").then(({ detectTrends }) => detectTrends(supabase, user.id, 6))
    ]);
    sessionComparison = comparisonResult.status === "fulfilled" ? comparisonResult.value : null;
    sessionTrends = trendsResult.status === "fulfilled" ? trendsResult.value : null;
  }

  const reviewVm = createReviewViewModel(session);

  const sessionTitle = getSessionDisplayName({
    sessionName: session.session_name ?? session.type,
    discipline: session.discipline ?? session.sport,
    subtype: session.subtype,
    workoutType: session.workout_type,
    intentCategory: session.intent_category
  });

  const disciplineLabel = getDisciplineMeta(session.sport).label;
  const sessionDateLabel = reviewDateFormatter.format(new Date(`${session.date}T00:00:00.000Z`));
  const hasSpecificPlannedIntent = reviewVm.plannedIntent.trim().toLowerCase() !== `${disciplineLabel.toLowerCase()} session intent`;
  const plannedColumnLabel = session.is_extra ? "Weekly context" : "Planned";
  const ghostPillClass =
    "rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-[11px] font-medium text-[rgba(255,255,255,0.6)]";
  const quietLabelClass = "card-kicker";
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
      <Link href="/calendar" className="text-sm text-cyan-300 underline-offset-2 hover:underline">← Back to Calendar</Link>

      {showFeelCapture ? <FeelCaptureBanner sessionId={session.id} /> : null}

      <article className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label">Session review</p>
            <h1 className="mt-1 text-2xl font-semibold">{sessionTitle}</h1>
            <p className="mt-2 text-sm text-muted">{disciplineLabel} · {sessionDateLabel} · {durationLabel(session.duration_minutes)}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className={`rounded-full border px-3 py-1 text-xs font-medium ${toneToBadgeClass(reviewVm.isReviewable ? reviewVm.intent.tone : "muted")}`}>
              {reviewVm.reviewModeLabel}
            </div>
            {hasLinkedActivity ? <RegenerateReviewButton sessionId={session.id} /> : null}
          </div>
        </div>

        <div className="mt-4 border-t border-[hsl(var(--border))] pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={sessionStatusBadgeClass}>
              {reviewVm.sessionStatusLabel}
            </span>
            <span className={intentBadgeClass}>
              {reviewVm.intent.label}
            </span>
            {reviewVm.isReviewable ? (
              <span className={narrativeSourcePillClass(reviewVm.narrativeSource)}>
                {narrativeSourceLabel(reviewVm.narrativeSource)}
              </span>
            ) : null}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <h2 className={`text-[22px] font-medium leading-tight ${toneToTextClass(reviewVm.isReviewable ? reviewVm.scoreTone : reviewVm.intent.tone)}`}>
                {reviewVm.isReviewable ? reviewVm.scoreHeadline : reviewVm.intent.label}
              </h2>
              <p className="mt-3 max-w-3xl text-base text-[hsl(var(--text-primary))]" style={{ color: "hsl(var(--text-primary))" }}>{reviewVm.actualExecutionSummary}</p>
              <p className="mt-2 text-sm text-muted">{reviewVm.whyItMatters}</p>
            </div>

            <div className="border-l border-[hsl(var(--border))] pl-5">
              <p className={quietLabelClass}>What to do next</p>
              <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{reviewVm.nextAction}</p>
              <p className={`mt-4 ${quietLabelClass}`}>This week</p>
              <p className="mt-2 text-sm text-muted">{reviewVm.weekAction}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={ghostPillClass}>
              {reviewVm.intent.label}
            </span>
            {reviewVm.isReviewable && reviewVm.scoreConfidenceNote ? (
              <span className={ghostPillClass}>
                Provisional
              </span>
            ) : null}
            {reviewVm.isReviewable ? (
              <span className={ghostPillClass}>
                Cost: {reviewVm.executionCostLabel ?? "Unknown"}
              </span>
            ) : null}
            {reviewVm.confidenceLabel ? (
              <span className={ghostPillClass}>
                Confidence: {reviewVm.confidenceLabel}
              </span>
            ) : null}
          </div>
        </div>
      </article>

      <section className="surface p-5">
        {reviewVm.isReviewable ? (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-5">
              {hasSpecificPlannedIntent ? (
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{plannedColumnLabel}</p>
                  <p className="mt-2 text-sm">{reviewVm.plannedIntent}</p>
                </div>
              ) : null}
              <div className={hasSpecificPlannedIntent ? "border-t border-[hsl(var(--border))] pt-5" : ""}>
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">What happened</p>
                <p className="mt-2 text-sm">{reviewVm.actualExecutionSummary}</p>
              </div>
              <div className="border-t border-[hsl(var(--border))] pt-5">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{reviewVm.mainGapLabel}</p>
                <p className="mt-2 text-sm">{reviewVm.mainGap}</p>
              </div>
            </div>

            <div className="space-y-5 border-l border-[hsl(var(--border))] pl-5">
              {reviewVm.usefulMetrics.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {reviewVm.usefulMetrics.map((metric) => (
                    <div key={metric.label} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                      <p className="text-xs text-muted">{metric.label}</p>
                      <p
                        className={`mt-1 ${metric.label === "Duration completed" ? "font-mono text-[28px] font-medium text-success" : "text-base font-semibold text-[hsl(var(--text-primary))]"}`}
                        style={metric.label === "Duration completed" ? undefined : { color: "hsl(var(--text-primary))" }}
                      >
                        {metric.value}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Available evidence</p>
                  <p className="mt-2 text-sm text-muted">{reviewVm.unlockDetail}</p>
                </div>
              )}
              <div className="border-t border-[hsl(var(--border))] pt-5">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Why it matters</p>
                <p className="mt-2 text-sm text-muted">{reviewVm.whyItMatters}</p>
              </div>
            </div>
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

      {reviewVm.uncertaintyDetail ? (
        <section className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[var(--color-surface)] px-5 py-4" style={{ borderLeftWidth: "2px", borderLeftColor: "#FFB43C" }}>
          <div>
            <p className="label-base text-[10px] text-[hsl(var(--warning))]">Early read</p>
            <p className="mt-2 text-sm">{reviewVm.uncertaintyDetail}</p>
            {reviewVm.missingEvidence.length > 0 ? (
              <p className="mt-2 text-sm text-muted">Missing evidence: {reviewVm.missingEvidence.join(", ")}.</p>
            ) : null}
          </div>
        </section>
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
            <p className="text-xs text-muted">
              Execution scores compare what actually happened against what was planned —
              across duration, intensity, intent alignment, and consistency. A higher score means the
              session delivered the intended training stimulus.
            </p>
            {reviewVm.usefulMetrics.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {reviewVm.usefulMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-tertiary">{metric.label}</p>
                    <p className="mt-0.5 text-sm font-semibold text-[hsl(var(--text-primary))]">{metric.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {reviewVm.missingEvidence.length > 0 ? (
              <div className="rounded-xl border border-[rgba(255,179,60,0.20)] bg-[rgba(255,179,60,0.06)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--warning))]">Missing evidence</p>
                <p className="mt-0.5 text-xs text-muted">{reviewVm.missingEvidence.join(" · ")}</p>
              </div>
            ) : null}
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
              {reviewVm.confidenceLabel ? (
                <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2.5 py-1 text-[11px] text-muted">
                  Confidence: {reviewVm.confidenceLabel}
                </span>
              ) : null}
            </div>
          </div>
        </DetailsAccordion>
      ) : null}

      {sessionComparison ? <SessionComparisonCard comparison={sessionComparison} trends={sessionTrends ?? []} /> : null}

      <section className="border-t border-[hsl(var(--border))] pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Ask coach follow-up</h2>
            <p className="mt-1 text-sm text-muted">{reviewVm.followUpIntro}</p>
          </div>
          <Link
            href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${reviewVm.followUpPrompts[0] ?? "What should I change next time?"}`)}`}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            Ask coach
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {reviewVm.followUpPrompts.map((prompt) => (
            <Link
              key={prompt}
              href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${prompt}`)}`}
              className="rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.55)] transition hover:border-[rgba(255,255,255,0.16)] hover:text-[rgba(255,255,255,0.75)]"
            >
              {prompt}
            </Link>
          ))}
        </div>
      </section>
    </section>
  );
}
