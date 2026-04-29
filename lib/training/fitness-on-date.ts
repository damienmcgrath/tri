/**
 * Read-only fitness lookups anchored to a specific historical date.
 *
 * Sibling of getLatestFitness in fitness-model.ts, but does NOT forward-project
 * to today — used for race-day pre-race snapshots, where we need the value as
 * it stood on the morning of the race, not what it would be today.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FitnessSnapshot, FitnessSport } from "@/lib/training/fitness-model";

export type FitnessOnDateResult = FitnessSnapshot & {
  /** The actual date the snapshot was sourced from (may be earlier than `asOf`). */
  sourceDate: string;
};

/**
 * Returns the most recent fitness snapshot on or before `asOf` for a sport.
 * Null when the user has no fitness rows on or before that date.
 */
export async function getFitnessOnDate(
  supabase: SupabaseClient,
  userId: string,
  asOf: string,
  sport: FitnessSport = "total"
): Promise<FitnessOnDateResult | null> {
  const { data: row } = await supabase
    .from("athlete_fitness")
    .select("date, ctl, atl, tsb, ramp_rate")
    .eq("user_id", userId)
    .eq("sport", sport)
    .lte("date", asOf)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return null;

  return {
    ctl: Number(row.ctl) || 0,
    atl: Number(row.atl) || 0,
    tsb: Number(row.tsb) || 0,
    rampRate: row.ramp_rate != null ? Number(row.ramp_rate) : null,
    sourceDate: row.date as string
  };
}
