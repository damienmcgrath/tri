export type DiagnosisDataState = {
  isSparse: boolean;
  unlockText: string;
  guidanceText: string;
};

export function getDiagnosisDataState(completedDiagnosedSessions: number): DiagnosisDataState {
  if (completedDiagnosedSessions >= 2) {
    return {
      isSparse: false,
      unlockText: "Diagnosis depth unlocked.",
      guidanceText: "Diagnosis signals are stable enough to drive session-level adjustments."
    };
  }

  if (completedDiagnosedSessions === 1) {
    return {
      isSparse: true,
      unlockText: "One diagnosed session logged — one more will unlock stronger pattern coaching.",
      guidanceText: "Use schedule-first guidance today: protect key sessions, keep easy/recovery truly easy, and avoid stacking missed work."
    };
  }

  return {
    isSparse: true,
    unlockText: "Complete 1–2 sessions with uploaded activity data to unlock stronger diagnosis guidance.",
    guidanceText: "Use schedule-first guidance for now: follow planned order, protect key sessions, and keep recovery load controlled."
  };
}
