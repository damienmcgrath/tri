/**
 * Pacing analysis for a single discipline leg.
 *
 * Three deterministic signals, each behind a hard threshold so observations
 * only surface when they're statistically meaningful:
 *
 *   - Split type: even (|delta| ≤ 2%), positive (slowed), negative (faster).
 *   - Drift observation: fires only when |drift| > 5%.
 *   - Decoupling observation: pace-vs-HR decoupling > 8% (second half eased
 *     and HR rose, or pace held but HR rose faster than effort would imply).
 *
 * All return a short string when fired, null otherwise. The AI never
 * decides whether to mention drift or decoupling — it gets the string or
 * it gets nothing.
 */

import type { LegPacing } from "@/lib/race-review";

export type SplitType = "even" | "positive" | "negative";

const EVEN_TOLERANCE_PCT = 2;
const DRIFT_THRESHOLD_PCT = 5;
const DECOUPLING_THRESHOLD_PCT = 8;

/**
 * Classify split type from halves data. The unit determines direction:
 *   - watts: higher is better → positive deltaPct = faster (negative split).
 *   - pace units: higher is slower → positive deltaPct = positive split.
 */
export function classifySplitType(pacing: LegPacing): SplitType | null {
  if (!pacing.halvesAvailable) return null;
  const { deltaPct, unit } = pacing;
  // Normalize to "slowdown magnitude" (positive = slower second half).
  const slowdownPct = unit === "watts" ? -deltaPct : deltaPct;
  if (Math.abs(slowdownPct) <= EVEN_TOLERANCE_PCT) return "even";
  return slowdownPct > 0 ? "positive" : "negative";
}

/**
 * Drift observation — fires only when the absolute halves delta exceeds the
 * 5% gate. Returns plain-English copy that cites the actual halves and the
 * delta percent, or null.
 */
export function computeDriftObservation(pacing: LegPacing): string | null {
  if (!pacing.halvesAvailable) return null;
  const { deltaPct, unit, firstHalf, lastHalf } = pacing;
  const slowdownPct = unit === "watts" ? -deltaPct : deltaPct;
  if (Math.abs(slowdownPct) <= DRIFT_THRESHOLD_PCT) return null;

  const direction = slowdownPct > 0 ? "eased" : "lifted";
  const firstLabel = formatLegValue(firstHalf, unit);
  const lastLabel = formatLegValue(lastHalf, unit);
  return `Second half ${direction} ${Math.abs(slowdownPct).toFixed(1)}% (${firstLabel} → ${lastLabel}).`;
}

/**
 * Decoupling observation — fires only when the pace-vs-HR decoupling
 * exceeds 8%. Decoupling here is the gap between the output drop and the HR
 * rise, in percent. When output held steady but HR climbed >8%, that's
 * cardiovascular decoupling. When output dropped >8% AND HR climbed too,
 * that's the cooked signal already covered by leg-status, but we still
 * surface the magnitude here for the diagnostic view.
 *
 * Inputs:
 *   - pacing: halves data already computed.
 *   - hrFirstHalfBpm / hrLastHalfBpm: per-half HR averages from laps.
 *
 * The hr*HalfBpm values are nullable; we return null when either is missing.
 */
export function computeDecouplingObservation(args: {
  pacing: LegPacing;
  hrFirstHalfBpm: number | null;
  hrLastHalfBpm: number | null;
}): string | null {
  const { pacing, hrFirstHalfBpm, hrLastHalfBpm } = args;
  if (!pacing.halvesAvailable) return null;
  if (hrFirstHalfBpm === null || hrLastHalfBpm === null) return null;
  if (hrFirstHalfBpm <= 0) return null;

  const hrPctRise = ((hrLastHalfBpm - hrFirstHalfBpm) / hrFirstHalfBpm) * 100;
  const slowdownPct = pacing.unit === "watts" ? -pacing.deltaPct : pacing.deltaPct;

  // Decoupling = HR rose by X% while output eased / failed to keep pace.
  // We define decoupling magnitude = hrPctRise + max(0, slowdownPct) since
  // both contribute to cardiovascular drift relative to output.
  const decouplingMagnitude = hrPctRise + Math.max(0, slowdownPct);
  if (decouplingMagnitude <= DECOUPLING_THRESHOLD_PCT) return null;

  const hrSign = hrPctRise >= 0 ? "+" : "−";
  if (slowdownPct > 0) {
    return `HR rose ${hrSign}${Math.abs(hrPctRise).toFixed(1)}% while output eased ${slowdownPct.toFixed(1)}% — cardiovascular decoupling (HR climbing relative to effort).`;
  }
  return `HR rose ${hrSign}${Math.abs(hrPctRise).toFixed(1)}% at steady output — cardiovascular decoupling (HR climbing relative to effort).`;
}

function formatLegValue(value: number, unit: LegPacing extends infer T ? T extends { unit: infer U } ? U : never : never): string {
  if (unit === "watts") return `${Math.round(value)}W`;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  const suffix = unit === "sec_per_km" ? " /km" : " /100m";
  return `${m}:${String(s).padStart(2, "0")}${suffix}`;
}
