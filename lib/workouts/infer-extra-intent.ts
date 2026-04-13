import {
  getMetricsV2HrZones,
  getMetricsV2PaceZones,
  getMetricsV2PowerZones,
  getMetricsV2Laps,
  getNestedNumber,
  type ZoneMetrics,
} from "./metrics-v2";

/**
 * Activity input used by the extras intent classifier. Only the fields the
 * classifier actually reads are required; the caller can pass a wider row.
 */
export type InferExtraIntentInput = {
  sport_type: string;
  duration_sec: number | null;
  metrics_v2?: Record<string, unknown> | null;
};

export type InferredExtraIntent = {
  /**
   * Short, human-readable label that `toIntentBucket` in
   * `lib/coach/session-diagnosis.ts` will map to a real evaluator bucket.
   * Also used by the AI prompt as the session's implied intent.
   */
  intentCategory: string;
  /**
   * A short explanation of why the classifier chose this label, used for
   * logging and for the AI prompt's "plannedStructure" context. Not user
   * facing.
   */
  rationale: string;
};

/**
 * Valid intent categories for extra sessions, used by the reclassify UI.
 * Each entry's `value` matches what `inferExtraIntent` returns and what
 * `toIntentBucket` in `lib/coach/session-diagnosis.ts` consumes.
 * `sports` restricts which options appear for a given sport (null = all).
 */
export const EXTRA_INTENT_OPTIONS = [
  { value: "recovery", label: "Recovery", sports: null },
  { value: "easy endurance", label: "Easy endurance", sports: null },
  { value: "long endurance run", label: "Long endurance run", sports: ["run"] as string[] },
  { value: "long endurance ride", label: "Long endurance ride", sports: ["bike"] as string[] },
  { value: "threshold intervals", label: "Threshold / intervals", sports: null },
  { value: "extra swim", label: "Swim session", sports: ["swim"] as string[] },
  { value: "extra strength", label: "Strength session", sports: ["strength"] as string[] },
] as const;

export type ExtraIntentValue = (typeof EXTRA_INTENT_OPTIONS)[number]["value"];

const LONG_RUN_MIN_MINUTES = 90;
const LONG_RIDE_MIN_MINUTES = 150;
const HARD_ZONE_THRESHOLD = 0.2;
const EASY_ZONE_THRESHOLD = 0.7;
const RECOVERY_ZONE_THRESHOLD = 0.85;
const RECOVERY_MAX_DURATION_MIN = 45;
const VARIABILITY_INTERVAL_THRESHOLD = 1.15;
const MIN_LAP_STRUCTURE_COUNT = 3;

function totalZoneSec(zones: ZoneMetrics[]): number {
  return zones.reduce((sum, zone) => sum + Math.max(0, zone.durationSec), 0);
}

function zoneShareAtOrAbove(zones: ZoneMetrics[], minZone: number): number | null {
  if (zones.length === 0) return null;
  const total = totalZoneSec(zones);
  if (total <= 0) return null;
  const filtered = zones
    .filter((zone) => zone.zone >= minZone)
    .reduce((sum, zone) => sum + Math.max(0, zone.durationSec), 0);
  return filtered / total;
}

function zoneShareAtOrBelow(zones: ZoneMetrics[], maxZone: number): number | null {
  if (zones.length === 0) return null;
  const total = totalZoneSec(zones);
  if (total <= 0) return null;
  const filtered = zones
    .filter((zone) => zone.zone <= maxZone)
    .reduce((sum, zone) => sum + Math.max(0, zone.durationSec), 0);
  return filtered / total;
}

function maxShare(values: Array<number | null>): number {
  let best = 0;
  for (const value of values) {
    if (typeof value === "number" && value > best) best = value;
  }
  return best;
}

/**
 * Classifies an extra (unplanned) workout into one of a small set of intent
 * categories so the downstream execution-review pipeline can use a real
 * evaluator bucket instead of the catch-all "unknown" path.
 *
 * The classifier intentionally returns labels that match the regex in
 * `toIntentBucket` in `lib/coach/session-diagnosis.ts`:
 *
 *   - "recovery"             → recovery bucket
 *   - "easy endurance"       → easy_endurance bucket
 *   - "long endurance"       → long_endurance bucket
 *   - "threshold intervals"  → threshold_quality bucket
 *
 * Swim and strength extras always resolve to `swim_strength` via the sport
 * argument in `toIntentBucket`, regardless of the string label.
 */
