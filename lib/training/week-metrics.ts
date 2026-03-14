import type { SessionLifecycleState, SessionStoredState } from "@/lib/training/semantics";

export type SessionStatus = SessionLifecycleState | SessionStoredState;

export type WeekMetricSession = {
  id: string;
  date: string;
  sport: string;
  durationMinutes: number;
  status: SessionStatus;
  isKey?: boolean;
};

export function computeWeekSessionCounts(sessions: WeekMetricSession[]) {
  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const skippedCount = sessions.filter((s) => s.status === "skipped").length;
  const plannedRemainingCount = sessions.filter((s) => s.status === "planned" || s.status === "today").length;
  const missedCount = sessions.filter((s) => s.status === "missed").length;
  const extraCount = sessions.filter((s) => s.status === "extra").length;
  const plannedTotalCount = completedCount + skippedCount + plannedRemainingCount + missedCount;

  return {
    completedCount,
    skippedCount,
    missedCount,
    extraCount,
    plannedRemainingCount,
    plannedTotalCount
  };
}

export function computeWeekMinuteTotals(sessions: WeekMetricSession[]) {
  const plannedMinutes = sessions
    .filter((session) => session.status !== "extra")
    .reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);
  const completedMinutes = sessions
    .filter((session) => session.status === "completed")
    .reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);
  const missedMinutes = sessions
    .filter((session) => session.status === "missed")
    .reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);
  const extraMinutes = sessions
    .filter((session) => session.status === "extra")
    .reduce((sum, session) => sum + Math.max(session.durationMinutes, 0), 0);

  const remainingMinutes = Math.max(plannedMinutes - completedMinutes, 0);

  return {
    plannedMinutes,
    completedMinutes,
    remainingMinutes,
    missedMinutes,
    extraMinutes
  };
}

export function getKeySessionsRemaining(sessions: WeekMetricSession[], todayIso?: string) {
  const floorDate = todayIso ?? new Date().toISOString().slice(0, 10);

  return sessions
    .filter((session) => session.isKey && (session.status === "planned" || session.status === "today") && session.date >= floorDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}
