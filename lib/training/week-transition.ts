import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateWeekTransitionBriefingAI,
  WEEK_TRANSITION_PROMPT_VERSION,
  type WeekTransitionContext
} from "@/lib/ai/prompts/week-transition-briefing";
import { getSessionDisplayName } from "@/lib/training/session";
import { getCoachModel } from "@/lib/openai";

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type WeekTransitionBriefing = {
  id: string;
  currentWeekStart: string;
  lastWeekTakeaway: string;
  thisWeekFocus: string;
  adaptationContext: string | null;
  pendingRationaleIds: string[];
  coachingPrompt: string | null;
  viewedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
};

/**
 * Fetch an existing week transition briefing, or return null.
 */
export async function getWeekTransitionBriefing(
  supabase: SupabaseClient,
  athleteId: string,
  weekStart: string
): Promise<WeekTransitionBriefing | null> {
  const { data } = await supabase
    .from("week_transition_briefings")
    .select("*")
    .eq("user_id", athleteId)
    .eq("current_week_start", weekStart)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    currentWeekStart: data.current_week_start,
    lastWeekTakeaway: data.last_week_takeaway,
    thisWeekFocus: data.this_week_focus,
    adaptationContext: data.adaptation_context,
    pendingRationaleIds: (data.pending_rationale_ids ?? []) as string[],
    coachingPrompt: data.coaching_prompt,
    viewedAt: data.viewed_at,
    dismissedAt: data.dismissed_at,
    createdAt: data.created_at
  };
}

/**
 * Generate and store a week transition briefing. If one already exists, return it.
 */
