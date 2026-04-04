import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateMorningBriefAI,
  MORNING_BRIEF_PROMPT_VERSION,
  type MorningBriefContext
} from "@/lib/ai/prompts/morning-brief";
import { getSessionDisplayName } from "@/lib/training/session";
import { getCoachModel } from "@/lib/openai";

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getMonday(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export type MorningBrief = {
  id: string;
  briefDate: string;
  sessionPreview: string | null;
  readinessContext: string | null;
  weekContext: string;
  pendingActions: string[];
  briefText: string;
  viewedAt: string | null;
  createdAt: string;
};

/**
 * Get an existing morning brief for a date, or null.
 */
export async function getMorningBrief(
  supabase: SupabaseClient,
  athleteId: string,
  date: string
): Promise<MorningBrief | null> {
  const { data } = await supabase
    .from("morning_briefs")
    .select("*")
    .eq("user_id", athleteId)
    .eq("brief_date", date)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    briefDate: data.brief_date,
    sessionPreview: data.session_preview,
    readinessContext: data.readiness_context,
    weekContext: data.week_context,
    pendingActions: (data.pending_actions ?? []) as string[],
    briefText: data.brief_text,
    viewedAt: data.viewed_at,
    createdAt: data.created_at
  };
}

/**
 * Get or generate a morning brief for a given date.
 */
export async function getOrGenerateMorningBrief(
  supabase: SupabaseClient,
  athleteId: string,
  date: string
): Promise<MorningBrief> {
  const existing = await getMorningBrief(supabase, athleteId, date);
  if (existing) return existing;

  return generateMorningBrief(supabase, athleteId, date);
}

/**
 * Generate and store a morning brief.
 */
