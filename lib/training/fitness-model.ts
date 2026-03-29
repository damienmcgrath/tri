/**
 * Fitness model: CTL / ATL / TSB computation using Banister impulse-response model.
 *
 * CTL (Chronic Training Load) — 42-day exponential moving average of daily TSS
 * ATL (Acute Training Load)   — 7-day exponential moving average of daily TSS
 * TSB (Training Stress Balance) — CTL − ATL (positive = fresh, negative = fatigued)
 *
 * All values are computed per-discipline and as a combined total.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CTL_TIME_CONSTANT = 42;
export const ATL_TIME_CONSTANT = 7;

export const SPORTS = ["swim", "bike", "run", "strength", "other", "total"] as const;
export type FitnessSport = (typeof SPORTS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FitnessSnapshot = {
  ctl: number;
  atl: number;
  tsb: number;
  rampRate: number | null;
};

export type ReadinessState = "fresh" | "absorbing" | "fatigued" | "overreaching";

export type DisciplineFitness = Record<FitnessSport, FitnessSnapshot>;

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------

/**
 * Single-step exponential moving average.
 * EMA_today = EMA_yesterday + (today − EMA_yesterday) × (1 / timeConstant)
 */
export function computeEma(previousEma: number, todayLoad: number, timeConstant: number): number {
  const alpha = 1 / timeConstant;
  return previousEma + (todayLoad - previousEma) * alpha;
}

/**
 * Compute a single day's fitness snapshot given the previous day's values.
 */
export function computeDailyFitness(
  previousCtl: number,
  previousAtl: number,
  todayTss: number
): { ctl: number; atl: number; tsb: number } {
  const ctl = computeEma(previousCtl, todayTss, CTL_TIME_CONSTANT);
  const atl = computeEma(previousAtl, todayTss, ATL_TIME_CONSTANT);
  const tsb = ctl - atl;
  return {
    ctl: round1(ctl),
    atl: round1(atl),
    tsb: round1(tsb)
  };
}

/**
 * Map TSB + trajectory to a readiness state for the athlete.
 *
 * | State        | Condition                          |
 * |--------------|------------------------------------|
 * | Fresh        | TSB > +15, rising or stable        |
 * | Absorbing    | TSB between −5 and +15             |
 * | Fatigued     | TSB between −20 and −5             |
 * | Overreaching | TSB < −20 or declining > 3 days    |
 */
export function getReadinessState(tsb: number, tsbTrend?: "rising" | "stable" | "declining" | null): ReadinessState {
  if (tsb < -20) return "overreaching";
  if (tsb < -5) return "fatigued";
  if (tsb > 15) return "fresh";
  return "absorbing";
}

/**
 * Compute ramp rate: week-over-week CTL change.
 * Positive = building fitness, negative = detraining.
 */
