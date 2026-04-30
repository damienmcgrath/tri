/**
 * Per-leg status classification.
 *
 * The AI never picks a leg status. We compute the label deterministically
 * from the halves data, the goal anchor, and the planned target, then hand
 * it to the model as an input fact along with the evidence behind it. This
 * keeps the verdict honest and reproducible across runs.
 *
 * Labels (spec §1B):
 * - on_plan   — pacing held steady AND output within ±5% of target
 * - strong    — output ≥3% over target with stable or descending pacing
 * - under     — output ≥5% under target with stable pacing (no fade)
 * - over      — first-half output ≥4% above target (started too hot)
 * - faded     — second half drops ≥4% (power/pace) vs first half
 * - cooked    — fade ≥8% OR second-half HR drift while output drops
 *
 * `null` is used when we don't have enough data for the leg (no halves AND
 * no leg-average + target). The AI is told to omit per-discipline verdict
 * for that leg.
 *
 * **Whole-leg fallback.** When halves data isn't available (e.g. a swim leg
 * imported from Strava with a single lap), but we have the leg-average
 * output AND a target, we still emit `on_plan` / `strong` / `under` from
 * the average alone. We CANNOT emit `over` / `faded` / `cooked` without
 * halves — those depend on intra-leg shape — so the fallback is
 * intentionally limited to the three target-anchored labels.
 */

import type { LegPacing } from "@/lib/race-review";

export type LegStatusLabel =
  | "on_plan"
  | "strong"
  | "under"
  | "over"
  | "faded"
  | "cooked";

export type LegStatusInput = {
  /** Halves data already computed in lib/race-review.ts. */
  pacing: LegPacing | undefined;
  /**
   * The athlete's target output for this leg as a number in the leg's natural
   * unit (watts for bike, sec/km for run, sec/100m for swim). Null when the
   * planned target couldn't be parsed.
   */
  targetOutput: number | null;
  /**
   * Optional second-half HR delta (bpm) for cardiac-drift detection on the run.
   * Positive = HR rose vs first half. Null when not computable.
   */
  hrDriftBpm?: number | null;
  /**
   * Whole-leg average output in the same unit as `targetOutput`. Used by
   * the fallback path when halves aren't available. Null when the segment
   * doesn't carry enough fields (e.g. distance unknown).
   */
  legAverageOutput?: number | null;
  /**
   * Unit for `legAverageOutput`. Required when `legAverageOutput` is
   * provided so the higher-is-better direction is unambiguous.
   */
  legAverageUnit?: "watts" | "sec_per_km" | "sec_per_100m";
};

export type LegStatusResult = {
  label: LegStatusLabel;
  /**
   * Plain-English evidence sentences the AI can quote into perDiscipline.summary.
   * Always carries at least one item.
   */
  evidence: string[];
};

/**
 * Returns null when there's not enough data to classify (no halves, or no
 * target and no fade signal).
 */