export async function generateMorningBrief(
  supabase: SupabaseClient,
  athleteId: string,
  date: string
): Promise<MorningBrief> {
  const weekStart = getMonday(date);
  const weekEnd = addDaysIso(weekStart, 6);

  // Fetch today's sessions
  const { data: todaySessions } = await supabase
    .from("sessions")
    .select("id,sport,type,session_name,duration_minutes,target,is_key,notes,status")
    .eq("user_id", athleteId)
    .eq("date", date)
    .eq("status", "planned")
    .order("created_at", { ascending: true })
    .limit(3);

  const todaySessionRow = (todaySessions ?? [])[0] as Record<string, unknown> | undefined;
  const todaySession: MorningBriefContext["todaySession"] = todaySessionRow
    ? {
        sport: todaySessionRow.sport as string,
        type: todaySessionRow.type as string,
        sessionName: (todaySessionRow.session_name as string | null) ?? null,
        durationMinutes: (todaySessionRow.duration_minutes as number) ?? 0,
        target: (todaySessionRow.target as string | null) ?? null,
        isKey: Boolean(todaySessionRow.is_key),
        notes: (todaySessionRow.notes as string | null) ?? null
      }
    : null;

  // Check if any sessions are planned at all today (including completed ones)
  const { count: totalTodayCount } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", athleteId)
    .eq("date", date);

  const isRestDay = (totalTodayCount ?? 0) === 0;

  // Fetch recent feel data (last 5)
  const { data: feelsData } = await supabase
    .from("session_feels")
    .select("overall_feel,energy_level,legs_feel,sleep_quality,life_stress,note,created_at")
    .eq("user_id", athleteId)
    .not("overall_feel", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const recentFeels: MorningBriefContext["recentFeels"] = (feelsData ?? []).map(
    (f: Record<string, unknown>) => ({
      overallFeel: (f.overall_feel as number) ?? 3,
      energyLevel: (f.energy_level as string | null) ?? null,
      legsFeel: (f.legs_feel as string | null) ?? null,
      sleepQuality: (f.sleep_quality as string | null) ?? null,
      lifeStress: (f.life_stress as string | null) ?? null,
      note: (f.note as string | null) ?? null,
      date: ((f.created_at as string) ?? "").slice(0, 10)
    })
  );

  // Fetch recent verdicts (last 5)
  const { data: verdictsData } = await supabase
    .from("session_verdicts")
    .select("purpose_statement,verdict_status,discipline,created_at")
    .eq("user_id", athleteId)
    .order("created_at", { ascending: false })
    .limit(5);

  const recentVerdicts: MorningBriefContext["recentVerdicts"] = (verdictsData ?? []).map(
    (v: Record<string, unknown>) => ({
      sessionName: ((v.purpose_statement as string) ?? "Session").slice(0, 60),
      verdictStatus: (v.verdict_status as string) ?? "unknown",
      discipline: (v.discipline as string) ?? "unknown",
      date: ((v.created_at as string) ?? "").slice(0, 10)
    })
  );

  // Week completion
  const { data: weekSessions } = await supabase
    .from("sessions")
    .select("status")
    .eq("user_id", athleteId)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  const weekSessionsList = (weekSessions ?? []) as Array<{ status: string }>;
  const completed = weekSessionsList.filter((s) => s.status === "completed").length;
  const planned = weekSessionsList.length;

  // Pending rationales
  const { count: rationaleCount } = await supabase
    .from("adaptation_rationales")
    .select("id", { count: "exact", head: true })
    .eq("user_id", athleteId)
    .eq("status", "pending");

  // Unreviewed debriefs
  const { count: debriefCount } = await supabase
    .from("weekly_debriefs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", athleteId)
    .eq("status", "ready");

  // Training block context (simplified)
  const trainingBlock: MorningBriefContext["trainingBlock"] = {
    currentBlock: "Build",
    blockWeek: 1,
    blockTotalWeeks: 1
  };

  const ctx: MorningBriefContext = {
    todaySession,
    isRestDay,
    recentFeels,
    recentVerdicts,
    weekCompletion: {
      completed,
      planned,
      weekLabel: `Week of ${weekStart}`
    },
    trainingBlock,
    pendingRationales: rationaleCount ?? 0,
    unreviewedDebriefs: debriefCount ?? 0,
    athleteName: null
  };

  const aiOutput = await generateMorningBriefAI(ctx);

  // Store
  const inputData = {
    planned_session: Boolean(todaySession),
    feel_data_available: recentFeels.length > 0,
    recent_feel_scores: recentFeels.map((f) => f.overallFeel),
    sessions_completed_this_week: completed,
    sessions_planned_this_week: planned,
    pending_rationales: rationaleCount ?? 0,
    is_rest_day: isRestDay
  };

  const { data: stored, error } = await supabase
    .from("morning_briefs")
    .upsert(
      {
        user_id: athleteId,
        athlete_id: athleteId,
        brief_date: date,
        session_preview: aiOutput.session_preview,
        readiness_context: aiOutput.readiness_context,
        week_context: aiOutput.week_context,
        pending_actions: aiOutput.pending_actions,
        brief_text: aiOutput.brief_text,
        input_data: inputData,
        ai_model_used: getCoachModel(),
        ai_prompt_version: MORNING_BRIEF_PROMPT_VERSION
      },
      { onConflict: "user_id,brief_date" }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    console.warn("[morning-brief] Failed to store:", error.message);
    return {
      id: "transient",
      briefDate: date,
      sessionPreview: aiOutput.session_preview,
      readinessContext: aiOutput.readiness_context,
      weekContext: aiOutput.week_context,
      pendingActions: aiOutput.pending_actions,
      briefText: aiOutput.brief_text,
      viewedAt: null,
      createdAt: new Date().toISOString()
    };
  }

  return {
    id: stored!.id,
    briefDate: stored!.brief_date,
    sessionPreview: stored!.session_preview,
    readinessContext: stored!.readiness_context,
    weekContext: stored!.week_context,
    pendingActions: (stored!.pending_actions ?? []) as string[],
    briefText: stored!.brief_text,
    viewedAt: stored!.viewed_at,
    createdAt: stored!.created_at
  };
}
