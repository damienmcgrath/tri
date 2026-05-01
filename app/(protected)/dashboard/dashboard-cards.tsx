/**
 * Suspense-streamed dashboard cards. Extracted from page.tsx to keep the
 * page file focused on composition. Each card is a server-side async
 * component that fetches its own slice of data and renders independently
 * inside its own <Suspense>.
 */

import type { createClient } from "@/lib/supabase/server";
import { addDays } from "../week-context";
import { getWeeklyDebriefSnapshot } from "@/lib/weekly-debrief";
import { WeeklyDebriefCard } from "./weekly-debrief-card";
import { WeekAheadCard } from "./components/week-ahead-card";
import { TransitionBriefingCard } from "./components/transition-briefing-card";
import { TrendCards } from "./trend-cards";
import { MorningBriefCard } from "./components/morning-brief-card";
import { TrainingScoreCard } from "./components/training-score-card";
import { ReadinessIndicator } from "./components/readiness-indicator";
import { RecentUploadCard } from "./components/recent-upload-card";
import { DisciplineBalanceCompact } from "./components/discipline-balance-compact";
import { getLatestFitness, getReadinessState, getTsbTrend } from "@/lib/training/fitness-model";
import { computeWeeklyDisciplineBalance, detectDisciplineImbalance } from "@/lib/training/discipline-balance";
import { detectTrends } from "@/lib/training/trends";
import { detectCrossDisciplineFatigue, type FatigueSignal } from "@/lib/training/fatigue-detection";
import { generateWeekTransitionBriefing } from "@/lib/training/week-transition";
import { getOrGenerateMorningBrief, type MorningBrief } from "@/lib/training/morning-brief";
import { MondayTransitionFlow } from "./components/monday-transition-flow";
import { getOrComputeTrainingScore } from "@/lib/training/scoring";
import type { RaceWeekContext } from "@/lib/training/race-week";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// ── Race-day carry-forward cue (Phase 1D) ────────────────────────────────

/**
 * Renders the carry-forward instruction from the prior race directly on
 * the race-day / day-before hero. Bypasses the morning-brief card's
 * collapse-to-summary behaviour so the most important coaching cue on
 * race morning is visible without a tap.
 *
 * No-op when raceCtx.carryForward is null.
 */
export function CarryForwardCue({
  carryForward
}: {
  carryForward: RaceWeekContext["carryForward"];
}) {
  if (!carryForward) return null;
  const fromLabel = carryForward.fromRaceName
    ? `Today's cue from ${carryForward.fromRaceName}`
    : `Today's cue from ${carryForward.fromRaceDate}`;
  return (
    <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-300/80">
        {fromLabel}
      </p>
      <p className="mt-1 text-sm font-medium text-[rgba(255,255,255,0.94)]">
        {carryForward.headline}
      </p>
      <p className="mt-1 text-sm text-[rgba(255,255,255,0.82)]">
        {carryForward.instruction}
      </p>
      <p className="mt-2 text-xs text-tertiary">
        Success criterion: {carryForward.successCriterion}
      </p>
    </div>
  );
}

// ── Suspense-streamed async components ───────────────────────────────────

export async function DashboardDebrief(props: {
  supabase: SupabaseServer;
  userId: string;
  weekStart: string;
  timeZone: string;
  todayIso: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart, timeZone, todayIso } = props;
  const snapshot = await getWeeklyDebriefSnapshot({ supabase, athleteId: userId, weekStart, timeZone, todayIso });
  if (!snapshot) return null;
  return <WeeklyDebriefCard snapshot={snapshot} />;
}

export async function DashboardTrends(props: {
  supabase: SupabaseServer;
  userId: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId } = props;
  let trends: Awaited<ReturnType<typeof detectTrends>> = [];
  let fatigueSignal: FatigueSignal | null = null;
  try {
    [trends, fatigueSignal] = await Promise.all([
      detectTrends(supabase, userId),
      detectCrossDisciplineFatigue(supabase, userId).catch(() => null)
    ]);
  } catch {
    return null;
  }
  if (trends.length === 0 && !fatigueSignal) return null;
  return <TrendCards trends={trends} fatigueSignal={fatigueSignal} />;
}

export async function DashboardMondayTransition(props: {
  supabase: SupabaseServer;
  userId: string;
  weekStart: string;
  todayIso: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart, todayIso } = props;
  try {
    const briefing = await generateWeekTransitionBriefing(supabase, userId, weekStart);
    if (!briefing || briefing.dismissedAt) return null;

    // Fetch morning brief for "today" section
    let morningBrief: MorningBrief | null = null;
    try {
      morningBrief = await getOrGenerateMorningBrief(supabase, userId, todayIso);
    } catch {
      // Non-critical
    }

    // Fetch debrief summary for "last week" enrichment
    let debriefSummary: string | null = null;
    const prevWeekStart = addDays(weekStart, -7);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      const snapshot = await getWeeklyDebriefSnapshot({ supabase, athleteId: userId, weekStart: prevWeekStart, timeZone, todayIso });
      if (snapshot?.artifact?.narrative?.executiveSummary) {
        debriefSummary = snapshot.artifact.narrative.executiveSummary;
      }
    } catch {
      // Non-critical
    }

    // Count pending rationales
    const { count } = await supabase
      .from("adaptation_rationales")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending");

    return (
      <MondayTransitionFlow
        briefing={briefing}
        morningBrief={morningBrief}
        debriefSummary={debriefSummary}
        pendingRationaleCount={count ?? 0}
        weekStart={prevWeekStart}
      />
    );
  } catch {
    return null;
  }
}

