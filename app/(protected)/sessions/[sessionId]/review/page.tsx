import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";

const ASK_COACH_PROMPTS = [
  "Why was this session flagged?",
  "Should I repeat this workout?",
  "How should I adjust the rest of the week?"
];

type SessionRow = {
  id: string;
  plan_id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  intent_category?: string | null;
  duration_minutes?: number | null;
  status?: "planned" | "completed" | "skipped" | null;
  execution_result?: Record<string, unknown> | null;
};

type ActivityRow = {
  id: string;
  duration_sec?: number | null;
  avg_hr?: number | null;
  avg_power?: number | null;
  distance_m?: number | null;
};

function toIntentChip(status: unknown) {
  if (status === "matched_intent" || status === "matched") return { label: "Matched", className: "signal-ready" };
  if (status === "missed_intent" || status === "missed") return { label: "Missed", className: "signal-risk" };
  return { label: "Partial", className: "signal-load" };
}

function toMinutesLabel(minutes?: number | null) {
  if (!minutes || minutes <= 0) return "—";
  return `${Math.round(minutes)} min`;
}

function formatMetric(label: string, value: string | null) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium">{value ?? "—"}</p>
    </div>
  );
}

function getActivitySummary(activity: ActivityRow | null) {
  if (!activity) {
    return {
      durationMinutes: null,
      avgHr: null,
      avgPower: null,
      paceOrSpeed: null
    };
  }

  const durationMinutes = activity.duration_sec ? Math.round(activity.duration_sec / 60) : null;
  const avgHr = activity.avg_hr ? `${Math.round(activity.avg_hr)} bpm` : null;
  const avgPower = activity.avg_power ? `${Math.round(activity.avg_power)} w` : null;

  let paceOrSpeed: string | null = null;
  if (activity.distance_m && activity.duration_sec && activity.duration_sec > 0) {
    const speedKmh = (activity.distance_m / activity.duration_sec) * 3.6;
    paceOrSpeed = `${speedKmh.toFixed(1)} km/h`;
  }

  return {
    durationMinutes,
    avgHr,
    avgPower,
    paceOrSpeed
  };
}

async function getReviewPayload(sessionId: string) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id,plan_id,date,sport,type,session_name,intent_category,duration_minutes,status,execution_result")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) return null;

  const { data: plan } = await supabase.from("training_plans").select("id").eq("id", session.plan_id).eq("user_id", user.id).maybeSingle();
  if (!plan) return null;

  const { data: links } = await supabase
    .from("session_activity_links")
    .select("completed_activity_id,confirmation_status")
    .eq("planned_session_id", session.id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const activityId = (links ?? []).find((item) => item.confirmation_status !== "rejected")?.completed_activity_id;

  let activity: ActivityRow | null = null;
  if (activityId) {
    const { data: activityData } = await supabase
      .from("completed_activities")
      .select("id,duration_sec,avg_hr,avg_power,distance_m")
      .eq("id", activityId)
      .eq("user_id", user.id)
      .maybeSingle();
    activity = (activityData as ActivityRow | null) ?? null;
  }

  return {
    session: session as SessionRow,
    activity
  };
}

export default async function SessionReviewPage({ params }: { params: { sessionId: string } }) {
  const payload = await getReviewPayload(params.sessionId);
  if (!payload) notFound();

  const { session, activity } = payload;
  const execution = session.execution_result ?? {};
  const intentChip = toIntentChip(execution.status);
  const activitySummary = getActivitySummary(activity);
  const plannedIntent = (session.intent_category ?? "").trim() || `${getDisciplineMeta(session.sport).label} session`;
  const executionSummary =
    (typeof execution.executionSummary === "string" && execution.executionSummary) ||
    (typeof execution.summary === "string" && execution.summary) ||
    "No execution summary yet. This review will become more specific as more workout data is linked.";

  const whyItMatters =
    (typeof execution.whyItMatters === "string" && execution.whyItMatters) ||
    (typeof execution.why_it_matters === "string" && execution.why_it_matters) ||
    "Execution consistency drives how much this session contributes to your long-term adaptation.";

  const nextAction =
    (typeof execution.recommendedNextAction === "string" && execution.recommendedNextAction) ||
    (typeof execution.recommended_next_action === "string" && execution.recommended_next_action) ||
    "Keep your next similar session controlled early, then build only if form and breathing stay stable.";

  const weekAdjustment =
    (typeof execution.weekAdjustment === "string" && execution.weekAdjustment) ||
    (typeof execution.week_adjustment === "string" && execution.week_adjustment) ||
    (intentChip.label === "Missed"
      ? "Consider lowering intensity in the next key workout and protecting recovery between sessions."
      : "No major weekly change needed; apply one technical correction in the next similar workout.");

  const compactGap =
    (typeof execution.mainGap === "string" && execution.mainGap) ||
    (typeof execution.main_gap === "string" && execution.main_gap) ||
    (intentChip.label === "Matched"
      ? "Execution was aligned with planned intent."
      : "Actual effort or completion drifted from the planned intent.");

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/calendar" className="text-sm text-accent hover:underline">← Back to Calendar</Link>
        <Link href="/coach" className="btn-secondary px-3 py-1.5 text-xs">Open Coach</Link>
      </div>

      <article className="surface p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Session review</p>
        <h1 className="mt-1 text-xl font-semibold">{session.session_name ?? session.type}</h1>
        <p className="mt-2 text-sm text-muted">{new Date(`${session.date}T00:00:00.000Z`).toLocaleDateString()} · {getDisciplineMeta(session.sport).label}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">Duration: {toMinutesLabel(session.duration_minutes)}</span>
          <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">Status: {session.status ?? "planned"}</span>
          <span className={`signal-chip ${intentChip.className}`}>Intent match: {intentChip.label}</span>
        </div>
      </article>

      <article className="surface p-5">
        <h2 className="text-base font-semibold">Planned vs actual</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Planned intent</p>
            <p className="mt-1 text-sm">{plannedIntent}</p>
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Actual execution</p>
            <p className="mt-1 text-sm">{executionSummary}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {formatMetric("Actual duration", activitySummary.durationMinutes ? `${activitySummary.durationMinutes} min` : null)}
          {formatMetric("Avg HR", activitySummary.avgHr)}
          {formatMetric("Avg power", activitySummary.avgPower)}
          {formatMetric("Speed", activitySummary.paceOrSpeed)}
        </div>
        <div className="mt-3 rounded-xl border border-[hsl(var(--signal-load)/0.35)] bg-[hsl(var(--signal-load)/0.08)] p-3 text-sm">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Main gap</p>
          <p className="mt-1">{compactGap}</p>
        </div>
      </article>

      <article className="surface p-5">
        <h2 className="text-base font-semibold">Coaching takeaway</h2>
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Why it matters</p>
            <p className="mt-1">{whyItMatters}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Do differently next time</p>
            <p className="mt-1">{nextAction}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Suggested weekly adjustment</p>
            <p className="mt-1">{weekAdjustment}</p>
          </div>
        </div>
      </article>

      <article className="surface p-5">
        <h2 className="text-base font-semibold">Ask coach follow-up</h2>
        <p className="mt-1 text-sm text-muted">Continue in coach chat with one tap.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ASK_COACH_PROMPTS.map((prompt) => (
            <Link key={prompt} href={`/coach?prompt=${encodeURIComponent(prompt)}&sessionId=${session.id}`} className="btn-secondary px-3 py-1.5 text-xs">
              {prompt}
            </Link>
          ))}
        </div>
      </article>
    </section>
  );
}