export async function generateWeekTransitionBriefing(
  supabase: SupabaseClient,
  athleteId: string,
  weekStart: string
): Promise<WeekTransitionBriefing> {
  // Check for existing
  const existing = await getWeekTransitionBriefing(supabase, athleteId, weekStart);
  if (existing) return existing;

  // Assemble context
  const priorWeekStart = addDaysIso(weekStart, -7);
  const weekEnd = addDaysIso(weekStart, 6);

  // Fetch prior week debrief
  const { data: debriefRow } = await supabase
    .from("weekly_debriefs")
    .select("id,facts,week_start,week_end,carry_forward_note")
    .eq("user_id", athleteId)
    .eq("week_start", priorWeekStart)
    .maybeSingle();

  let priorWeekDebrief: WeekTransitionContext["priorWeekDebrief"] = null;
  let priorDebriefId: string | null = null;
  if (debriefRow?.facts && typeof debriefRow.facts === "object") {
    priorDebriefId = debriefRow.id;
    const facts = debriefRow.facts as Record<string, unknown>;
    priorWeekDebrief = {
      weekLabel: (facts.weekLabel as string) ?? `Week of ${priorWeekStart}`,
      completionPct: (facts.completionPct as number) ?? 0,
      completedSessions: (facts.completedSessions as number) ?? 0,
      plannedSessions: (facts.plannedSessions as number) ?? 0,
      keySessionsCompleted: (facts.keySessionsCompleted as number) ?? 0,
      keySessionsTotal: (facts.keySessionsTotal as number) ?? 0,
      statusLine: (facts.statusLine as string) ?? "",
      primaryTakeaway: (facts.primaryTakeawayTitle as string) ?? "",
      factualBullets: (facts.factualBullets as string[]) ?? [],
      carryForwardNote: (debriefRow.carry_forward_note as string | null) ??
        (facts.carryForwardNote as string | null) ?? null
    };
  }

  // Fetch this week's sessions
  const { data: sessionsData } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,duration_minutes,is_key")
    .eq("user_id", athleteId)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .order("date", { ascending: true });

  const currentWeekSessions: WeekTransitionContext["currentWeekSessions"] =
    (sessionsData ?? []).map((s: Record<string, unknown>) => ({
      date: s.date as string,
      sport: s.sport as string,
      type: s.type as string,
      sessionName: (s.session_name as string | null) ?? null,
      durationMinutes: (s.duration_minutes as number) ?? 0,
      isKey: Boolean(s.is_key)
    }));

  // Fetch training block context
  const { data: profileData } = await supabase
    .from("profiles")
    .select("active_plan_id")
    .eq("id", athleteId)
    .maybeSingle();

  let trainingBlock: WeekTransitionContext["trainingBlock"] = {
    currentBlock: "Build",
    blockWeek: 1,
    blockTotalWeeks: 1,
    weekNumber: 1
  };

  if (profileData?.active_plan_id) {
    const { data: weeks } = await supabase
      .from("training_weeks")
      .select("week_index,focus,week_start_date")
      .eq("plan_id", profileData.active_plan_id)
      .order("week_index", { ascending: true });

    if (weeks && weeks.length > 0) {
      const currentWeek = weeks.find(
        (w: Record<string, unknown>) => (w.week_start_date as string) === weekStart
      );
      const weekIndex = currentWeek
        ? (currentWeek.week_index as number)
        : weeks.length;
      const focus = currentWeek
        ? (currentWeek.focus as string)
        : (weeks[weeks.length - 1].focus as string);

      // Count contiguous weeks with same focus
      const allWeeks = weeks as Array<{ week_index: number; focus: string }>;
      let blockStart = weekIndex;
      let blockEnd = weekIndex;
      for (let i = weekIndex - 1; i >= 1; i--) {
        if (allWeeks.find((w) => w.week_index === i)?.focus === focus) blockStart = i;
        else break;
      }
      for (let i = weekIndex + 1; i <= allWeeks.length; i++) {
        if (allWeeks.find((w) => w.week_index === i)?.focus === focus) blockEnd = i;
        else break;
      }

      trainingBlock = {
        currentBlock: focus,
        blockWeek: weekIndex - blockStart + 1,
        blockTotalWeeks: blockEnd - blockStart + 1,
        weekNumber: weekIndex
      };
    }
  }

  // Fetch pending adaptation rationales
  const { data: rationalesData } = await supabase
    .from("adaptation_rationales")
    .select("id,rationale_text,trigger_type")
    .eq("user_id", athleteId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);

  const pendingRationales: WeekTransitionContext["pendingRationales"] =
    (rationalesData ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      rationaleText: r.rationale_text as string,
      triggerType: r.trigger_type as string
    }));

  // Generate AI briefing
  const ctx: WeekTransitionContext = {
    priorWeekDebrief: priorWeekDebrief,
    currentWeekSessions,
    trainingBlock,
    pendingRationales,
    athleteName: null
  };

  const aiOutput = await generateWeekTransitionBriefingAI(ctx);

  // Store
  const { data: inserted, error } = await supabase
    .from("week_transition_briefings")
    .upsert(
      {
        user_id: athleteId,
        athlete_id: athleteId,
        prior_week_debrief_id: priorDebriefId,
        current_week_start: weekStart,
        last_week_takeaway: aiOutput.last_week_takeaway,
        this_week_focus: aiOutput.this_week_focus,
        adaptation_context: aiOutput.adaptation_context,
        pending_rationale_ids: pendingRationales.map((r) => r.id),
        coaching_prompt: aiOutput.coaching_prompt,
        ai_model_used: getCoachModel(),
        ai_prompt_version: WEEK_TRANSITION_PROMPT_VERSION
      },
      { onConflict: "user_id,current_week_start" }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    console.warn("[week-transition] Failed to store briefing:", error.message);
    // Return a non-persisted version
    return {
      id: "transient",
      currentWeekStart: weekStart,
      lastWeekTakeaway: aiOutput.last_week_takeaway,
      thisWeekFocus: aiOutput.this_week_focus,
      adaptationContext: aiOutput.adaptation_context,
      pendingRationaleIds: pendingRationales.map((r) => r.id),
      coachingPrompt: aiOutput.coaching_prompt,
      viewedAt: null,
      dismissedAt: null,
      createdAt: new Date().toISOString()
    };
  }

  return {
    id: inserted!.id,
    currentWeekStart: inserted!.current_week_start,
    lastWeekTakeaway: inserted!.last_week_takeaway,
    thisWeekFocus: inserted!.this_week_focus,
    adaptationContext: inserted!.adaptation_context,
    pendingRationaleIds: (inserted!.pending_rationale_ids ?? []) as string[],
    coachingPrompt: inserted!.coaching_prompt,
    viewedAt: inserted!.viewed_at,
    dismissedAt: inserted!.dismissed_at,
    createdAt: inserted!.created_at
  };
}

/**
 * Mark a briefing as viewed.
 */
export async function markBriefingViewed(
  supabase: SupabaseClient,
  briefingId: string
): Promise<void> {
  await supabase
    .from("week_transition_briefings")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", briefingId);
}

/**
 * Mark a briefing as dismissed.
 */
export async function markBriefingDismissed(
  supabase: SupabaseClient,
  briefingId: string
): Promise<void> {
  await supabase
    .from("week_transition_briefings")
    .update({ dismissed_at: new Date().toISOString() })
    .eq("id", briefingId);
}

/**
 * Finalize a weekly debrief (mark as is_finalized).
 */
export async function finalizeWeeklyDebrief(
  supabase: SupabaseClient,
  debriefId: string
): Promise<void> {
  await supabase
    .from("weekly_debriefs")
    .update({ is_finalized: true, finalized_at: new Date().toISOString() })
    .eq("id", debriefId);
}
