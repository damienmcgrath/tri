import { pickAutoMatch, scoreCandidate } from "@/lib/workouts/activity-matching";

type ActivityForMatching = {
  id: string;
  userId: string;
  sportType: string;
  startTimeUtc: string;
  durationSec: number;
  distanceM?: number | null;
};

type PlannedSessionForMatching = {
  id: string;
  userId: string;
  date: string;
  sport: string;
  type: string;
  durationMinutes: number | null;
  distanceM?: number | null;
  startTimeUtc?: string | null;
};

type MatchSuggestion = {
  plannedSessionId: string;
  confidence: number;
  matchMethod: "tolerance_auto";
  reason: Record<string, number | string | boolean>;
};

const DEFAULT_TOLERANCES = {
  dateWindowHours: 18,
  durationDeltaPct: 0.35,
  minConfidence: 0.65
};

function toCandidateStartTime(session: PlannedSessionForMatching) {
  return session.startTimeUtc ?? `${session.date}T06:00:00.000Z`;
}

export function suggestSessionMatches(activity: ActivityForMatching, candidates: PlannedSessionForMatching[]): MatchSuggestion[] {
  const activityStartMs = Date.parse(activity.startTimeUtc);

  const eligible = candidates.filter((candidate) => {
    if (candidate.userId !== activity.userId) {
      return false;
    }

    if (candidate.sport !== activity.sportType) {
      return false;
    }

    const candidateStartMs = Date.parse(toCandidateStartTime(candidate));
    const hourDiff = Math.abs(activityStartMs - candidateStartMs) / 3_600_000;
    if (hourDiff > DEFAULT_TOLERANCES.dateWindowHours) {
      return false;
    }

    if (candidate.durationMinutes && candidate.durationMinutes > 0) {
      const plannedDurationSec = candidate.durationMinutes * 60;
      const durationDelta = Math.abs(activity.durationSec - plannedDurationSec) / plannedDurationSec;
      if (durationDelta > DEFAULT_TOLERANCES.durationDeltaPct) {
        return false;
      }
    }

    return true;
  });

  return eligible
    .map((candidate) => {
      const scored = scoreCandidate(
        {
          sportType: activity.sportType,
          startTimeUtc: activity.startTimeUtc,
          durationSec: activity.durationSec,
          distanceM: Number(activity.distanceM ?? 0)
        },
        {
          id: candidate.id,
          sport: candidate.sport,
          startTimeUtc: toCandidateStartTime(candidate),
          targetDurationSec: candidate.durationMinutes ? candidate.durationMinutes * 60 : null,
          targetDistanceM: Number(candidate.distanceM ?? 0) || null
        }
      );

      return {
        plannedSessionId: candidate.id,
        confidence: Number(scored.confidence.toFixed(2)),
        reason: {
          ...scored.reason,
          durationWithinTolerance: true,
          dateWithinTolerance: true,
          typeMatches: candidate.type === activity.sportType
        },
        matchMethod: "tolerance_auto" as const
      };
    })
    .filter((suggestion) => suggestion.confidence >= DEFAULT_TOLERANCES.minConfidence)
    .sort((a, b) => b.confidence - a.confidence);
}

export function pickBestSuggestion(suggestions: MatchSuggestion[]) {
  const selected = pickAutoMatch(
    suggestions.map((suggestion) => ({
      candidateId: suggestion.plannedSessionId,
      confidence: suggestion.confidence,
      reason: suggestion.reason
    }))
  );

  if (!selected) {
    return null;
  }

  return suggestions.find((item) => item.plannedSessionId === selected.candidateId) ?? null;
}
