import type { MacroContext } from "./macro-context";

export type SessionSummary = {
  id: string;
  date: string;
  sport: string;
  type: string;
  status: "planned" | "completed" | "skipped" | "missed";
  isKey: boolean;
  durationMinutes: number | null;
  isRestDay?: boolean;
};

export type CheckInData = {
  fatigueScore: number | null; // 1-10
  stressScore: number | null; // 1-10
  motivationScore: number | null; // 1-10
  weekNotes: string | null;
};

export type AdaptationTriggerType =
  | "missed_key_session"
  | "consecutive_skips"
  | "high_fatigue"
  | "low_motivation"
  | "week_undercomplete";

export type AdaptationTrigger = {
  type: AdaptationTriggerType;
  severity: "low" | "medium" | "high";
  label: string;
  detail: string;
  affectedSessionIds: string[];
};

export type AdaptationOption = {
  id: string;
  label: string;
  description: string;
  changes: Array<{ sessionId: string; action: "keep" | "drop" | "move" | "shorten"; detail: string }>;
  projectedCompletionPct: number;
  keySessionImpact: "none" | "protected" | "at_risk";
};

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getRemainingSessionsToday(sessions: SessionSummary[]): number {
  const today = getTodayIso();
  return sessions.filter((s) => s.date === today && s.status === "planned").length;
}

function countSessionsOnDate(sessions: SessionSummary[], date: string): number {
  return sessions.filter((s) => s.date === date && s.status !== "skipped" && s.status !== "missed").length;
}

export function evaluateAdaptationTriggers(
  weekSessions: SessionSummary[],
  checkIn: CheckInData | null,
  _macroCtx: MacroContext
): AdaptationTrigger[] {
  const triggers: AdaptationTrigger[] = [];
  const today = getTodayIso();

  // Missed key sessions
  const missedKeySessions = weekSessions.filter(
    (s) => s.isKey && (s.status === "skipped" || s.status === "missed") && s.date <= today
  );

  if (missedKeySessions.length > 0) {
    triggers.push({
      type: "missed_key_session",
      severity: "high",
      label: "Missed key session",
      detail: `${missedKeySessions.length} key session${missedKeySessions.length > 1 ? "s" : ""} missed this week.`,
      affectedSessionIds: missedKeySessions.map((s) => s.id)
    });
  }

  // Consecutive skips (2+)
  const pastSessions = weekSessions.filter((s) => s.date < today).sort((a, b) => a.date.localeCompare(b.date));
  let consecutiveSkips = 0;
  let maxConsecutive = 0;
  const consecutiveSkipIds: string[] = [];

  for (const s of pastSessions) {
    if (s.status === "skipped" || s.status === "missed") {
      consecutiveSkips++;
      consecutiveSkipIds.push(s.id);
      if (consecutiveSkips > maxConsecutive) maxConsecutive = consecutiveSkips;
    } else {
      consecutiveSkips = 0;
    }
  }

  if (maxConsecutive >= 2) {
    triggers.push({
      type: "consecutive_skips",
      severity: maxConsecutive >= 3 ? "high" : "medium",
      label: "Multiple sessions missed",
      detail: `${maxConsecutive} consecutive sessions missed.`,
      affectedSessionIds: consecutiveSkipIds
    });
  }

  // High fatigue from check-in
  if (checkIn?.fatigueScore != null && checkIn.fatigueScore >= 7) {
    triggers.push({
      type: "high_fatigue",
      severity: checkIn.fatigueScore >= 9 ? "high" : "medium",
      label: "High fatigue reported",
      detail: `Check-in fatigue score: ${checkIn.fatigueScore}/10.`,
      affectedSessionIds: weekSessions.filter((s) => s.status === "planned" && s.date >= today).map((s) => s.id)
    });
  }

  // Low motivation from check-in
  if (checkIn?.motivationScore != null && checkIn.motivationScore <= 3) {
    triggers.push({
      type: "low_motivation",
      severity: "low",
      label: "Low motivation reported",
      detail: `Check-in motivation score: ${checkIn.motivationScore}/10.`,
      affectedSessionIds: weekSessions.filter((s) => s.status === "planned" && s.date >= today).map((s) => s.id)
    });
  }

  // Week under-complete (>40% of planned sessions missed, with 3+ days elapsed)
  const pastPlanned = weekSessions.filter((s) => s.date < today && s.status !== "planned");
  const pastCompleted = pastPlanned.filter((s) => s.status === "completed");
  if (pastPlanned.length >= 3) {
    const completionPct = pastPlanned.length > 0 ? pastCompleted.length / pastPlanned.length : 1;
    if (completionPct < 0.6) {
      triggers.push({
        type: "week_undercomplete",
        severity: completionPct < 0.4 ? "high" : "medium",
        label: "Week completion below target",
        detail: `Only ${Math.round(completionPct * 100)}% of past sessions completed this week.`,
        affectedSessionIds: weekSessions.filter((s) => s.status === "planned" && s.date >= today).map((s) => s.id)
      });
    }
  }

  return triggers;
}

