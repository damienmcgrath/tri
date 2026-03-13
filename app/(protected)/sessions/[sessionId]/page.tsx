import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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

function isMissingColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /(schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

type SessionsMinimalRow = {
  id: string;
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

export default async function SessionReviewPage({ params }: { params: { sessionId: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  let session: SessionRow | null = null;

  const sessionQueries = [
    () =>
      supabase
        .from("sessions")
        .select("id,user_id,date,sport,type,session_name,discipline,subtype,workout_type,intent_category,target,duration_minutes,status,execution_result")
        .eq("id", params.sessionId)
        .eq("user_id", user.id)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,user_id,date,sport,type,session_name,discipline,subtype,workout_type,intent_category,target,duration_minutes,status,execution_result")
        .eq("id", params.sessionId)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,user_id,date,sport,type,target,duration_minutes,notes,status")
        .eq("id", params.sessionId)
        .eq("user_id", user.id)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,user_id,date,sport,type,target,duration_minutes,notes,status")
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

  if (!session) {
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

  let hasLinkedActivity = false;
  let linkedActivityId: string | null = null;
  const linkQueries = [
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
            user_id: session.user_id ?? user.id,
            sport: session.sport,
            type: session.type,
            duration_minutes: session.duration_minutes ?? null,
            target: session.target ?? null,
            intent_category: session.intent_category ?? null,
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
          <div className={`rounded-full border px-3 py-1 text-xs font-medium ${toneToBadgeClass(reviewVm.isReviewable ? reviewVm.intent.tone : "muted")}`}>
            {reviewVm.reviewModeLabel}
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
            </div>
            <p className="mt-3 text-base font-semibold text-[hsl(var(--text-primary))]">{reviewVm.reviewModeDetail}</p>
            <p className="mt-2 text-sm text-muted">{reviewVm.sessionStatusDetail}</p>
          </div>

          <div className={`grid gap-3 ${reviewVm.isReviewable ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Discipline</p>
              <p className="mt-2 text-base font-semibold">{disciplineLabel}</p>
              <p className="mt-1 text-sm text-muted">{sessionDateLabel}</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{reviewVm.isReviewable ? "Intent result" : "Session status"}</p>
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
          <h2 className="text-lg font-semibold">{reviewVm.isReviewable ? "Planned vs actual" : "Review unlock"}</h2>
          {reviewVm.scoreConfidenceNote ? <p className="text-xs text-tertiary">{reviewVm.scoreConfidenceNote}</p> : null}
        </div>

        {reviewVm.isReviewable ? (
          <>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Planned intent</p>
                <p className="mt-2 text-sm">{reviewVm.plannedIntent}</p>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Actual execution</p>
                <p className="mt-2 text-sm">{reviewVm.actualExecutionSummary}</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Main gap</p>
                <p className="mt-2 text-sm">{reviewVm.mainGap}</p>
              </div>

              {reviewVm.usefulMetrics.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {reviewVm.usefulMetrics.map((metric) => (
                    <div key={metric.label} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                      <p className="text-xs text-muted">{metric.label}</p>
                      <p className="mt-1 text-base font-semibold">{metric.value}</p>
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
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Planned intent</p>
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
