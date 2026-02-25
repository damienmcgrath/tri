import type { CompletedSessionLite, PlannedSessionLite, Sport } from '@/lib/coach/workout-summary';
import type { MatchInput, MatchingCandidate } from '@/lib/workouts/activity-matching';

export function plannedSession(input: Partial<PlannedSessionLite> = {}): PlannedSessionLite {
  return {
    sport: input.sport ?? 'run',
    duration: input.duration ?? 60
  };
}

export function completedSession(input: Partial<CompletedSessionLite> = {}): CompletedSessionLite {
  return {
    sport: (input.sport ?? 'run') as Sport,
    metrics: {
      duration_s: input.metrics?.duration_s ?? 3600,
      distance_m: input.metrics?.distance_m ?? 10000
    }
  };
}

export function activity(input: Partial<MatchInput> = {}): MatchInput {
  return {
    sportType: input.sportType ?? 'run',
    startTimeUtc: input.startTimeUtc ?? '2026-03-10T10:00:00.000Z',
    durationSec: input.durationSec ?? 3600,
    distanceM: input.distanceM ?? 10000
  };
}

export function candidate(input: Partial<MatchingCandidate> = {}): MatchingCandidate {
  return {
    id: input.id ?? 'candidate-1',
    sport: input.sport ?? 'run',
    startTimeUtc: input.startTimeUtc ?? '2026-03-10T10:05:00.000Z',
    targetDurationSec: input.targetDurationSec ?? 3600,
    targetDistanceM: input.targetDistanceM ?? 10000
  };
}