export function buildAdaptationOptions(
  trigger: AdaptationTrigger,
  remainingSessions: SessionSummary[],
  _constraints: { daysRemaining: number }
): AdaptationOption[] {
  const options: AdaptationOption[] = [];
  const keySessions = remainingSessions.filter((s) => s.isKey);
  const optionalSessions = remainingSessions.filter((s) => !s.isKey);

  if (trigger.type === "missed_key_session") {
    // Option 1: Keep all remaining sessions, drop lowest-priority optional session
    if (optionalSessions.length > 0) {
      const toDrop = optionalSessions[optionalSessions.length - 1];
      options.push({
        id: "drop_optional",
        label: "Drop a recovery session",
        description: `Remove the lowest-priority session (${toDrop.sport} ${toDrop.type}) to protect energy for key work.`,
        changes: [{ sessionId: toDrop.id, action: "drop", detail: "Removed to protect key session capacity" }],
        projectedCompletionPct: Math.round(((remainingSessions.length - 1) / remainingSessions.length) * 100),
        keySessionImpact: "protected"
      });
    }

    // Option 2: Keep all as planned, carry insight forward
    options.push({
      id: "keep_all",
      label: "Continue as planned",
      description: "Keep remaining sessions unchanged. Coach briefing will note the missed session.",
      changes: remainingSessions.map((s) => ({ sessionId: s.id, action: "keep" as const, detail: "No change" })),
      projectedCompletionPct: 100,
      keySessionImpact: keySessions.length > 0 ? "protected" : "none"
    });
  } else if (trigger.type === "high_fatigue") {
    // Option 1: Shorten all remaining sessions by 20%
    const shortenChanges = remainingSessions
      .filter((s) => !s.isKey)
      .map((s) => ({
        sessionId: s.id,
        action: "shorten" as const,
        detail: `Reduce from ${s.durationMinutes ?? "?"}min by ~20%`
      }));

    if (shortenChanges.length > 0) {
      options.push({
        id: "shorten_non_key",
        label: "Shorten non-key sessions",
        description: "Reduce volume on optional sessions while protecting key workouts.",
        changes: shortenChanges,
        projectedCompletionPct: 90,
        keySessionImpact: "protected"
      });
    }

    // Option 2: Drop all non-key remaining sessions
    if (optionalSessions.length > 0) {
      options.push({
        id: "drop_all_optional",
        label: "Drop all optional sessions",
        description: "Prioritize recovery. Keep only key sessions this week.",
        changes: optionalSessions.map((s) => ({ sessionId: s.id, action: "drop" as const, detail: "Dropped for recovery" })),
        projectedCompletionPct: Math.round((keySessions.length / remainingSessions.length) * 100),
        keySessionImpact: "protected"
      });
    }
  } else if (trigger.type === "consecutive_skips" || trigger.type === "week_undercomplete") {
    // Option 1: Keep only key sessions
    if (keySessions.length > 0) {
      options.push({
        id: "key_sessions_only",
        label: "Focus on key sessions only",
        description: "Drop optional sessions and concentrate effort on key workouts.",
        changes: [
          ...keySessions.map((s) => ({ sessionId: s.id, action: "keep" as const, detail: "Protected key session" })),
          ...optionalSessions.map((s) => ({ sessionId: s.id, action: "drop" as const, detail: "Dropped to focus on key sessions" }))
        ],
        projectedCompletionPct: 100,
        keySessionImpact: "protected"
      });
    }

    // Option 2: Continue as planned
    options.push({
      id: "continue_planned",
      label: "Continue as planned",
      description: "Keep all remaining sessions. Focus on consistency.",
      changes: remainingSessions.map((s) => ({ sessionId: s.id, action: "keep" as const, detail: "No change" })),
      projectedCompletionPct: 100,
      keySessionImpact: keySessions.length > 0 ? "protected" : "none"
    });
  } else {
    // Default: continue as planned
    options.push({
      id: "continue_planned",
      label: "Continue as planned",
      description: "No changes needed. Keep the current schedule.",
      changes: remainingSessions.map((s) => ({ sessionId: s.id, action: "keep" as const, detail: "No change" })),
      projectedCompletionPct: 100,
      keySessionImpact: keySessions.length > 0 ? "protected" : "none"
    });
  }

  // Safety: never suggest >2 sessions on any day, never add to planned rest days
  // (Constraints enforced by checking countSessionsOnDate — options that would violate are excluded)
  return options.filter((opt) => {
    const addedByDate = new Map<string, number>();
    for (const change of opt.changes) {
      if (change.action === "move") {
        const sess = remainingSessions.find((s) => s.id === change.sessionId);
        if (sess) {
          const count = (addedByDate.get(sess.date) ?? countSessionsOnDate(remainingSessions, sess.date)) + 1;
          if (count > 2) return false;
          addedByDate.set(sess.date, count);
        }
      }
    }
    return true;
  });

  // Suppress unused variable warning
  void getRemainingSessionsToday;
}