export function computeRampRate(ctlToday: number, ctl7DaysAgo: number): number {
  return round1(ctlToday - ctl7DaysAgo);
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/**
 * Rebuild the athlete_fitness table from daily_load data.
 *
 * Iterates day by day from `fromDate` (or the earliest daily_load),
 * computing rolling CTL/ATL/TSB for each sport and the total.
 */
export async function rebuildFitnessHistory(
  supabase: SupabaseClient,
  userId: string,
  fromDate?: string
): Promise<void> {
  // Get all daily loads, ordered by date
  let query = supabase
    .from("daily_load")
    .select("date, sport, tss")
    .eq("user_id", userId)
    .order("date", { ascending: true });

  if (fromDate) {
    query = query.gte("date", fromDate);
  }

  const { data: loads, error } = await query;
  if (error) throw new Error(`Failed to fetch daily loads: ${error.message}`);
  if (!loads?.length) return;

  // Get the fitness snapshot from the day before fromDate to seed the EMA
  const seedDate = fromDate
    ? prevDate(fromDate)
    : prevDate(loads[0].date);

  const { data: seedRows } = await supabase
    .from("athlete_fitness")
    .select("sport, ctl, atl")
    .eq("user_id", userId)
    .eq("date", seedDate);

  // Seed previous values per sport
  const prev: Record<string, { ctl: number; atl: number }> = {};
  for (const sport of SPORTS) {
    const seed = seedRows?.find((r) => r.sport === sport);
    prev[sport] = { ctl: seed?.ctl ?? 0, atl: seed?.atl ?? 0 };
  }

  // Group daily loads by date
  const byDate = new Map<string, Map<string, number>>();
  for (const row of loads) {
    if (!byDate.has(row.date)) byDate.set(row.date, new Map());
    byDate.get(row.date)!.set(row.sport, Number(row.tss) || 0);
  }

  // Fill gaps: iterate from first date to last date, even days with no load
  const dates = Array.from(byDate.keys()).sort();
  const allDates = generateDateRange(dates[0], dates[dates.length - 1]);

  const upsertBatch: Array<{
    user_id: string;
    date: string;
    sport: string;
    ctl: number;
    atl: number;
    tsb: number;
    ramp_rate: number | null;
  }> = [];

  // Track CTL from 7 days ago for ramp rate
  const ctlHistory: Record<string, number[]> = {};
  for (const sport of SPORTS) {
    ctlHistory[sport] = [];
  }

  for (const date of allDates) {
    const dayLoads = byDate.get(date);

    for (const sport of SPORTS) {
      const todayTss = dayLoads?.get(sport) ?? 0;
      const prevVal = prev[sport];
      const { ctl, atl, tsb } = computeDailyFitness(prevVal.ctl, prevVal.atl, todayTss);

      // Ramp rate: compare to CTL from 7 days ago
      const history = ctlHistory[sport];
      history.push(ctl);
      const rampRate = history.length > 7
        ? computeRampRate(ctl, history[history.length - 8])
        : null;

      upsertBatch.push({
        user_id: userId,
        date,
        sport,
        ctl,
        atl,
        tsb,
        ramp_rate: rampRate
      });

      prev[sport] = { ctl, atl };
    }
  }

  // Upsert in batches of 500
  for (let i = 0; i < upsertBatch.length; i += 500) {
    const batch = upsertBatch.slice(i, i + 500);
    const { error: upsertError } = await supabase
      .from("athlete_fitness")
      .upsert(batch, { onConflict: "user_id,date,sport" });
    if (upsertError) {
      throw new Error(`Failed to upsert athlete_fitness: ${upsertError.message}`);
    }
  }
}

/**
 * Get the latest fitness snapshot for a user, optionally for a specific sport.
 * Returns per-discipline + total fitness data.
 */
export async function getLatestFitness(
  supabase: SupabaseClient,
  userId: string
): Promise<DisciplineFitness | null> {
  // Get the most recent date with fitness data
  const { data: latestRow } = await supabase
    .from("athlete_fitness")
    .select("date")
    .eq("user_id", userId)
    .eq("sport", "total")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRow) return null;

  const { data: rows, error } = await supabase
    .from("athlete_fitness")
    .select("sport, ctl, atl, tsb, ramp_rate")
    .eq("user_id", userId)
    .eq("date", latestRow.date);

  if (error || !rows?.length) return null;

  const result: Partial<DisciplineFitness> = {};
  for (const row of rows) {
    result[row.sport as FitnessSport] = {
      ctl: Number(row.ctl) || 0,
      atl: Number(row.atl) || 0,
      tsb: Number(row.tsb) || 0,
      rampRate: row.ramp_rate != null ? Number(row.ramp_rate) : null
    };
  }

  // Ensure all sports have a value
  const defaultSnapshot: FitnessSnapshot = { ctl: 0, atl: 0, tsb: 0, rampRate: null };
  for (const sport of SPORTS) {
    if (!result[sport]) result[sport] = defaultSnapshot;
  }

  return result as DisciplineFitness;
}

/**
 * Determine the TSB trend over the last few days.
 */
export async function getTsbTrend(
  supabase: SupabaseClient,
  userId: string,
  sport: FitnessSport = "total",
  days = 3
): Promise<"rising" | "stable" | "declining" | null> {
  const { data: rows } = await supabase
    .from("athlete_fitness")
    .select("tsb")
    .eq("user_id", userId)
    .eq("sport", sport)
    .order("date", { ascending: false })
    .limit(days + 1);

  if (!rows || rows.length < 2) return null;

  const values = rows.map((r) => Number(r.tsb));
  const deltas = [];
  for (let i = 0; i < values.length - 1; i++) {
    deltas.push(values[i] - values[i + 1]);
  }

  const avgDelta = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;

  if (avgDelta > 2) return "rising";
  if (avgDelta < -2) return "declining";
  return "stable";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function prevDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function generateDateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endStr}T00:00:00.000Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}
