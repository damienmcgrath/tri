/**
 * Cross-discipline tradeoff intelligence.
 *
 * Computes rolling discipline balance over a multi-week window,
 * compares against the target distribution for the athlete's A-race,
 * and generates prescriptive rebalancing recommendations.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTargetDistribution } from "./race-profile";
import { querySessionLoad } from "@/lib/supabase/queries";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DisciplineDistribution = {
  swim: number;
  bike: number;
  run: number;
  strength?: number;
};

export type DisciplineDeltas = {
  swim: number; // percentage points: actual% - target%
  bike: number;
  run: number;
};

export type DeltaSeverity = "on_target" | "moderate" | "significant";

export type BalanceSnapshot = {
  snapshotDate: string;
  windowDays: number;
  actual: DisciplineDistribution;
  target: DisciplineDistribution;
  deltas: DisciplineDeltas;
  totalHours: number;
  hoursBySport: Record<string, number>;
};

export type RebalancingRecommendation = {
  type: "add" | "swap" | "reduce" | "maintain";
  sport: string;
  summary: string;
  rationale: string;
  priority: number;
};

// ─── Constants ─────────────────────────────────────────────────────────────

const MODERATE_THRESHOLD_PP = 5;
const SIGNIFICANT_THRESHOLD_PP = 10;

// ─── Core computation ──────────────────────────────────────────────────────

/**
 * Compute the rolling discipline balance over the given window.
 */
export async function computeRollingDisciplineBalance(
  supabase: SupabaseClient,
  userId: string,
  windowDays = 21
): Promise<BalanceSnapshot> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const windowStart = new Date(today.getTime() - windowDays * 86400000).toISOString().slice(0, 10);

  // Fetch session load data for the window
  const loads = await querySessionLoad(supabase, userId, windowStart, todayIso);

  // Aggregate duration by sport
  const hoursBySport: Record<string, number> = {};
  let totalSeconds = 0;

  for (const row of loads) {
    const sport = (row.sport as string) ?? "other";
    const durSec = Number(row.duration_sec) || 0;
    hoursBySport[sport] = (hoursBySport[sport] ?? 0) + durSec / 3600;
    totalSeconds += durSec;
  }

  const totalHours = totalSeconds / 3600;

  // Compute actual distribution (as fractions)
  const actual: DisciplineDistribution = {
    swim: totalHours > 0 ? (hoursBySport.swim ?? 0) / totalHours : 0,
    bike: totalHours > 0 ? (hoursBySport.bike ?? 0) / totalHours : 0,
    run: totalHours > 0 ? (hoursBySport.run ?? 0) / totalHours : 0,
    strength: totalHours > 0 ? (hoursBySport.strength ?? 0) / totalHours : 0,
  };

  // Get target distribution
  const target = await getTargetDistribution(supabase, userId);

  // Compute deltas in percentage points
  const deltas = computeDeltas(actual, target);

  return {
    snapshotDate: todayIso,
    windowDays,
    actual,
    target,
    deltas,
    totalHours: Math.round(totalHours * 10) / 10,
    hoursBySport,
  };
}

/**
 * Compute per-sport deltas in percentage points.
 */
export function computeDeltas(
  actual: DisciplineDistribution,
  target: DisciplineDistribution
): DisciplineDeltas {
  return {
    swim: Math.round((actual.swim - target.swim) * 100),
    bike: Math.round((actual.bike - target.bike) * 100),
    run: Math.round((actual.run - target.run) * 100),
  };
}

/**
 * Classify delta severity.
 */
export function classifyDeltaSeverity(deltaPp: number): DeltaSeverity {
  const abs = Math.abs(deltaPp);
  if (abs >= SIGNIFICANT_THRESHOLD_PP) return "significant";
  if (abs >= MODERATE_THRESHOLD_PP) return "moderate";
  return "on_target";
}

/**
 * Generate rebalancing recommendations from a balance snapshot.
 *
 * Rules:
 * - If any sport is ≥10pp off target: significant recommendation
 * - If any sport is ≥5pp off target: moderate recommendation
 * - If all sports within 5pp: maintain
 */
