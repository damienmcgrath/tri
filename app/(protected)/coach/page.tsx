import { cache } from "react";
import Link from "next/link";
import { CoachChat } from "./coach-chat";
import { CoachContextPanel } from "./coach-context-panel";
import { CoachBriefingCard } from "./CoachBriefingCard";
import { WeeklyCheckinCard } from "./weekly-checkin-card";
import { TransitionBriefingCard } from "@/app/(protected)/dashboard/components/transition-briefing-card";
import { createClient } from "@/lib/supabase/server";
import type { CoachBriefingContext, CoachDiagnosisSession } from "./types";
import { getAthleteContextSnapshot, getCurrentWeekStart } from "@/lib/athlete-context";
import { buildWeeklyExecutionBrief, parsePersistedExecutionReview } from "@/lib/execution-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { getWeekTransitionBriefing } from "@/lib/training/week-transition";

type SessionRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  intent_category?: string | null;
  status?: "planned" | "completed" | "skipped" | null;
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

const getBriefingContext = cache(async function getBriefingContext(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, weekStart: string, weekEnd: string): Promise<CoachBriefingContext> {
  if (!userId) {
    return {
      uploadedSessionCount: 0,
      linkedSessionCount: 0,
      reviewedSessionCount: 0,
      pendingReviewCount: 0,
      extraActivityCount: 0
    };
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const [{ data: activities }, { data: weeklySessions }, { data: links }, { data: reviewedSessions }, { data: upcomingKeySessions }] = await Promise.all([
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
      .select("planned_session_id,completed_activity_id,confirmation_status")
      .eq("user_id", userId),
    supabase
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .not("execution_result", "is", null),
    supabase
      .from("sessions")
      .select("session_name,type,sport")
      .eq("user_id", userId)
      .eq("is_key", true)
      .eq("status", "planned")
      .gte("date", todayIso)
      .lte("date", weekEnd)
      .order("date", { ascending: true })
      .limit(3)
  ]);

  const weeklySessionIds = new Set(((weeklySessions ?? []) as Array<{ id: string }>).map((session) => session.id));
  const confirmedLinkedActivityIds = new Set(
    (links ?? [])
      .filter((link: any) => link.planned_session_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null))
      .map((link: any) => link.completed_activity_id as string)
      .filter(Boolean)
  );
  const confirmedLinkedSessionIds = new Set(
    (links ?? [])
      .filter((link: any) => link.planned_session_id && weeklySessionIds.has(link.planned_session_id as string) && (link.confirmation_status === "confirmed" || link.confirmation_status === null))
      .map((link: any) => link.planned_session_id as string)
  );

  const reviewedSessionIds = new Set(((reviewedSessions ?? []) as Array<{ id: string }>).map((session) => session.id));
  const pendingReviewCount = [...confirmedLinkedSessionIds].filter((sessionId) => !reviewedSessionIds.has(sessionId as string)).length;

  const allActivityIds = ((activities ?? []) as Array<{ id: string }>).map((a) => a.id);
  const extraActivityCount = allActivityIds.filter((id) => !confirmedLinkedActivityIds.has(id)).length;

  const upcomingKeyNames = ((upcomingKeySessions ?? []) as Array<{ session_name: string | null; type: string; sport: string }>)
    .map((s) => s.session_name || `${s.type} ${s.sport}`)
    .filter((name): name is string => Boolean(name));

  return {
    uploadedSessionCount: (activities ?? []).length,
    linkedSessionCount: confirmedLinkedSessionIds.size,
    reviewedSessionCount: reviewedSessionIds.size,
    pendingReviewCount,
    extraActivityCount,
    upcomingKeySessionNames: upcomingKeyNames.length > 0 ? upcomingKeyNames : undefined
  };
});

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

  const [diagnosisSessions, briefingContext, athleteContext, transitionBriefing] = await Promise.all([
    user ? getDiagnosisSessions(supabase, user.id, weekStart, weekEnd) : [],
    user ? getBriefingContext(supabase, user.id, weekStart, weekEnd) : getBriefingContext(supabase, "", weekStart, weekEnd),
    user ? getAthleteContextSnapshot(supabase, user.id) : null,
    user ? getWeekTransitionBriefing(supabase, user.id, weekStart).catch(() => null) : null
  ]);

  const weeklyBrief = user && athleteContext
    ? await buildWeeklyExecutionBrief({
      supabase,
      athleteId: user.id,
      weekStart,
      weekEnd,
      athleteContext,
      extraActivityCount: briefingContext.extraActivityCount
    })
    : null;
  const contextIncomplete = athleteContext ? isContextIncomplete(athleteContext) : false;
  const missingContextLabels = athleteContext ? getMissingContextLabels(athleteContext) : [];

  // Build summary chips for the collapsed context bar
  const contextSummaryItems: Array<{ label: string; accent?: boolean }> = [];
  if (transitionBriefing && !transitionBriefing.dismissedAt) {
    contextSummaryItems.push({ label: "Week transition", accent: true });
  }
  if (weeklyBrief) {
    const reviewCount = briefingContext.reviewedSessionCount;
    contextSummaryItems.push({ label: reviewCount > 0 ? `${reviewCount} reviewed` : "Briefing" });
  }
  if (athleteContext) {
    contextSummaryItems.push({ label: "Check-in" });
  }
  if (athleteContext) {
    contextSummaryItems.push({ label: contextIncomplete ? "Profile incomplete" : "Profile ready" });
  }

  return (
    <section className="space-y-3">
      {/* ── Collapsible context panel ──────────────────────────────────── */}
      <CoachContextPanel summaryItems={contextSummaryItems}>
        {transitionBriefing && !transitionBriefing.dismissedAt ? (
          <TransitionBriefingCard briefing={transitionBriefing} />
        ) : null}

        {weeklyBrief ? (
          <CoachBriefingCard
            brief={weeklyBrief}
            athleteContext={athleteContext}
            briefingContext={briefingContext}
          />
        ) : null}

        {athleteContext ? <WeeklyCheckinCard weekStart={weekStart} snapshot={athleteContext} /> : null}

        {athleteContext ? (
          <article className="surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label">Coaching profile</p>
                <h2 className="mt-1 text-lg font-semibold">{contextIncomplete ? "Profile needs a few details" : "Profile is ready"}</h2>
                <p className="mt-1 text-sm text-muted">
                  {contextIncomplete
                    ? "Finish a few fields so Coach can personalize advice."
                    : "Coach has your baseline context for briefing, reviews, and chat."}
                </p>
              </div>
              <Link href="/settings/athlete-context" className={contextIncomplete ? "btn-primary px-3 py-1.5 text-xs" : "border border-[rgba(255,255,255,0.20)] bg-transparent px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] rounded-md"}>
                {contextIncomplete ? "Complete profile" : "Edit profile"}
              </Link>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {contextIncomplete
                ? missingContextLabels.map((label) => (
                  <span key={label} className="rounded-md border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.6)]">{label}</span>
                ))
                : (
                  <>
                    {athleteContext.goals.priorityEventName ? <span className="rounded-md border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.6)]">{athleteContext.goals.priorityEventName}</span> : null}
                    {athleteContext.goals.goalType ? <span className="rounded-md border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.6)]">{athleteContext.goals.goalType}</span> : null}
                    {athleteContext.declared.experienceLevel.value ? <span className="rounded-md border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.6)]">{athleteContext.declared.experienceLevel.value}</span> : null}
                    {athleteContext.declared.limiters.slice(0, 2).map((limiter) => (
                      <span key={limiter.value} className="rounded-md border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.6)]">{limiter.value}</span>
                    ))}
                  </>
                )}
            </div>
          </article>
        ) : null}
      </CoachContextPanel>

      {/* ── Chat (primary content — full width) ────────────────────────── */}
      <CoachChat diagnosisSessions={diagnosisSessions} briefingContext={briefingContext} initialPrompt={searchParams?.prompt} showBriefingPanel={false} />
    </section>
  );
}