export function inferExtraIntent(activity: InferExtraIntentInput): InferredExtraIntent {
  const sport = activity.sport_type ?? "other";
  const durationMin = (activity.duration_sec ?? 0) / 60;
  const metrics = activity.metrics_v2 ?? null;

  // Swim and strength are routed to swim_strength by sport in toIntentBucket,
  // so the label is purely descriptive for the AI prompt.
  if (sport === "swim") {
    return {
      intentCategory: "extra swim",
      rationale: "swim activity — evaluated by swim_strength bucket",
    };
  }
  if (sport === "strength") {
    return {
      intentCategory: "extra strength",
      rationale: "strength activity — evaluated by swim_strength bucket",
    };
  }

  // Long endurance wins by duration even if the intensity distribution is
  // mostly easy — a 2h run is "long" regardless.
  if (sport === "run" && durationMin >= LONG_RUN_MIN_MINUTES) {
    return {
      intentCategory: "long endurance run",
      rationale: `run ≥ ${LONG_RUN_MIN_MINUTES} min (${Math.round(durationMin)} min)`,
    };
  }
  if (sport === "bike" && durationMin >= LONG_RIDE_MIN_MINUTES) {
    return {
      intentCategory: "long endurance ride",
      rationale: `ride ≥ ${LONG_RIDE_MIN_MINUTES} min (${Math.round(durationMin)} min)`,
    };
  }

  const hrZones = getMetricsV2HrZones(metrics);
  const paceZones = getMetricsV2PaceZones(metrics);
  const powerZones = getMetricsV2PowerZones(metrics);

  const hardShare = maxShare([
    zoneShareAtOrAbove(hrZones, 4),
    zoneShareAtOrAbove(paceZones, 4),
    zoneShareAtOrAbove(powerZones, 4),
  ]);
  const easyShare = maxShare([
    zoneShareAtOrBelow(hrZones, 2),
    zoneShareAtOrBelow(paceZones, 2),
    zoneShareAtOrBelow(powerZones, 2),
  ]);

  // Variability index + lap structure = quality / interval session.
  const variabilityIndex =
    getNestedNumber(metrics, [
      ["power", "variabilityIndex"],
      ["power", "variability_index"],
    ]) ??
    getNestedNumber(metrics, [["variabilityIndex"], ["variability_index"]]);
  const lapCount = getMetricsV2Laps(metrics).filter(
    (lap) => (lap.distanceM ?? 0) > 0,
  ).length;
  const hasLapStructure = lapCount >= MIN_LAP_STRUCTURE_COUNT;

  if (hardShare >= HARD_ZONE_THRESHOLD) {
    return {
      intentCategory: "threshold intervals",
      rationale: `${Math.round(hardShare * 100)}% time in zone 4+`,
    };
  }
  if (
    variabilityIndex !== null &&
    variabilityIndex >= VARIABILITY_INTERVAL_THRESHOLD &&
    hasLapStructure
  ) {
    return {
      intentCategory: "threshold intervals",
      rationale: `variability index ${variabilityIndex.toFixed(2)} with ${lapCount} work laps`,
    };
  }

  if (easyShare >= RECOVERY_ZONE_THRESHOLD && durationMin > 0 && durationMin < RECOVERY_MAX_DURATION_MIN) {
    return {
      intentCategory: "recovery",
      rationale: `${Math.round(easyShare * 100)}% time in zone 1-2 and under ${RECOVERY_MAX_DURATION_MIN} min`,
    };
  }

  if (easyShare >= EASY_ZONE_THRESHOLD) {
    return {
      intentCategory: "easy endurance",
      rationale: `${Math.round(easyShare * 100)}% time in zone 1-2`,
    };
  }

  // No strong intensity signals → easy endurance is the safest default.
  return {
    intentCategory: "easy endurance",
    rationale: "no strong intensity signals — defaulted to easy endurance",
  };
}
