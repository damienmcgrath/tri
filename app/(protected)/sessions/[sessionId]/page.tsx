import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionDisplayName } from "@/lib/training/session";
import { getDisciplineMeta } from "@/lib/ui/discipline";

type SessionRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  discipline?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  intent_category?: string | null;
  duration_minutes?: number | null;
  status?: "planned" | "completed" | "skipped" | null;
  execution_result?: Record<string, unknown> | null;
};

function toIntentLabel(status: unknown) {
  if (status === "matched_intent" || status === "matched") return { label: "Matched", tone: "text-[hsl(var(--success))]" };
  if (status === "missed_intent" || status === "missed") return { label: "Missed", tone: "text-[hsl(var(--signal-risk))]" };
  return { label: "Partial", tone: "text-[hsl(var(--warning))]" };
}

function getString(result: Record<string, unknown> | null | undefined, keys: string[], fallback: string) {
  if (!result) return fallback;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return fallback;
}

function getNumber(result: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!result) return null;
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function pct(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function durationLabel(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "—";
  const wholeMinutes = Math.round(minutes);
  const h = Math.floor(wholeMinutes / 60);
  const m = wholeMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function SessionReviewPage({ params }: { params: { sessionId: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) notFound();

  const { data, error } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,discipline,subtype,workout_type,intent_category,duration_minutes,status,execution_result")
    .eq("id", params.sessionId)
    .maybeSingle();

  if (error || !data) notFound();

  const session = data as SessionRow;
  const diagnosis = session.execution_result;
  const intent = toIntentLabel(diagnosis?.status);

  const sessionTitle = getSessionDisplayName({
    sessionName: session.session_name ?? session.type,
    discipline: session.discipline ?? session.sport,
    subtype: session.subtype,
    workoutType: session.workout_type,
    intentCategory: session.intent_category
  });

  const executionSummary = getString(
    diagnosis,
    ["executionScoreSummary", "executionSummary", "summary"],
    "Execution summary will appear as workout data quality improves."
  );
  const whyItMatters = getString(
    diagnosis,
    ["whyItMatters", "why_it_matters"],
    "Execution consistency protects adaptation quality and fatigue management across the week."
  );
  const nextAction = getString(
    diagnosis,
    ["recommendedNextAction", "recommended_next_action"],
    "Repeat this workout intent next time with one focused execution cue."
  );
  const weekAction = getString(
    diagnosis,
    ["suggestedWeekAdjustment", "suggested_week_adjustment", "weeklyAdjustment", "weekly_adjustment", "recommendedNextAction", "recommended_next_action"],
    "Keep the next key session as planned and protect recovery intensity between now and then."
  );

  const score = getNumber(diagnosis, ["executionScore", "execution_score"]);
  const durationCompletion = getNumber(diagnosis, ["durationCompletion", "duration_completion"]);
  const intervalCompletion = getNumber(diagnosis, ["intervalCompletionPct", "interval_completion_pct"]);
  const timeAbove = getNumber(diagnosis, ["timeAboveTargetPct", "time_above_target_pct"]);
  const avgHr = getNumber(diagnosis, ["avgHr", "avg_hr"]);
  const avgPower = getNumber(diagnosis, ["avgPower", "avg_power"]);

  const plannedIntent = session.intent_category?.trim() || `${getDisciplineMeta(session.sport).label} training intent`;

  const mainGap =
    intent.label === "Matched"
      ? "Execution stayed aligned with the intended stimulus. Keep the same structure on the next similar session."
      : intent.label === "Partial"
        ? "You completed useful work but drifted away from the original objective enough to reduce training specificity."
        : "The workout outcome was meaningfully different from the target intent, so adaptation impact was reduced.";

  return (
    <section className="space-y-4">
      <Link href="/calendar" className="text-sm text-cyan-300 underline-offset-2 hover:underline">← Back to Calendar</Link>

      <article className="surface p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Session review</p>
        <h1 className="mt-1 text-2xl font-semibold">{sessionTitle}</h1>
        <p className="mt-1 text-sm text-muted">{new Date(`${session.date}T00:00:00.000Z`).toLocaleDateString()} · {getDisciplineMeta(session.sport).label}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Discipline</p><p className="mt-1 font-semibold">{getDisciplineMeta(session.sport).label}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Duration</p><p className="mt-1 font-semibold">{durationLabel(session.duration_minutes)}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Status</p><p className="mt-1 font-semibold capitalize">{session.status ?? "completed"}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Intent match</p><p className={`mt-1 font-semibold ${intent.tone}`}>{intent.label}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Execution score</p><p className="mt-1 font-semibold">{score === null ? "—" : `${Math.round(score)} / 100`}</p></div>
        </div>
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Planned vs actual</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[hsl(var(--border))] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Planned intent</p>
            <p className="mt-2 text-sm">{plannedIntent}</p>
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Actual execution</p>
            <p className="mt-2 text-sm text-muted">{executionSummary}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Duration completion</p><p className="mt-1 font-semibold">{pct(durationCompletion)}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Interval completion</p><p className="mt-1 font-semibold">{pct(intervalCompletion)}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Time above target</p><p className="mt-1 font-semibold">{pct(timeAbove)}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Avg HR / Power</p><p className="mt-1 font-semibold">{avgHr ? `${Math.round(avgHr)} bpm` : "—"}{avgPower ? ` · ${Math.round(avgPower)} w` : ""}</p></div>
        </div>

        <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Main gap</p>
          <p className="mt-2 text-sm text-muted">{mainGap}</p>
        </div>
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Coaching takeaway</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Why it matters</dt>
            <dd className="mt-1 text-muted">{whyItMatters}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Do differently next time</dt>
            <dd className="mt-1">{nextAction}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Suggested action for this week</dt>
            <dd className="mt-1 text-muted">{weekAction}</dd>
          </div>
        </dl>
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Ask coach follow-up</h2>
        <p className="mt-1 text-sm text-muted">Continue this in coaching chat to decide whether this week should adapt.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            "Why was this session flagged?",
            "Should I repeat this workout?",
            "How should I adjust the rest of the week?"
          ].map((prompt) => (
            <Link
              key={prompt}
              href={`/coach?prompt=${encodeURIComponent(`${sessionTitle}: ${prompt}`)}`}
              className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              {prompt}
            </Link>
          ))}
        </div>
      </article>
    </section>
  );
}
