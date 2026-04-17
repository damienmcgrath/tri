import type { SessionLifecycleState } from "@/lib/training/semantics";

export type SessionStatus = SessionLifecycleState;

export type WeekMetricSession = {
  id: string;
  date: string;
  sport: string;
  durationMinutes: number;
  status: SessionStatus;
  isKey?: boolean;
};

export type WeekExtraCompletion = {
  id: string;
  date: string;
  sport: string;
  durationMinutes: number;
};

export function computeWeekSessionCounts(sessions: WeekMetricSession[], extraCompletions: WeekExtraCompletion[] = []) {
  const completedCount = sessions.filter((s) => s.status === "completed").length + extraCompletions.length;
  const skippedCount = sessions.filter((s) => s.status === "skipped").length;
  const plannedRemainingCount = sessions.filter((s) => s.status === "planned").length;
  const plannedTotalCount = sessions.length;

  return {
    completedCount,
    skippedCount,
    plannedRemainingCount,
    plannedTotalCount
  };
}

export function computeWeekMinuteTotals(sessions: WeekMetricSession[], extraCompletions: WeekExtraCompletion[] = []) {
  const plannedMinutes = sessions.reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);
  const plannedCompletedMinutes = sessions
    .filter((session) => session.status === "completed")
    .reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);
  const extraCompletedMinutes = extraCompletions.reduce((sum, activity) => sum + Math.max(activity.durationMinutes, 0), 0);

  const totalCompletedMinutes = plannedCompletedMinutes + extraCompletedMinutes;
  const remainingMinutes = Math.max(plannedMinutes - plannedCompletedMinutes, 0);

  return {
    plannedMinutes,
    completedMinutes: totalCompletedMinutes,
    plannedCompletedMinutes,
    extraCompletedMinutes,
    remainingMinutes
  };
}

export function getKeySessionsRemaining(sessions: WeekMetricSession[], todayIso?: string) {
  const floorDate = todayIso ?? new Date().toISOString().slice(0, 10);

  return sessions
    .filter((session) => session.isKey && session.status === "planned" && session.date >= floorDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compute how the week's planned load is distributed across days up to and including today.
 *
 * Returns the expected-completion share based on the week's actual shape rather than a
 * linear `elapsedDays / 7` assumption. A back-loaded week with the long run on Saturday
 * and long bike on Sunday should NOT flag "at risk" on Friday for being 48% complete —
 * if only 48% of the week's minutes were scheduled Mon-Fri, 48% complete on Friday is
 * on-plan.
 */
export function computeWeekShape(args: {
  sessions: WeekMetricSession[];
  todayIso: string;
}): {
  /** Fraction of week's planned minutes scheduled on or before today (0..1). */
  expectedShareByToday: number;
  /** Fraction of week's planned minutes scheduled Saturday + Sunday (0..1). */
  weekendShare: number;
  /** True if ≥50% of remaining (post-today) planned minutes fall on Sat/Sun. */
  isWeekendLoaded: boolean;
} {
  const { sessions, todayIso } = args;

  let totalPlanned = 0;
  let plannedOnOrBeforeToday = 0;
  let plannedAfterToday = 0;
  let weekendMinutes = 0;
  let weekendMinutesRemaining = 0;

  for (const session of sessions) {
    const minutes = Math.max(session.durationMinutes, 0);
    if (minutes === 0) continue;
    totalPlanned += minutes;

    const isPast = session.date <= todayIso;
    if (isPast) plannedOnOrBeforeToday += minutes;
    else plannedAfterToday += minutes;

    const dow = new Date(Date.parse(`${session.date}T00:00:00.000Z`)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    if (isWeekend) {
      weekendMinutes += minutes;
      if (!isPast) weekendMinutesRemaining += minutes;
    }
  }

  if (totalPlanned <= 0) {
    return { expectedShareByToday: 0, weekendShare: 0, isWeekendLoaded: false };
  }

  return {
    expectedShareByToday: plannedOnOrBeforeToday / totalPlanned,
    weekendShare: weekendMinutes / totalPlanned,
    isWeekendLoaded: plannedAfterToday > 0 && weekendMinutesRemaining / plannedAfterToday >= 0.5
  };
}