export function generateRebalancingRecommendations(
  snapshot: BalanceSnapshot
): RebalancingRecommendation[] {
  const { deltas, actual, target } = snapshot;
  const recommendations: RebalancingRecommendation[] = [];

  const sports = [
    { key: "swim", delta: deltas.swim, actual: actual.swim, target: target.swim },
    { key: "bike", delta: deltas.bike, actual: actual.bike, target: target.bike },
    { key: "run", delta: deltas.run, actual: actual.run, target: target.run },
  ];

  const hasSignificant = sports.some((s) => Math.abs(s.delta) >= SIGNIFICANT_THRESHOLD_PP);

  if (!hasSignificant) {
    const hasModerate = sports.some((s) => Math.abs(s.delta) >= MODERATE_THRESHOLD_PP);

    if (!hasModerate) {
      recommendations.push({
        type: "maintain",
        sport: "all",
        summary: "Distribution looks well-balanced right now.",
        rationale: `All three disciplines are within ${MODERATE_THRESHOLD_PP}pp of target. Maintain current allocation.`,
        priority: 0,
      });
      return recommendations;
    }
  }

  // Find over-invested and under-invested sports
  const overInvested = sports
    .filter((s) => s.delta >= MODERATE_THRESHOLD_PP)
    .sort((a, b) => b.delta - a.delta);

  const underInvested = sports
    .filter((s) => s.delta <= -MODERATE_THRESHOLD_PP)
    .sort((a, b) => a.delta - b.delta);

  // Generate swap/shift recommendations
  if (overInvested.length > 0 && underInvested.length > 0) {
    const from = overInvested[0]!;
    const to = underInvested[0]!;

    recommendations.push({
      type: "swap",
      sport: to.key,
      summary: `Shift volume from ${from.key} to ${to.key}`,
      rationale: `${capitalize(from.key)} is ${from.delta}pp over target (${pct(from.actual)} actual vs ${pct(from.target)} target), while ${to.key} is ${Math.abs(to.delta)}pp under target (${pct(to.actual)} actual vs ${pct(to.target)} target). Consider replacing one ${from.key} session with ${to.key} this week.`,
      priority: Math.abs(from.delta) + Math.abs(to.delta),
    });
  } else if (underInvested.length > 0) {
    const sport = underInvested[0]!;
    recommendations.push({
      type: "add",
      sport: sport.key,
      summary: `Add more ${sport.key} volume`,
      rationale: `${capitalize(sport.key)} is ${Math.abs(sport.delta)}pp under target (${pct(sport.actual)} actual vs ${pct(sport.target)} target). Look for opportunities to add a short ${sport.key} session.`,
      priority: Math.abs(sport.delta),
    });
  } else if (overInvested.length > 0) {
    const sport = overInvested[0]!;
    recommendations.push({
      type: "reduce",
      sport: sport.key,
      summary: `Reduce ${sport.key} volume`,
      rationale: `${capitalize(sport.key)} is ${sport.delta}pp over target (${pct(sport.actual)} actual vs ${pct(sport.target)} target). The marginal gain from additional ${sport.key} is smaller than investing that time elsewhere.`,
      priority: Math.abs(sport.delta),
    });
  }

  return recommendations.sort((a, b) => b.priority - a.priority);
}

/**
 * Persist a balance snapshot and its recommendations to the database.
 */
export async function persistBalanceSnapshot(
  supabase: SupabaseClient,
  userId: string,
  snapshot: BalanceSnapshot,
  recommendations: RebalancingRecommendation[],
  targetRaceId: string | null
): Promise<string> {
  const { data: snapshotRow, error: snapError } = await supabase
    .from("discipline_balance_snapshots")
    .upsert(
      {
        user_id: userId,
        athlete_id: userId,
        snapshot_date: snapshot.snapshotDate,
        window_days: snapshot.windowDays,
        actual_distribution: snapshot.actual,
        target_distribution: snapshot.target,
        deltas: snapshot.deltas,
        total_hours: snapshot.totalHours,
        hours_by_sport: snapshot.hoursBySport,
        target_race_id: targetRaceId,
      },
      { onConflict: "user_id,snapshot_date,window_days" }
    )
    .select("id")
    .single();

  if (snapError) throw new Error(snapError.message);

  // Persist recommendations
  if (recommendations.length > 0) {
    const rows = recommendations.map((r) => ({
      user_id: userId,
      athlete_id: userId,
      snapshot_id: snapshotRow.id,
      recommendation_type: r.type,
      sport: r.sport,
      summary: r.summary,
      rationale: r.rationale,
      priority: r.priority,
    }));

    await supabase.from("rebalancing_recommendations").insert(rows);
  }

  return snapshotRow.id;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