export function classifyLegStatus(input: LegStatusInput): LegStatusResult | null {
  const { pacing, targetOutput, hrDriftBpm, legAverageOutput, legAverageUnit } = input;

  // Whole-leg fallback when halves data isn't available.
  if (!pacing || !pacing.halvesAvailable) {
    if (
      legAverageOutput === null ||
      legAverageOutput === undefined ||
      !legAverageUnit
    ) {
      return null;
    }
    if (targetOutput !== null && targetOutput !== undefined && targetOutput > 0) {
      return classifyFromLegAverage({
        avg: legAverageOutput,
        target: targetOutput,
        unit: legAverageUnit
      });
    }
    // No target available → emit on_plan with informational evidence.
    // Mirrors the no-target path further down for legs WITH halves: when
    // we can't compare to a plan we don't make claims, we just surface
    // the leg average so the verdict tile shows real data rather than
    // "No data".
    return {
      label: "on_plan",
      evidence: [`Average ${formatLegAverage(legAverageOutput, legAverageUnit)} — no plan target captured for this leg.`]
    };
  }

  const { firstHalf, lastHalf, deltaPct, unit } = pacing;
  const avg = (firstHalf + lastHalf) / 2;

  // A "higher is better" signal for power; "lower is better" for pace.
  const higherIsBetter = unit === "watts";

  // For pace units, deltaPct = (last - first) / first → positive means slowing.
  // Normalize to "drop" magnitude (positive = bad regardless of unit).
  const dropPct = higherIsBetter ? -deltaPct : deltaPct;

  const ev: string[] = [];

  // Compare first-half effort against target if known.
  let firstHalfDeltaToTarget: number | null = null;
  let avgDeltaToTarget: number | null = null;
  if (targetOutput !== null && targetOutput !== undefined && targetOutput > 0) {
    const sign = higherIsBetter ? 1 : -1;
    firstHalfDeltaToTarget = sign * ((firstHalf - targetOutput) / targetOutput) * 100;
    avgDeltaToTarget = sign * ((avg - targetOutput) / targetOutput) * 100;
  }

  // ─── cooked: severe fade or HR-drift while output drops ────────────────
  if (dropPct >= 8) {
    ev.push(`Second half dropped ${dropPct.toFixed(1)}% vs first half.`);
    return { label: "cooked", evidence: ev };
  }
  if (hrDriftBpm !== null && hrDriftBpm !== undefined && hrDriftBpm >= 6 && dropPct >= 3) {
    ev.push(`HR drifted +${hrDriftBpm} bpm in the second half while output dropped ${dropPct.toFixed(1)}%.`);
    return { label: "cooked", evidence: ev };
  }

  // ─── over: started too hot vs target AND faded back ────────────────────
  // Distinguishes from "strong" (held high steady) and "faded" (started in
  // range but eased). Both signals must be present.
  if (
    firstHalfDeltaToTarget !== null &&
    firstHalfDeltaToTarget >= 4 &&
    dropPct >= 3
  ) {
    ev.push(`First half ran ${firstHalfDeltaToTarget.toFixed(1)}% above target before easing ${dropPct.toFixed(1)}%.`);
    return { label: "over", evidence: ev };
  }

  // ─── faded: clear second-half drop from a stable start ─────────────────
  if (dropPct >= 4) {
    ev.push(`Second half eased ${dropPct.toFixed(1)}% vs the first.`);
    return { label: "faded", evidence: ev };
  }

  // ─── strong: average ≥3% above target, no fade ────────────────────────
  if (avgDeltaToTarget !== null && avgDeltaToTarget >= 3 && dropPct < 2) {
    ev.push(`Average ${avgDeltaToTarget.toFixed(1)}% above target with stable halves (${signed(deltaPct)}%).`);
    return { label: "strong", evidence: ev };
  }

  // ─── under: average ≥5% below target, no fade ─────────────────────────
  if (avgDeltaToTarget !== null && avgDeltaToTarget <= -5 && dropPct < 2) {
    ev.push(`Average ${Math.abs(avgDeltaToTarget).toFixed(1)}% under target with stable halves (${signed(deltaPct)}%).`);
    return { label: "under", evidence: ev };
  }

  // ─── on_plan: default when stable + within range ──────────────────────
  if (avgDeltaToTarget !== null) {
    ev.push(`Average within ${Math.abs(avgDeltaToTarget).toFixed(1)}% of target; halves moved ${signed(deltaPct)}%.`);
  } else {
    ev.push(`Halves moved ${signed(deltaPct)}% across the leg.`);
  }
  return { label: "on_plan", evidence: ev };
}

/**
 * Target-only fallback. Emits `strong` / `under` / `on_plan` from the leg
 * average alone. Cannot emit `over` / `faded` / `cooked` (those need halves
 * shape).
 */
function classifyFromLegAverage(args: {
  avg: number;
  target: number;
  unit: "watts" | "sec_per_km" | "sec_per_100m";
}): LegStatusResult {
  const { avg, target, unit } = args;
  const higherIsBetter = unit === "watts";
  const sign = higherIsBetter ? 1 : -1;
  const avgDeltaPct = sign * ((avg - target) / target) * 100;

  if (avgDeltaPct >= 3) {
    return {
      label: "strong",
      evidence: [`Average ${avgDeltaPct.toFixed(1)}% above target (halves not available — leg-average only).`]
    };
  }
  if (avgDeltaPct <= -5) {
    return {
      label: "under",
      evidence: [`Average ${Math.abs(avgDeltaPct).toFixed(1)}% under target (halves not available — leg-average only).`]
    };
  }
  return {
    label: "on_plan",
    evidence: [`Average within ${Math.abs(avgDeltaPct).toFixed(1)}% of target (halves not available — leg-average only).`]
  };
}

function signed(n: number): string {
  if (n === 0) return "0.0";
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

function formatLegAverage(value: number, unit: "watts" | "sec_per_km" | "sec_per_100m"): string {
  if (unit === "watts") return `${Math.round(value)}W`;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  const suffix = unit === "sec_per_km" ? " /km" : " /100m";
  return `${m}:${String(s).padStart(2, "0")}${suffix}`;
}
