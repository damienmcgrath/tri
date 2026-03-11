import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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

type LegacySessionRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration?: number | null;
  notes?: string | null;
};

type SessionStatus = "planned" | "completed" | "skipped";
type DiagnosisStatus = "matched_intent" | "partial_intent" | "missed_intent";

type ReviewViewModel = {
  reviewStatusLabel: string;
  reviewStatusDetail: string;
  isReviewable: boolean;
  intent: { label: string; tone: string; detail: string };
  executionSummary: string;
  score: number | null;
  scoreBand: string | null;
  scoreHeadline: string;
  scoreInterpretation: string;
  scoreConfidenceNote: string | null;
  plannedIntent: string;
  actualSummary: string;
  mainGap: string;
  usefulMetrics: Array<{ label: string; value: string }>;
  whyItMatters: string;
  nextAction: string;
  weekAction: string;
  knownSummary: string;
  provisionalSummary: string;
};

const STATUS_LABELS: Record<SessionStatus, string> = {
  planned: "Planned",
  completed: "Completed",
  skipped: "Skipped"
};

const SCORE_BAND_BY_VALUE = [
  { min: 85, label: "On target" },
  { min: 70, label: "Partial match" },
  { min: 0, label: "Missed intent" }
] as const;


function toIntentLabel(status: unknown) {
  if (status === "matched_intent" || status === "matched") {
    return {
      label: "Matched",
      tone: "text-[hsl(var(--success))]",
      detail: "Execution stayed aligned with the planned training stimulus."
    };
  }
  if (status === "missed_intent" || status === "missed") {
    return {
      label: "Missed",
      tone: "text-[hsl(var(--signal-risk))]",
      detail: "Execution drifted enough to reduce the intended adaptation."
    };
  }
  return {
    label: "Partial",
    tone: "text-[hsl(var(--warning))]",
    detail: "Some intent was met, but key parts of the target were not fully delivered."
  };
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

const reviewDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

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

function toStatusLabel(status: string | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  if (normalized in STATUS_LABELS) return STATUS_LABELS[normalized as SessionStatus];
  return "Completed";
}

function toReviewStatus(status: string | null | undefined, diagnosis: Record<string, unknown> | null | undefined) {
  const normalized = (status ?? "").toLowerCase();
  const hasDiagnosticSignals = Boolean(diagnosis) && Object.keys(diagnosis ?? {}).length > 0;
  if (normalized === "completed" || normalized === "skipped") {
    return {
      label: toStatusLabel(status),
      detail:
        normalized === "completed"
          ? "Session data is complete enough to review execution quality."
          : "Session was skipped, so this review focuses on decision quality and next-step planning.",
      isReviewable: true
    };
  }

  if (normalized === "planned") {
    return hasDiagnosticSignals
      ? {
          label: "Uploaded, awaiting completion sync",
          detail: "Workout files are present, but calendar status has not been finalized yet.",
          isReviewable: true
        }
      : {
          label: "Not reviewable yet",
          detail: "Complete or upload this workout before execution analysis can be trusted.",
          isReviewable: false
        };
  }

  return {
    label: hasDiagnosticSignals ? "Review in progress" : "Not reviewable yet",
    detail: hasDiagnosticSignals
      ? "Some execution data is available while final session sync is still in progress."
      : "No reliable execution evidence has been synced for review yet.",
    isReviewable: hasDiagnosticSignals
  };
}

function toScoreBand(score: number | null, explicitBand: string | null) {
  if (explicitBand) return explicitBand;
  if (score === null) return null;
  return SCORE_BAND_BY_VALUE.find((band) => score >= band.min)?.label ?? "Partial match";
}

function createReviewViewModel(session: SessionRow): ReviewViewModel {
  const diagnosis = session.execution_result;
  const intent = toIntentLabel(diagnosis?.status as DiagnosisStatus | undefined);
  const reviewStatus = toReviewStatus(session.status, diagnosis);

  const executionSummary = getString(
    diagnosis,
    ["executionScoreSummary", "executionSummary", "summary"],
    "Session completed, but objective evidence is still limited for a high-confidence execution diagnosis."
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
  const scoreBand = toScoreBand(score, getString(diagnosis, ["executionScoreBand", "execution_score_band"], "").trim() || null);
  const scoreSummary = getString(diagnosis, ["executionScoreSummary", "execution_score_summary"], "");
  const provisional = diagnosis?.executionScoreProvisional === true || diagnosis?.execution_score_provisional === true;

  const scoreInterpretation =
    score !== null
      ? scoreSummary || `Execution scored ${Math.round(score)} / 100 (${scoreBand ?? "provisional"}).`
      : "Execution score is unavailable because the uploaded data is not yet sufficient for credible scoring.";
  const scoreConfidenceNote =
    score !== null && provisional
      ? "Provisional score: confidence will improve as interval and intensity data quality improves."
      : score === null
        ? "Add richer activity data (interval completion, intensity metrics, and duration quality) to unlock a reliable score."
        : null;

  const scoreHeadline =
    score !== null
      ? `${Math.round(score)} · ${scoreBand ?? "Partial match"}`
      : reviewStatus.isReviewable
        ? "Provisional · Evidence still building"
        : "Pending · Complete workout to score";

  const durationCompletion = getNumber(diagnosis, ["durationCompletion", "duration_completion"]);
  const intervalCompletion = getNumber(diagnosis, ["intervalCompletionPct", "interval_completion_pct"]);
  const timeAbove = getNumber(diagnosis, ["timeAboveTargetPct", "time_above_target_pct"]);
  const avgHr = getNumber(diagnosis, ["avgHr", "avg_hr"]);
  const avgPower = getNumber(diagnosis, ["avgPower", "avg_power"]);

  const knownSignals = [
    score !== null ? "execution score" : null,
    durationCompletion !== null ? "duration completion" : null,
    intervalCompletion !== null ? "interval completion" : null,
    timeAbove !== null ? "time-above-target" : null,
    (avgHr || avgPower) ? "load metrics" : null
  ].filter((item): item is string => Boolean(item));

  const knownSummary = knownSignals.length > 0
    ? `Known so far: ${knownSignals.join(", ")}.`
    : "Known so far: session completion and intended workout context.";
  const provisionalSummary = provisional || score === null || knownSignals.length < 3
    ? "Still provisional: diagnosis confidence will improve with richer interval/intensity upload data from similar sessions."
    : "Diagnosis confidence is now less provisional; continue validating over the next similar session.";

  const usefulMetrics = [
    durationCompletion !== null ? { label: "Duration completion", value: pct(durationCompletion) } : null,
    intervalCompletion !== null ? { label: "Interval completion", value: pct(intervalCompletion) } : null,
    timeAbove !== null ? { label: "Time above target", value: pct(timeAbove) } : null,
    avgHr || avgPower
      ? {
          label: "Avg load",
          value: `${avgHr ? `${Math.round(avgHr)} bpm` : ""}${avgHr && avgPower ? " · " : ""}${avgPower ? `${Math.round(avgPower)} w` : ""}`
        }
      : null
  ].filter((metric): metric is { label: string; value: string } => metric !== null);

  const plannedIntent = session.intent_category?.trim() || `${getDisciplineMeta(session.sport).label} training intent`;
  const actualSummary =
    intent.label === "Matched"
      ? "Execution stayed close to the planned stimulus with only minor drift."
      : intent.label === "Partial"
        ? "Execution delivered some of the stimulus, but consistency across key targets was uneven."
        : "Execution diverged from the planned stimulus enough to blunt the intended adaptation.";
  const mainGap =
    intent.label === "Matched"
      ? "Execution stayed aligned with the intended stimulus. Keep the same structure on the next similar session."
      : intent.label === "Partial"
        ? "The session delivered useful work, but execution drift reduced the specificity of the intended adaptation."
        : "Execution was far enough from target that the planned adaptation was likely diluted.";

  return {
    reviewStatusLabel: reviewStatus.label,
    reviewStatusDetail: reviewStatus.detail,
    isReviewable: reviewStatus.isReviewable,
    intent,
    executionSummary,
    score,
    scoreBand,
    scoreHeadline,
    scoreInterpretation,
    scoreConfidenceNote,
    plannedIntent,
    actualSummary,
    mainGap,
    usefulMetrics,
    whyItMatters,
    nextAction,
    weekAction,
    knownSummary,
    provisionalSummary
  };
}

function isMissingColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /(schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

type SessionsMinimalRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes?: number | null;
  notes?: string | null;
  status?: "planned" | "completed" | "skipped" | null;
};

function toSessionRow(row: SessionRow | SessionsMinimalRow): SessionRow {
  return {
    id: row.id,
    date: row.date,
    sport: row.sport,
    type: row.type,
    session_name: "session_name" in row ? row.session_name ?? row.type : row.type,
    discipline: "discipline" in row ? row.discipline ?? row.sport : row.sport,
    subtype: "subtype" in row ? row.subtype ?? null : null,
    workout_type: "workout_type" in row ? row.workout_type ?? null : null,
    intent_category: "intent_category" in row ? row.intent_category ?? null : null,
    duration_minutes: row.duration_minutes ?? null,
    status: row.status ?? "completed",
    execution_result: "execution_result" in row ? row.execution_result ?? null : null
  };
}


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
        .select("id,date,sport,type,session_name,discipline,subtype,workout_type,intent_category,duration_minutes,status,execution_result")
        .eq("id", params.sessionId)
        .eq("user_id", user.id)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,date,sport,type,session_name,discipline,subtype,workout_type,intent_category,duration_minutes,status,execution_result")
        .eq("id", params.sessionId)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,date,sport,type,duration_minutes,notes,status")
        .eq("id", params.sessionId)
        .eq("user_id", user.id)
        .maybeSingle(),
    () =>
      supabase
        .from("sessions")
        .select("id,date,sport,type,duration_minutes,notes,status")
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
          date: legacy.date,
          sport: legacy.sport,
          type: legacy.type,
          session_name: legacy.type,
          discipline: legacy.sport,
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

  const reviewVm = createReviewViewModel(session);

  const sessionTitle = getSessionDisplayName({
    sessionName: session.session_name ?? session.type,
    discipline: session.discipline ?? session.sport,
    subtype: session.subtype,
    workoutType: session.workout_type,
    intentCategory: session.intent_category
  });

  return (
    <section className="space-y-4">
      <Link href="/calendar" className="text-sm text-cyan-300 underline-offset-2 hover:underline">← Back to Calendar</Link>

      <article className="surface p-5">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Session review</p>
        <h1 className="mt-1 text-2xl font-semibold">{sessionTitle}</h1>
        <p className="mt-1 text-sm text-muted">{reviewDateFormatter.format(new Date(`${session.date}T00:00:00.000Z`))} · {getDisciplineMeta(session.sport).label}</p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Discipline</p><p className="mt-1 font-semibold">{getDisciplineMeta(session.sport).label}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Duration</p><p className="mt-1 font-semibold">{durationLabel(session.duration_minutes)}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Review status</p><p className="mt-1 font-semibold">{reviewVm.reviewStatusLabel}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Intent result</p><p className={`mt-1 font-semibold ${reviewVm.intent.tone}`}>{reviewVm.intent.label}</p></div>
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3"><p className="text-xs text-muted">Execution Score</p><p className="mt-1 font-semibold">{reviewVm.scoreHeadline}</p></div>
        </div>
        <p className="mt-3 text-sm text-muted">{reviewVm.intent.detail}</p>
        <p className="mt-1 text-sm text-muted">{reviewVm.reviewStatusDetail}</p>
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Planned vs actual</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[hsl(var(--border))] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Planned intent</p>
            <p className="mt-2 text-sm">{reviewVm.plannedIntent}</p>
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] p-3">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Actual execution</p>
            <p className="mt-2 text-sm text-muted">{reviewVm.executionSummary}</p>
            <p className="mt-2 text-sm">{reviewVm.actualSummary}</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-[hsl(var(--border))] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Execution score detail</p>
          <p className="mt-2 text-sm">
            {reviewVm.score === null ? "Execution Score unavailable" : `${Math.round(reviewVm.score)} / 100 · ${reviewVm.scoreBand ?? "Provisional"}`}
          </p>
          <p className="mt-1 text-sm text-muted">{reviewVm.scoreInterpretation}</p>
          {reviewVm.scoreConfidenceNote ? <p className="mt-1 text-xs text-tertiary">{reviewVm.scoreConfidenceNote}</p> : null}
        </div>

        <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Diagnosis confidence</p>
          <p className="mt-2 text-sm text-muted">{reviewVm.knownSummary}</p>
          <p className="mt-1 text-sm text-muted">{reviewVm.provisionalSummary}</p>
        </div>

        {reviewVm.usefulMetrics.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {reviewVm.usefulMetrics.map((metric) => (
              <div key={metric.label} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
                <p className="text-xs text-muted">{metric.label}</p>
                <p className="mt-1 font-semibold">{metric.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Main gap</p>
          <p className="mt-2 text-sm text-muted">{reviewVm.mainGap}</p>
        </div>
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Coaching takeaway</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Why it matters</dt>
            <dd className="mt-1 text-muted">{reviewVm.whyItMatters}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Do differently next time</dt>
            <dd className="mt-1">{reviewVm.nextAction}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-[0.14em] text-tertiary">Suggested action for this week</dt>
            <dd className="mt-1 text-muted">{reviewVm.weekAction}</dd>
          </div>
        </dl>
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Ask coach follow-up</h2>
        <p className="mt-1 text-sm text-muted">Continue this in coaching chat to validate the diagnosis and decide whether this week needs an adjustment.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            "Why was this session flagged the way it was?",
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
