import Link from "next/link";
import { CoachIssueWorkspace } from "@/components/training/coach-issue-workspace";
import { StatusPill } from "@/components/training/status-pill";
import { CoachChat } from "./coach-chat";
import { WeeklyCheckinCard } from "./weekly-checkin-card";
import { createClient } from "@/lib/supabase/server";
import type { CoachBriefingContext, CoachDiagnosisSession } from "./types";
import { getAthleteContextSnapshot, getCurrentWeekStart } from "@/lib/athlete-context";
import { buildWeeklyExecutionBrief, parsePersistedExecutionReview } from "@/lib/execution-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { buildWeekStateSummary } from "@/lib/training/week-state";

type SessionRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  intent_category?: string | null;
  intent_summary?: string | null;
  target?: string | null;
  duration_minutes?: number | null;
  status?: "planned" | "completed" | "skipped" | null;
  is_key?: boolean | null;
  is_protected?: boolean | null;
  is_flexible?: boolean | null;
  session_role?: "key" | "supporting" | "recovery" | "optional" | "Key" | "Supporting" | "Recovery" | "Optional" | null;
  execution_result?: Record<string, unknown> | null;
};

function toMatchStatus(value: unknown): CoachDiagnosisSession["status"] {
  if (value === "matched_intent" || value === "matched") return "matched";
  if (value === "missed_intent" || value === "missed") return "missed";
  return "partial";
}

function mapDiagnosedSession(row: SessionRow): CoachDiagnosisSession | null {
  if (!row.execution_result || typeof row.execution_result !== "object") {
    return null;
  }

  const v2 = parsePersistedExecutionReview(row.execution_result);
  if (v2) {
    return {
      id: row.id,
      sessionName: getSessionDisplayName({
        sessionName: row.session_name ?? row.type,
        subtype: row.type,
        discipline: row.sport
      }),
      plannedIntent: v2.deterministic.planned.intentCategory ?? row.intent_category ?? row.type,
      executionSummary: v2.verdict?.explanation.whatHappened ?? v2.executionSummary,
      status: toMatchStatus(v2.status),
      executionScore: v2.executionScore,
      executionScoreBand: v2.executionScoreBand,
      executionScoreProvisional: v2.executionScoreProvisional,
      whyItMatters: v2.verdict?.explanation.whyItMatters ?? v2.whyItMatters,
      nextAction: v2.verdict?.explanation.whatToDoNextTime ?? v2.recommendedNextAction,
      confidenceNote: `Confidence: ${v2.diagnosisConfidence}${v2.executionCost ? ` · Cost: ${v2.executionCost}` : ""}`,
      evidence: v2.evidence,
      importance: v2.status === "missed_intent" ? 3 : v2.status === "partial_intent" ? 2 : 1
    };
  }

  const result = row.execution_result;
  const status = toMatchStatus(result.status);
  const sessionName = getSessionDisplayName({
    sessionName: row.session_name ?? row.type,
    subtype: row.type,
    discipline: row.sport
  });
  const plannedIntent = (row.intent_category ?? row.type ?? "Planned session intent").trim();
  const executionSummary =
    (typeof result.executionScoreSummary === "string" && result.executionScoreSummary) ||
    (typeof result.executionSummary === "string" && result.executionSummary) ||
    (typeof result.summary === "string" && result.summary) ||
    "Execution details will sharpen after a few more completed sessions.";
  const whyItMatters =
    (typeof result.whyItMatters === "string" && result.whyItMatters) ||
    (typeof result.why_it_matters === "string" && result.why_it_matters) ||
    (status === "missed"
      ? "Missing session intent repeatedly can reduce adaptation quality and increase fatigue carryover."
      : "Small execution drift can build across the week if ignored.");
  const nextAction =
    (typeof result.recommendedNextAction === "string" && result.recommendedNextAction) ||
    (typeof result.recommended_next_action === "string" && result.recommended_next_action) ||
    (status === "missed"
      ? "Repeat the session with a tighter cap on early intensity and preserve form first."
      : "Apply one execution correction on the next similar workout before progressing load.");

  const evidence = Array.isArray(result.evidence)
    ? result.evidence.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 3)
    : [];

  const executionScoreRaw = typeof result.executionScore === "number" ? result.executionScore : result.execution_score;
  const executionScore = typeof executionScoreRaw === "number" ? Math.max(0, Math.min(100, Math.round(executionScoreRaw))) : null;
  const executionScoreBandRaw = typeof result.executionScoreBand === "string" ? result.executionScoreBand : result.execution_score_band;
  const executionScoreBand =
    executionScoreBandRaw === "On target" || executionScoreBandRaw === "Partial match" || executionScoreBandRaw === "Missed intent"
      ? executionScoreBandRaw
      : executionScore === null
        ? null
        : executionScore >= 85
          ? "On target"
          : executionScore >= 65
            ? "Partial match"
            : "Missed intent";
  const executionScoreProvisionalRaw =
    typeof result.executionScoreProvisional === "boolean" ? result.executionScoreProvisional : result.execution_score_provisional;
  const executionScoreProvisional = typeof executionScoreProvisionalRaw === "boolean" ? executionScoreProvisionalRaw : false;

  const confidenceRaw = typeof result.diagnosisConfidence === "string" ? result.diagnosisConfidence : result.diagnosis_confidence;
  const confidenceNote = typeof confidenceRaw === "string" ? `Diagnosis confidence: ${confidenceRaw}` : undefined;

  const importance = status === "missed" ? 3 : status === "partial" ? 2 : 1;

  return {
    id: row.id,
    sessionName,
    plannedIntent,
    executionSummary,
    status,
    executionScore,
    executionScoreBand,
    executionScoreProvisional,
    whyItMatters,
    nextAction,
    confidenceNote,
    evidence,
    importance
  };
}

