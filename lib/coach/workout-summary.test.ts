import { completedSession, plannedSession } from '@/test/factories/workouts';
import { buildWorkoutSummary } from './workout-summary';

describe('buildWorkoutSummary', () => {
  test('given planned and completed workouts, then totals and completion are rounded to minutes', () => {
    const summary = buildWorkoutSummary(
      [plannedSession({ duration: 60 }), plannedSession({ sport: 'bike', duration: 90 })],
      [completedSession({ metrics: { duration_s: 3599 } }), completedSession({ sport: 'bike', metrics: { duration_s: 5401 } })]
    );

    expect(summary.plannedMinutes).toBe(150);
    expect(summary.completedMinutes).toBe(150);
    expect(summary.completionPct).toBe(100);
    expect(summary.dominantSport).toBe('bike');
  });

  test('given no planned workouts, then completion is 0 with explicit insight', () => {
    const summary = buildWorkoutSummary([], [completedSession()]);

    expect(summary.completionPct).toBe(0);
    expect(summary.insights[0]).toMatch(/No planned sessions/);
  });

  test('given low completion, then warning insight is returned', () => {
    const summary = buildWorkoutSummary([plannedSession({ duration: 180 })], [completedSession({ metrics: { duration_s: 1800 } })]);

    expect(summary.completionPct).toBe(17);
    expect(summary.insights[0]).toMatch(/below target/);
  });
});