export async function DashboardWeekAhead(props: {
  supabase: SupabaseServer;
  userId: string;
  weekStart: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart } = props;
  try {
    const { getMacroContext } = await import("@/lib/training/macro-context");
    const { generateWeekPreview } = await import("@/lib/training/week-preview");
    const nextWeekStart = addDays(weekStart, 7);
    const macroCtx = await getMacroContext(supabase, userId);
    const preview = await generateWeekPreview(supabase, userId, nextWeekStart, macroCtx);
    if (!preview) return null;
    return <WeekAheadCard preview={preview} />;
  } catch {
    return null;
  }
}

export async function DashboardTransitionBriefing(props: {
  supabase: SupabaseServer;
  userId: string;
  weekStart: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart } = props;
  try {
    const briefing = await generateWeekTransitionBriefing(supabase, userId, weekStart);
    if (briefing.dismissedAt) return null;
    return <TransitionBriefingCard briefing={briefing} />;
  } catch {
    return null;
  }
}

export async function DashboardRecentUpload(props: {
  supabase: SupabaseServer;
  userId: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId } = props;
  try {
    // Find recently-synced activities (last 4 hours) whose workout actually happened recently (last 36 hours)
    // so backfilled uploads of old sessions don't trigger the "how did it feel?" prompt.
    const now = Date.now();
    const { data: recentActivity } = await supabase
      .from("completed_activities")
      .select("id,sport_type,duration_sec")
      .eq("user_id", userId)
      .gte("created_at", new Date(now - 4 * 3600 * 1000).toISOString())
      .gte("start_time_utc", new Date(now - 36 * 3600 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!recentActivity) return null;

    // Check if there's a linked session
    const { data: link } = await supabase
      .from("session_activity_links")
      .select("planned_session_id")
      .eq("completed_activity_id", recentActivity.id)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!link?.planned_session_id) return null;

    // Check if feel already captured
    const { data: existingFeel } = await supabase
      .from("session_feels")
      .select("id")
      .eq("session_id", link.planned_session_id)
      .limit(1)
      .maybeSingle();

    if (existingFeel) return null;

    // Get session details
    const { data: session } = await supabase
      .from("sessions")
      .select("id,session_name,type,sport")
      .eq("id", link.planned_session_id)
      .maybeSingle();

    if (!session) return null;

    const durationMinutes = recentActivity.duration_sec ? Math.round(recentActivity.duration_sec / 60) : 0;
    return (
      <RecentUploadCard
        sessionId={session.id}
        sessionName={session.session_name ?? session.type}
        sport={session.sport}
        durationMinutes={durationMinutes}
      />
    );
  } catch {
    return null;
  }
}

export async function DashboardMorningBrief(props: {
  supabase: SupabaseServer;
  userId: string;
  todayIso: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, todayIso } = props;
  try {
    const brief = await getOrGenerateMorningBrief(supabase, userId, todayIso);
    return <MorningBriefCard brief={brief} />;
  } catch {
    return null;
  }
}

export async function DashboardTrainingScore(props: {
  supabase: SupabaseServer;
  userId: string;
  todayIso: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, todayIso } = props;
  try {
    const score = await getOrComputeTrainingScore(supabase, userId, todayIso);
    return <TrainingScoreCard score={score} />;
  } catch {
    return null;
  }
}

export async function DashboardReadiness(props: {
  supabase: SupabaseServer;
  userId: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId } = props;
  try {
    const [fitness, tsbTrend, fatigue] = await Promise.all([
      getLatestFitness(supabase, userId),
      getTsbTrend(supabase, userId),
      detectCrossDisciplineFatigue(supabase, userId).catch(() => null)
    ]);
    if (!fitness?.total) return null;
    const readiness = getReadinessState(fitness.total.tsb, tsbTrend);
    const signalContext = fatigue?.sports && fatigue.sports.length >= 2
      ? `${fatigue.sports.join(" + ")} trending down, expect heavier legs`
      : readiness === "fatigued" || readiness === "overreaching"
        ? "Hold the key session but keep easy days truly easy"
        : null;
    return (
      <ReadinessIndicator
        readiness={readiness}
        tsb={fitness.total.tsb}
        tsbTrend={tsbTrend}
        signalContext={signalContext}
      />
    );
  } catch {
    return null;
  }
}

export async function DashboardDisciplineBalance(props: {
  supabase: SupabaseServer;
  userId: string;
  weekStart: string;
}) {
  if (!props?.supabase) return null;
  const { supabase, userId, weekStart } = props;
  try {
    const balance = await computeWeeklyDisciplineBalance(supabase, userId, weekStart);
    detectDisciplineImbalance(balance);
    // Only show if there's actual data
    if (balance.totalActualTss === 0 && balance.totalPlannedTss === 0) return null;
    return <DisciplineBalanceCompact balance={balance} />;
  } catch {
    return null;
  }
}
