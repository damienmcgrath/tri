import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isMissingCompletedActivityColumnError } from "@/lib/activities/completed-activities";
import { createClient } from "@/lib/supabase/server";
import { createReviewViewModel, durationLabel, toneToBadgeClass, toneToTextClass, type SessionReviewRow } from "@/lib/session-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { parsePersistedExecutionReview } from "@/lib/execution-review";
import { buildExecutionResultForSession } from "@/lib/workouts/session-execution";
import { RegenerateReviewButton } from "@/app/(protected)/sessions/[sessionId]/regenerate-review-button";

type ActivityReviewRow = {
  id: string;
  user_id?: string;
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
};

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
        .select("id,user_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2,execution_result")
        .eq("id", activityId)
        .eq("user_id", userId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,user_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
        .eq("id", activityId)
        .eq("user_id", userId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,user_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power")
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

const reviewDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function ActivitySessionReviewPage({ params }: { params: { activityId: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const activity = await loadActivityReviewRow({ supabase, userId: user.id, activityId: params.activityId });
  if (!activity) notFound();

  const storedExecutionResult = parsePersistedExecutionReview(activity.execution_result ?? null);
  const session: SessionReviewRow = {
    id: `activity:${activity.id}`,
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
        id: `activity:${activity.id}`,
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
  const comparisonHeading = reviewVm.isReviewable ? "Session impact" : "Review unlock";
  const leftColumnLabel = "Weekly context";
  const outcomeLabel = session.is_extra ? "Week effect" : reviewVm.isReviewable ? "Intent result" : "Session status";

  return (
    <section className="space-y-4">
      <Link href="/calendar" className="text-sm text-cyan-300 underline-offset-2 hover:underline">← Back to Calendar</Link>

      <article className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-accent">Session review</p>
            <h1 className="mt-1 text-2xl font-semibold">{sessionTitle}</h1>
            <p className="mt-2 text-sm text-muted">{disciplineLabel} · {sessionDateLabel} · {durationLabel(session.duration_minutes)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className={`rounded-full border px-3 py-1 text-xs font-medium ${toneToBadgeClass(reviewVm.isReviewable ? reviewVm.intent.tone : "muted")}`}>
              {reviewVm.reviewModeLabel}
            </div>
            <RegenerateReviewButton sessionId={`activity:${activity.id}`} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--surface-subtle)),hsl(var(--surface)))] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-tertiary">
                {reviewVm.sessionStatusLabel}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${toneToBadgeClass(reviewVm.intent.tone)}`}>
                {reviewVm.intent.label}
              </span>
              {reviewVm.isReviewable ? (
                <span className={narrativeSourcePillClass(reviewVm.narrativeSource)}>
                  {narrativeSourceLabel(reviewVm.narrativeSource)}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-base font-semibold text-[hsl(var(--text-primary))]" style={{ color: "hsl(var(--text-primary))" }}>{reviewVm.reviewModeDetail}</p>
            <p className="mt-2 text-sm text-muted">{reviewVm.sessionStatusDetail}</p>
          </div>

          <div className={`grid gap-3 ${reviewVm.isReviewable ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Discipline</p>
              <p className="mt-2 text-base font-semibold text-[hsl(var(--text-primary))]" style={{ color: "hsl(var(--text-primary))" }}>{disciplineLabel}</p>
              <p className="mt-1 text-sm text-muted">{sessionDateLabel}</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{outcomeLabel}</p>
              <p className={`mt-2 text-base font-semibold ${toneToTextClass(reviewVm.intent.tone)}`}>{reviewVm.intent.label}</p>
              <p className="mt-1 text-sm text-muted">{reviewVm.intent.detail}</p>
            </div>
            {reviewVm.isReviewable ? (
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Execution Score</p>
                <p className={`mt-2 text-base font-semibold ${toneToTextClass(reviewVm.scoreTone)}`}>{reviewVm.scoreHeadline}</p>
                <p className="mt-1 text-sm text-muted">{reviewVm.scoreInterpretation}</p>
              </div>
            ) : null}
          </div>
        </div>
      </article>

      <article className="surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{comparisonHeading}</h2>
          {reviewVm.scoreConfidenceNote ? <p className="text-xs text-tertiary">{reviewVm.scoreConfidenceNote}</p> : null}
        </div>

        {reviewVm.isReviewable ? (
          <>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{leftColumnLabel}</p>
                <p className="mt-2 text-sm">{reviewVm.plannedIntent}</p>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Actual execution</p>
                <p className="mt-2 text-sm">{reviewVm.actualExecutionSummary}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{reviewVm.mainGapLabel}</p>
                <p className="mt-2 text-sm">{reviewVm.mainGap}</p>
              </div>

              {reviewVm.usefulMetrics.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {reviewVm.usefulMetrics.map((metric) => (
                    <div key={metric.label} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                      <p className="text-xs text-muted">{metric.label}</p>
                      <p className="mt-1 text-base font-semibold text-[hsl(var(--text-primary))]" style={{ color: "hsl(var(--text-primary))" }}>{metric.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Available evidence</p>
                  <p className="mt-2 text-sm text-muted">{reviewVm.unlockDetail}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{leftColumnLabel}</p>
              <p className="mt-2 text-sm">{reviewVm.plannedIntent}</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{reviewVm.unlockTitle}</p>
              <p className="mt-2 text-sm">{reviewVm.unlockDetail}</p>
            </div>
          </div>
        )}
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Coaching takeaway</h2>
        {reviewVm.isReviewable ? (
          <dl className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Why it matters</dt>
              <dd className="mt-2 text-sm text-muted">{reviewVm.whyItMatters}</dd>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Do differently next time</dt>
              <dd className="mt-2 text-sm">{reviewVm.nextAction}</dd>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Suggested action for this week</dt>
              <dd className="mt-2 text-sm text-muted">{reviewVm.weekAction}</dd>
            </div>
          </dl>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Next step</p>
              <p className="mt-2 text-sm">{reviewVm.nextAction}</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">This week</p>
              <p className="mt-2 text-sm text-muted">{reviewVm.weekAction}</p>
            </div>
          </div>
        )}
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Ask coach follow-up</h2>
        <p className="mt-1 text-sm text-muted">{reviewVm.followUpIntro}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {reviewVm.followUpPrompts.map((prompt) => (
            <Link
              key={prompt}
              href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${prompt}`)}`}
              className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-muted transition hover:border-[hsl(var(--accent)/0.5)] hover:text-foreground"
            >
              {prompt}
            </Link>
          ))}
        </div>
      </article>
    </section>
  );
}
