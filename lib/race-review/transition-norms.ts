/**
 * Population transition medians by race distance type.
 *
 * The race-review spec calls out transitions as the ONE place where a
 * population reference is acceptable, since there is no athlete-specific
 * training analogue for T1/T2. We don't store the athlete's date of birth,
 * so age-group breakdowns aren't possible — the medians here are
 * distance-keyed only and represent typical age-group amateur values.
 *
 * Sources: USAT / Ironman public race-result aggregates, rounded to the
 * nearest 5s. Treated as orientation, not performance gating.
 */

import type { RaceProfileForReview } from "@/lib/race-review";

export type TransitionNorm = {
  t1Sec: number;
  t2Sec: number;
};

const NORMS_BY_DISTANCE: Record<string, TransitionNorm> = {
  sprint: { t1Sec: 90, t2Sec: 70 },
  olympic: { t1Sec: 150, t2Sec: 90 },
  "70.3": { t1Sec: 240, t2Sec: 150 },
  ironman: { t1Sec: 360, t2Sec: 240 }
};

export function getTransitionNorm(
  raceProfile: RaceProfileForReview | null
): TransitionNorm | null {
  if (!raceProfile) return null;
  return NORMS_BY_DISTANCE[raceProfile.distanceType] ?? null;
}
