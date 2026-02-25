import { activity, candidate } from '@/test/factories/workouts';
import { pickAutoMatch, scoreCandidate } from './activity-matching';

describe('activity matching', () => {
  test('given same sport and close start time, then candidate has high confidence', () => {
    const score = scoreCandidate(activity(), candidate());

    expect(score.candidateId).toBe('candidate-1');
    expect(score.confidence).toBeGreaterThan(0.85);
  });

  test('given far-apart start times, then confidence is reduced below auto-match threshold', () => {
    const score = scoreCandidate(
      activity({ startTimeUtc: '2026-03-10T06:00:00.000Z' }),
      candidate({ startTimeUtc: '2026-03-10T14:00:00.000Z' })
    );

    expect(score.reason.timeScore).toBe(0);
    expect(score.confidence).toBeLessThan(0.85);
  });

  test('given missing duration and distance targets, then neutral metric scores are used', () => {
    const score = scoreCandidate(activity(), { ...candidate(), targetDurationSec: null, targetDistanceM: null });

    expect(score.reason.durationScore).toBe(0.5);
    expect(score.reason.distanceScore).toBe(0.5);
  });

  test('given two close candidates, then auto-match is rejected as ambiguous', () => {
    const result = pickAutoMatch([
      { candidateId: 'a', confidence: 0.91, reason: {} },
      { candidateId: 'b', confidence: 0.8, reason: {} }
    ]);

    expect(result).toBeNull();
  });

  test('given clear winner, then auto-match picks best confidence deterministically', () => {
    const result = pickAutoMatch([
      { candidateId: 'a', confidence: 0.92, reason: {} },
      { candidateId: 'b', confidence: 0.6, reason: {} }
    ]);

    expect(result?.candidateId).toBe('a');
  });

  test('given no candidates, then auto-match returns null', () => {
    expect(pickAutoMatch([])).toBeNull();
  });
});
