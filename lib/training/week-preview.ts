import type { SupabaseClient } from "@supabase/supabase-js";
import type { MacroContext } from "./macro-context";
import { computeWeekMinuteTotals, getKeySessionsRemaining } from "./week-metrics";

export type WeekPreview = {
  weekStart: string;
  totalPlannedMinutes: number;
  keySessionCount: number;
  keySessions: Array<{ date: string; sport: string; type: string; durationMinutes: number | null }>;
  sportDistribution: Record<string, number>; // sport -> planned minutes
  carryForwardNote: string | null;
  macroContext: MacroContext;
  aiNarrative: string | null;
};

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function generateWeekPreview(
  supabase: SupabaseClient,
  athleteId: string,
  weekStart: string,
  macroCtx: MacroContext
): Promise<WeekPreview> {
  const weekEnd = addDays(weekStart, 7);
  const todayIso = new Date().toISOString().slice(0, 10);

  // Fetch sessions for the upcoming week
  const { data: sessionsData } = await supabase
    .from("sessions")
    .select("id,date,sport,type,duration_minutes,status,is_key")
    .eq("user_id", athleteId)
    .gte("date", weekStart)
    .lt("date", weekEnd)
    .order("date", { ascending: true });

  const sessions = (sessionsData ?? []).map((s) => ({
    id: s.id,
    date: s.date,
    sport: s.sport,
    type: s.type,
    durationMinutes: s.duration_minutes ?? 0,
    status: (s.status ?? "planned") as "planned" | "completed" | "skipped",
    isKey: Boolean(s.is_key)
  }));

  const minuteTotals = computeWeekMinuteTotals(sessions);
  const keySessionsRemaining = getKeySessionsRemaining(sessions, todayIso) as typeof sessions;

  // Sport distribution
  const sportDistribution: Record<string, number> = {};
  for (const session of sessions) {
    if (session.status !== "skipped") {
      sportDistribution[session.sport] = (sportDistribution[session.sport] ?? 0) + session.durationMinutes;
    }
  }

  // Carry-forward note from previous week's debrief
  const prevWeekStart = addDays(weekStart, -7);
  const { data: prevDebrief } = await supabase
    .from("weekly_debriefs")
    .select("carry_forward_note,facts")
    .eq("user_id", athleteId)
    .eq("week_start", prevWeekStart)
    .maybeSingle();

  const carryForwardNote =
    (prevDebrief?.carry_forward_note as string | null) ??
    ((prevDebrief?.facts as Record<string, unknown> | null)?.carryForwardNote as string | null) ??
    null;

  return {
    weekStart,
    totalPlannedMinutes: minuteTotals.plannedMinutes,
    keySessionCount: keySessionsRemaining.length,
    keySessions: keySessionsRemaining.map((s) => ({
      date: s.date,
      sport: s.sport,
      type: s.type,
      durationMinutes: s.durationMinutes
    })),
    sportDistribution,
    carryForwardNote,
    macroContext: macroCtx,
    aiNarrative: null
  };
}
