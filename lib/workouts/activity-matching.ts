export type MatchingCandidate = {
  id: string;
  sport: string;
  startTimeUtc: string;
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
};

export type MatchInput = {
  sportType: string;
  startTimeUtc: string;
  durationSec: number;
  distanceM: number;
};

export type ScoredCandidate = {
  candidateId: string;
  confidence: number;
  reason: Record<string, number | string | boolean>;
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function scoreCandidate(activity: MatchInput, candidate: MatchingCandidate): ScoredCandidate {
  const activityStart = new Date(activity.startTimeUtc).getTime();
  const planStart = new Date(candidate.startTimeUtc).getTime();
  const minutesDiff = Math.abs(activityStart - planStart) / 60000;

  const timeScore = minutesDiff <= 30 ? 1 : minutesDiff <= 90 ? 0.6 : minutesDiff <= 360 ? 0.2 : 0;
  const sportScore = activity.sportType === candidate.sport ? 1 : 0;

  const durationDelta = candidate.targetDurationSec && candidate.targetDurationSec > 0
    ? Math.abs(activity.durationSec - candidate.targetDurationSec) / candidate.targetDurationSec
    : null;
  const distanceDelta = candidate.targetDistanceM && candidate.targetDistanceM > 0
    ? Math.abs(activity.distanceM - candidate.targetDistanceM) / candidate.targetDistanceM
    : null;

  const durationScore = durationDelta === null ? 0.5 : clamp(1 - durationDelta);
  const distanceScore = distanceDelta === null ? 0.5 : clamp(1 - distanceDelta);

  const confidence = clamp(timeScore * 0.4 + sportScore * 0.3 + durationScore * 0.2 + distanceScore * 0.1);

  return {
    candidateId: candidate.id,
    confidence,
    reason: {
      timeScore,
      sportScore,
      durationScore,
      distanceScore,
      minutesDiff
    }
  };
}

export function pickAutoMatch(scores: ScoredCandidate[]) {
  const sorted = [...scores].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];
  const second = sorted[1];
  if (!best) return null;
  if (best.confidence < 0.85) return null;
  if (second && best.confidence - second.confidence < 0.15) return null;
  return best;
}
