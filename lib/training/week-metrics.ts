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
