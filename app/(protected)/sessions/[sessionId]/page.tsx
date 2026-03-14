import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isMissingCompletedActivityColumnError } from "@/lib/activities/completed-activities";
import { createClient } from "@/lib/supabase/server";
import { createReviewViewModel, durationLabel, toneToBadgeClass, toneToTextClass, type SessionReviewRow } from "@/lib/session-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { buildExecutionResultForSession } from "@/lib/workouts/session-execution";

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
        .select("id,user_id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
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
        .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
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
      execution_result: buildExecutionResultForSession(
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

  if (hasLinkedActivity && linkedActivityId && !session.execution_result) {
    try {
      const { data: activity } = await supabase
        .from("completed_activities")
        .select("id,sport_type,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
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
        };
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
    } catch {
      // Leave the session in the honest "analysis pending" state if local backfill fails.
    }
  }

  session.has_linked_activity = hasLinkedActivity;

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

  return (
    <section className="space-y-4">
      <Link href="/calendar" className="text-sm text-cyan-300 underline-offset-2 hover:underline">← Back to Calendar</Link>

      <article className="review-hero p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-accent">Session review</p>
            <h1 className="mt-1 text-2xl font-semibold">{sessionTitle}</h1>
            <p className="mt-2 text-sm text-muted">{disciplineLabel} · {sessionDateLabel} · {durationLabel(session.duration_minutes)}</p>
          </div>
          <div className={`review-pill ${toneToBadgeClass(reviewVm.isReviewable ? reviewVm.intent.tone : "muted")}`}>
            {reviewVm.reviewModeLabel}
          </div>
        </div>

        <div className="mt-4 border-t border-[hsl(var(--border))] pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="review-pill text-tertiary">
              {reviewVm.sessionStatusLabel}
            </span>
            <span className={`review-pill ${toneToBadgeClass(reviewVm.intent.tone)}`}>
              {reviewVm.intent.label}
            </span>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <h2 className={`text-3xl font-semibold leading-tight ${toneToTextClass(reviewVm.isReviewable ? reviewVm.scoreTone : reviewVm.intent.tone)}`}>
                {reviewVm.isReviewable ? reviewVm.scoreHeadline : reviewVm.intent.label}
              </h2>
              <p className="mt-3 max-w-3xl text-base text-[hsl(var(--text-primary))]">{reviewVm.actualExecutionSummary}</p>
              <p className="mt-2 text-sm text-muted">{reviewVm.whyItMatters}</p>
            </div>

            <div className="border-l border-[hsl(var(--border))] pl-5">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">What to do next</p>
              <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{reviewVm.nextAction}</p>
              <p className="mt-4 text-xs uppercase tracking-[0.14em] text-tertiary">This week</p>
              <p className="mt-2 text-sm text-muted">{reviewVm.weekAction}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={`rounded-full border px-3 py-1.5 text-xs ${toneToBadgeClass(reviewVm.intent.tone)}`}>
              {reviewVm.intent.label}
            </span>
            {reviewVm.isReviewable && reviewVm.scoreConfidenceNote ? (
              <span className="rounded-full border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.08)] px-3 py-1.5 text-xs text-[hsl(var(--warning))]">
                Provisional
              </span>
            ) : null}
            {reviewVm.isReviewable ? (
              <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-muted">
                Cost: {reviewVm.executionCostLabel ?? "Unknown"}
              </span>
            ) : null}
            {reviewVm.confidenceLabel ? (
              <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-muted">
                Confidence: {reviewVm.confidenceLabel}
              </span>
            ) : null}
          </div>
        </div>
      </article>

      <section className="review-panel p-5">
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
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Main gap</p>
                <p className="mt-2 text-sm">{reviewVm.mainGap}</p>
              </div>
            </div>

            <div className="space-y-5 border-l border-[hsl(var(--border))] pl-5">
              {reviewVm.usefulMetrics.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {reviewVm.usefulMetrics.map((metric) => (
                    <div key={metric.label} className="review-card-soft p-4">
                      <p className="text-xs text-muted">{metric.label}</p>
                      <p className="mt-1 text-base font-semibold">{metric.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="review-card-soft p-4">
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
        <section className="review-card-soft px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[hsl(var(--warning))]">{reviewVm.uncertaintyTitle ?? "Uncertainty"}</p>
            <p className="mt-2 text-sm">{reviewVm.uncertaintyDetail}</p>
            {reviewVm.missingEvidence.length > 0 ? (
              <p className="mt-2 text-sm text-muted">Missing evidence: {reviewVm.missingEvidence.join(", ")}.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="coach-section-block pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Ask coach follow-up</h2>
            <p className="mt-1 text-sm text-muted">{reviewVm.followUpIntro}</p>
          </div>
          <Link
            href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${reviewVm.followUpPrompts[0] ?? "What should I change next time?"}`)}`}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Ask coach
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {reviewVm.followUpPrompts.map((prompt) => (
            <Link
              key={prompt}
              href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${prompt}`)}`}
              className="review-followup-chip transition"
            >
              {prompt}
            </Link>
          ))}
        </div>
      </section>
    </section>
  );
}
