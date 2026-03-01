import { pickBestSuggestion, suggestSessionMatches } from './matching-service';

describe('matching service', () => {
  test('keeps matching non-blocking by returning suggestions without forcing confirmation', () => {
    const suggestions = suggestSessionMatches(
      {
        id: 'a1',
        userId: 'user-1',
        sportType: 'run',
        startTimeUtc: '2026-03-10T06:30:00.000Z',
        durationSec: 3600,
        distanceM: 10000
      },
      [
        {
          id: 's1',
          userId: 'user-1',
          date: '2026-03-10',
          sport: 'run',
          type: 'run',
          durationMinutes: 58,
          distanceM: 10000,
          startTimeUtc: '2026-03-10T06:00:00.000Z'
        }
      ]
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.matchMethod).toBe('tolerance_auto');
    expect(suggestions[0]?.confidence).toBeGreaterThan(0.8);
  });

  test('filters out candidates that fail athlete/date/type/duration tolerances', () => {
    const suggestions = suggestSessionMatches(
      {
        id: 'a1',
        userId: 'athlete-1',
        sportType: 'bike',
        startTimeUtc: '2026-03-10T06:30:00.000Z',
        durationSec: 5400
      },
      [
        {
          id: 'wrong-user',
          userId: 'athlete-2',
          date: '2026-03-10',
          sport: 'bike',
          type: 'bike',
          durationMinutes: 90
        },
        {
          id: 'wrong-sport',
          userId: 'athlete-1',
          date: '2026-03-10',
          sport: 'run',
          type: 'run',
          durationMinutes: 90
        },
        {
          id: 'wrong-duration',
          userId: 'athlete-1',
          date: '2026-03-10',
          sport: 'bike',
          type: 'bike',
          durationMinutes: 40
        }
      ]
    );

    expect(suggestions).toHaveLength(0);
  });

  test('selects only clear best suggestion', () => {
    const best = pickBestSuggestion([
      { plannedSessionId: 's1', confidence: 0.93, reason: {}, matchMethod: 'tolerance_auto' },
      { plannedSessionId: 's2', confidence: 0.65, reason: {}, matchMethod: 'tolerance_auto' }
    ]);

    expect(best?.plannedSessionId).toBe('s1');
  });
});
