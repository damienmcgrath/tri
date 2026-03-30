/**
 * Fatigue detection: identifies cross-discipline and discipline-specific fatigue
 * patterns from the athlete_fitness and session_load tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FitnessSport } from "./fitness-model";

export type FatigueSignal = {
  type: "cross_discipline" | "discipline_specific";
  severity: "warning" | "alert";
  sports: string[];
  detail: string;
  tsbValues: Record<string, number>;
};

const CORE_SPORTS: FitnessSport[] = ["swim", "bike", "run"];

/**
 * Detect correlated performance/TSB decline across 2+ sports over the last 7-10 days.
 * This suggests systemic fatigue rather than sport-specific overload.
 */
export async function detectCrossDisciplineFatigue(
  supabase: SupabaseClient,
  userId: string,
  lookbackDays = 10
): Promise<FatigueSignal | null> {
  const since = addDaysIso(todayIso(), -lookbackDays);

  const { data: rows } = await supabase
    .from("athlete_fitness")
    .select("date, sport, tsb")
    .eq("user_id", userId)
    .gte("date", since)
    .in("sport", CORE_SPORTS)
    .order("date", { ascending: true });

  if (!rows || rows.length === 0) return null;

  // Group by sport, compute TSB trend (start vs end)
  const bySport: Record<string, number[]> = {};
  for (const row of rows) {
    if (!bySport[row.sport]) bySport[row.sport] = [];
    bySport[row.sport].push(Number(row.tsb));
  }

  const declining: string[] = [];
  const tsbValues: Record<string, number> = {};

  for (const sport of CORE_SPORTS) {
    const values = bySport[sport];
    if (!values || values.length < 3) continue;

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

    tsbValues[sport] = Math.round(avgSecond * 10) / 10;

    // TSB dropping by more than 5 points on average = declining
    if (avgSecond - avgFirst < -5) {
      declining.push(sport);
    }
  }

  if (declining.length < 2) return null;

  const severity = declining.length >= 3 ? "alert" : "warning";
  return {
    type: "cross_discipline",
    severity,
    sports: declining,
    detail: `TSB declining across ${declining.join(", ")} over the last ${lookbackDays} days — suggests systemic fatigue, not sport-specific overload.`,
    tsbValues
  };
}

/**
 * Detect single-sport TSB decline while other sports remain stable.
 * This suggests sport-specific overreaching.
 */
export async function detectDisciplineSpecificDecline(
  supabase: SupabaseClient,
  userId: string,
  lookbackDays = 10
): Promise<FatigueSignal[]> {
  const since = addDaysIso(todayIso(), -lookbackDays);

  const { data: rows } = await supabase
    .from("athlete_fitness")
    .select("date, sport, tsb")
    .eq("user_id", userId)
    .gte("date", since)
    .in("sport", CORE_SPORTS)
    .order("date", { ascending: true });

  if (!rows || rows.length === 0) return [];

  const bySport: Record<string, number[]> = {};
  for (const row of rows) {
    if (!bySport[row.sport]) bySport[row.sport] = [];
    bySport[row.sport].push(Number(row.tsb));
  }

  // Classify each sport as declining, stable, or rising
  const sportTrend: Record<string, { trend: "declining" | "stable" | "rising"; latestTsb: number }> = {};

  for (const sport of CORE_SPORTS) {
    const values = bySport[sport];
    if (!values || values.length < 3) continue;

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    const delta = avgSecond - avgFirst;
    const latestTsb = values[values.length - 1];

    if (delta < -5) {
      sportTrend[sport] = { trend: "declining", latestTsb };
    } else if (delta > 5) {
      sportTrend[sport] = { trend: "rising", latestTsb };
    } else {
      sportTrend[sport] = { trend: "stable", latestTsb };
    }
  }

  const declining = Object.entries(sportTrend).filter(([, v]) => v.trend === "declining");
  const stableOrRising = Object.entries(sportTrend).filter(([, v]) => v.trend !== "declining");

  // Only flag if exactly 1 sport declining while others are stable/rising
  if (declining.length !== 1 || stableOrRising.length < 1) return [];

  const [sport, { latestTsb }] = declining[0];
  const tsbValues: Record<string, number> = {};
  for (const [s, v] of Object.entries(sportTrend)) {
    tsbValues[s] = Math.round(v.latestTsb * 10) / 10;
  }

  return [{
    type: "discipline_specific",
    severity: latestTsb < -15 ? "alert" : "warning",
    sports: [sport],
    detail: `${sport} TSB declining (${Math.round(latestTsb)}) while other disciplines stable — consider reducing ${sport} load or adding recovery.`,
    tsbValues
  }];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