async function getDiagnosisSessions(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, weekStart: string, weekEnd: string) {
  if (!userId) {
    return [] as CoachDiagnosisSession[];
  }

  const { data, error } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,intent_category,status,execution_result")
    .eq("user_id", userId)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .not("execution_result", "is", null)
    .order("date", { ascending: false })
    .limit(12);

  if (error) {
    return [] as CoachDiagnosisSession[];
  }

  return ((data ?? []) as SessionRow[])
    .map(mapDiagnosedSession)
    .filter((item): item is CoachDiagnosisSession => Boolean(item))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 6);
}

async function getWeekSessions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  weekStart: string,
  weekEnd: string
) {
  if (!userId) {
    return [] as SessionRow[];
  }

  const { data, error } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,intent_category,intent_summary,target,duration_minutes,status,is_key,is_protected,is_flexible,session_role,execution_result")
    .eq("user_id", userId)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .order("date", { ascending: true });

  if (error) {
    return [] as SessionRow[];
  }

  return (data ?? []) as SessionRow[];
}

async function getBriefingContext(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, weekStart: string, weekEnd: string): Promise<CoachBriefingContext> {
  if (!userId) {
    return {
      uploadedSessionCount: 0,
      linkedSessionCount: 0,
      reviewedSessionCount: 0,
      pendingReviewCount: 0
    };
  }

  const [{ data: activities }, { data: weeklySessions }, { data: links }, { data: reviewedSessions }] = await Promise.all([
    supabase
      .from("completed_activities")
      .select("id")
      .eq("user_id", userId)
      .gte("start_time_utc", `${weekStart}T00:00:00.000Z`)
      .lte("start_time_utc", `${weekEnd}T23:59:59.999Z`),
    supabase
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .gte("date", weekStart)
      .lte("date", weekEnd),
    supabase
      .from("session_activity_links")
      .select("planned_session_id,confirmation_status")
      .eq("user_id", userId),
    supabase
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .not("execution_result", "is", null)
  ]);

  const weeklySessionIds = new Set(((weeklySessions ?? []) as Array<{ id: string }>).map((session) => session.id));
  const confirmedLinkedSessionIds = new Set(
    (links ?? [])
      .filter((link) => link.planned_session_id && weeklySessionIds.has(link.planned_session_id as string) && (link.confirmation_status === "confirmed" || link.confirmation_status === null))
      .map((link) => link.planned_session_id as string)
  );

  const reviewedSessionIds = new Set(((reviewedSessions ?? []) as Array<{ id: string }>).map((session) => session.id));
  const pendingReviewCount = [...confirmedLinkedSessionIds].filter((sessionId) => !reviewedSessionIds.has(sessionId)).length;

  return {
    uploadedSessionCount: (activities ?? []).length,
    linkedSessionCount: confirmedLinkedSessionIds.size,
    reviewedSessionCount: reviewedSessionIds.size,
    pendingReviewCount
  };
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isContextIncomplete(snapshot: Awaited<ReturnType<typeof getAthleteContextSnapshot>>) {
  return !snapshot.declared.experienceLevel.value ||
    !snapshot.goals.priorityEventName ||
    snapshot.declared.limiters.length === 0 ||
    snapshot.declared.strongestDisciplines.length === 0 ||
    snapshot.declared.weeklyConstraints.length === 0;
}

function getMissingContextLabels(snapshot: Awaited<ReturnType<typeof getAthleteContextSnapshot>>) {
  return [
    !snapshot.declared.experienceLevel.value ? "Experience level" : null,
    !snapshot.goals.goalType ? "Goal type" : null,
    snapshot.declared.limiters.length === 0 ? "Limiter" : null,
    snapshot.declared.strongestDisciplines.length === 0 ? "Strongest discipline" : null,
    snapshot.declared.weeklyConstraints.length === 0 ? "Weekly constraint" : null
  ].filter((item): item is string => Boolean(item));
}

export default async function CoachPage({ searchParams }: { searchParams?: { prompt?: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const weekStart = getCurrentWeekStart();
  const weekEnd = addDays(weekStart, 6);

  const [diagnosisSessions, briefingContext, athleteContext, weekSessions] = await Promise.all([
    user ? getDiagnosisSessions(supabase, user.id, weekStart, weekEnd) : [],
    user ? getBriefingContext(supabase, user.id, weekStart, weekEnd) : getBriefingContext(supabase, "", weekStart, weekEnd),
    user ? getAthleteContextSnapshot(supabase, user.id) : null,
    user ? getWeekSessions(supabase, user.id, weekStart, weekEnd) : []
  ]);

  const weeklyBrief = user && athleteContext
    ? await buildWeeklyExecutionBrief({
      supabase,
      athleteId: user.id,
      weekStart,
      weekEnd,
      athleteContext
    })
    : null;
  const contextIncomplete = athleteContext ? isContextIncomplete(athleteContext) : false;
  const missingContextLabels = athleteContext ? getMissingContextLabels(athleteContext) : [];
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekState = buildWeekStateSummary({
    sessions: weekSessions.map((session) => ({
      id: session.id,
      date: session.date,
      title: getSessionDisplayName({
        sessionName: session.session_name ?? session.type,
        subtype: session.type,
        discipline: session.sport
      }),
      sport: session.sport,
      durationMinutes: session.duration_minutes ?? 0,
      storedStatus: session.status ?? "planned",
      isKey: Boolean(session.is_key),
      isProtected: Boolean(session.is_protected || session.is_key),
      isFlexible: Boolean(session.is_flexible),
      isOptional: String(session.session_role ?? "").toLowerCase() === "optional",
      intentSummary: session.intent_summary ?? null,
      intentCategory: session.intent_category ?? null,
      target: session.target ?? null,
      executionResult: session.execution_result ?? null
    })),
    todayIso
  });
  const issueItems = weekState.issues.map((issue) => ({ ...issue }));
  const reviewedCount = weeklyBrief?.trend.reviewedCount ?? diagnosisSessions.length;
  const onTargetCount = weeklyBrief?.trend.onTargetCount ?? diagnosisSessions.filter((session) => session.status === "matched").length;
  const partialCount = weeklyBrief?.trend.partialCount ?? diagnosisSessions.filter((session) => session.status === "partial").length;
  const missedCount = weeklyBrief?.trend.missedCount ?? diagnosisSessions.filter((session) => session.status === "missed").length;
  const topRisk = weeklyBrief?.keyRisk ?? weekState.topIntervention.why;
  const topAction = weekState.topIntervention.recommendedAction;

  return (
    <section className="space-y-4">
      <article className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-accent">Weekly coaching briefing</p>
            <h1 className="mt-1 text-2xl font-semibold">{weeklyBrief?.weekHeadline ?? "Current coaching read"}</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted">{weeklyBrief?.weekSummary ?? weekState.focusStatement}</p>
          </div>
          <Link href="/settings/athlete-context" className="btn-secondary px-3 py-1.5 text-xs">
            Your coaching profile
          </Link>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Overall coaching read</p>
              <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{weeklyBrief?.nextWeekDecision ?? weekState.focusStatement}</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Top risk</p>
              <p className="mt-2 text-sm text-muted">{topRisk}</p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Top recommended action</p>
              <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{topAction}</p>
              {weeklyBrief?.confidenceNote ? <p className="mt-2 text-xs text-tertiary">{weeklyBrief.confidenceNote}</p> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Reviewed this week</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-2xl font-semibold">{reviewedCount}</p>
                <p className="text-xs text-muted">Reviewed</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-[hsl(var(--success))]">{onTargetCount}</p>
                <p className="text-xs text-muted">On target</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-[hsl(var(--warning))]">{partialCount}</p>
                <p className="text-xs text-muted">Partial</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-[hsl(var(--signal-risk))]">{missedCount}</p>
                <p className="text-xs text-muted">Missed intent</p>
              </div>
            </div>
            <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Current context</p>
              <p className="mt-2 text-sm text-muted">
                {athleteContext?.observed.recurringPatterns[0]?.detail ?? `Uploads ${briefingContext.uploadedSessionCount} · linked ${briefingContext.linkedSessionCount} · pending review ${briefingContext.pendingReviewCount}`}
              </p>
            </div>
          </div>
        </div>
      </article>

      <CoachIssueWorkspace
        issues={issueItems}
        defaultPromptPrefix={`Week of ${weekStart}: `}
      />

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        {athleteContext ? <WeeklyCheckinCard weekStart={weekStart} snapshot={athleteContext} /> : <div />}

        {athleteContext ? (
          <article className="surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-accent">Your coaching profile</p>
                <h2 className="mt-1 text-lg font-semibold">{contextIncomplete ? "A few context details are still missing" : "Context is ready for this week"}</h2>
                <p className="mt-1 text-sm text-muted">
                  {contextIncomplete
                    ? "Finish the missing fields so weekly decisions and session reviews can stay specific."
                    : "Coach can use this context across briefing, flagged issues, and follow-up."}
                </p>
              </div>
              <Link href="/settings/athlete-context" className={contextIncomplete ? "btn-primary px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}>
                {contextIncomplete ? "Complete profile" : "Edit profile"}
              </Link>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {contextIncomplete
                ? missingContextLabels.map((label) => (
                  <StatusPill key={label} label={label} tone="warning" compact />
                ))
                : (
                  <>
                    {athleteContext.goals.priorityEventName ? <StatusPill label={athleteContext.goals.priorityEventName} tone="neutral" compact /> : null}
                    {athleteContext.goals.goalType ? <StatusPill label={athleteContext.goals.goalType} tone="neutral" compact /> : null}
                    {athleteContext.declared.experienceLevel.value ? <StatusPill label={athleteContext.declared.experienceLevel.value} tone="neutral" compact /> : null}
                    {athleteContext.declared.limiters.slice(0, 2).map((limiter) => (
                      <StatusPill key={limiter.value} label={limiter.value} tone="neutral" compact />
                    ))}
                  </>
                )}
            </div>
          </article>
        ) : null}
      </section>

      <details className="surface-subtle p-4">
        <summary className="cursor-pointer text-sm font-medium">Conversation history</summary>
        <div className="mt-4">
          <CoachChat diagnosisSessions={diagnosisSessions} briefingContext={briefingContext} initialPrompt={searchParams?.prompt} showBriefingPanel={false} />
        </div>
      </details>
    </section>
  );
}
