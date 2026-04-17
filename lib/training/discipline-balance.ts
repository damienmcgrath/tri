/**
 * Discipline balance: computes per-sport TSS/duration/count for a given week
 * and detects significant imbalances vs planned distribution.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { querySessionLoad } from "@/lib/supabase/queries";

export type DisciplineVolume = {
  tss: number;
  durationMinutes: number;
  sessionCount: number;
};

export type WeeklyDisciplineBalance = {
  weekStart: string;
  actual: Record<string, DisciplineVolume>;
  planned: Record<string, DisciplineVolume>;
  totalActualTss: number;
  totalPlannedTss: number;
};

export type DisciplineImbalance = {
  sport: string;
  actualPct: number;
  plannedPct: number;
  deltaPp: number;
  direction: "over" | "under";
};

/**
 * Compute per-sport TSS, duration, and session count for a given week.
 */
export async function computeWeeklyDisciplineBalance(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string
): Promise<WeeklyDisciplineBalance> {
  const weekEnd = addDaysIso(weekStart, 6);

  // Fetch actual loads from session_load
  const loads = await querySessionLoad(supabase, userId, weekStart, weekEnd);

  // Fetch planned sessions for the same week
  const { data: planned } = await supabase
    .from("sessions")
    .select("sport, duration_minutes, status")
    .eq("user_id", userId)
    .gte("date", weekStart)
    .lte("date", weekEnd);

  const actual: Record<string, DisciplineVolume> = {};
  let totalActualTss = 0;

  if (loads && loads.length > 0) {
    // Use session_load data when available (activity files uploaded)
    for (const row of loads) {
      const sport = row.sport ?? "other";
      const tss = Number(row.tss) || 0;
      const durMin = row.duration_sec ? Math.round(Number(row.duration_sec) / 60) : 0;

      if (!actual[sport]) actual[sport] = { tss: 0, durationMinutes: 0, sessionCount: 0 };
      actual[sport].tss += tss;
      actual[sport].durationMinutes += durMin;
      actual[sport].sessionCount += 1;
      totalActualTss += tss;
    }
  } else {
    // Fallback: derive actuals from completed sessions (duration as TSS proxy)
    for (const row of planned ?? []) {
      if (row.status !== "completed") continue;
      const sport = row.sport ?? "other";
      const durMin = row.duration_minutes ?? 0;
      const estimatedTss = durMin; // same heuristic as planned TSS

      if (!actual[sport]) actual[sport] = { tss: 0, durationMinutes: 0, sessionCount: 0 };
      actual[sport].tss += estimatedTss;
      actual[sport].durationMinutes += durMin;
      actual[sport].sessionCount += 1;
      totalActualTss += estimatedTss;
    }
  }

  const plannedAgg: Record<string, DisciplineVolume> = {};
  let totalPlannedTss = 0;

  for (const row of planned ?? []) {
    const sport = row.sport ?? "other";
    const durMin = row.duration_minutes ?? 0;
    // Estimate planned TSS from duration (rough heuristic: ~1 TSS per minute)
    const estimatedTss = durMin;

    if (!plannedAgg[sport]) plannedAgg[sport] = { tss: 0, durationMinutes: 0, sessionCount: 0 };
    plannedAgg[sport].tss += estimatedTss;
    plannedAgg[sport].durationMinutes += durMin;
    plannedAgg[sport].sessionCount += 1;
    totalPlannedTss += estimatedTss;
  }

  return {
    weekStart,
    actual,
    planned: plannedAgg,
    totalActualTss,
    totalPlannedTss
  };
}

/**
 * Detect sports where actual TSS distribution deviates from planned by >10 percentage points.
 */
export function detectDisciplineImbalance(
  balance: WeeklyDisciplineBalance,
  thresholdPp = 10
): DisciplineImbalance[] {
  const { actual, planned, totalActualTss, totalPlannedTss } = balance;
  if (totalActualTss === 0 || totalPlannedTss === 0) return [];

  const allSports = new Set([...Object.keys(actual), ...Object.keys(planned)]);
  const imbalances: DisciplineImbalance[] = [];

  for (const sport of allSports) {
    if (sport === "other" || sport === "strength") continue;

    const actualTss = actual[sport]?.tss ?? 0;
    const plannedTss = planned[sport]?.tss ?? 0;

    const actualPct = (actualTss / totalActualTss) * 100;
    const plannedPct = (plannedTss / totalPlannedTss) * 100;
    const deltaPp = actualPct - plannedPct;

    if (Math.abs(deltaPp) > thresholdPp) {
      imbalances.push({
        sport,
        actualPct: Math.round(actualPct),
        plannedPct: Math.round(plannedPct),
        deltaPp: Math.round(deltaPp),
        direction: deltaPp > 0 ? "over" : "under"
      });
    }
  }

  return imbalances.sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
