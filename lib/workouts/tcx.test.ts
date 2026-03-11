import { invalidTcx, simpleRunTcx } from '@/test/fixtures/tcx';
import { parseTcxFile } from './activity-parser';
import { parseTcxToSessions } from './tcx';

describe('TCX parsing and normalization', () => {
  test('given valid Garmin TCX, then parser normalizes core metrics and sport', () => {
    const sessions = parseTcxToSessions(simpleRunTcx);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      date: '2026-03-10',
      sport: 'run',
      metrics: {
        duration_s: 3660,
        distance_m: 10100,
        calories: 605,
        avg_hr: 152,
        max_hr: 173
      }
    });
  });

  test('given invalid activity list, then no normalized sessions are returned', () => {
    expect(parseTcxToSessions(invalidTcx)).toEqual([]);
  });

  test('given valid TCX, activity parser returns consistent rounded values', () => {
    const activity = parseTcxFile(simpleRunTcx);

    expect(activity.durationSec).toBe(3660);
    expect(activity.distanceM).toBe(10100);
    expect(activity.avgHr).toBe(152);
    expect(activity.sportType).toBe('run');
    expect(activity.parseSummary).toMatchObject({
      lapCount: 2,
      avgPaceSecPerKm: 362.38,
      avgPaceSecPer100m: 36.24
    });
  });

  test('given malformed TCX, then parsing throws', () => {
    expect(() => parseTcxFile(invalidTcx)).toThrow(/No activity found/);
  });
});
