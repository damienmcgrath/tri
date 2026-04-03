import {
  evaluateAdaptationTriggers,
  buildAdaptationOptions,
  type SessionSummary,
  type CheckInData,
  type AdaptationTrigger
} from "./adaptation-rules";
import type { MacroContext } from "./macro-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    date: "2026-04-01",
    sport: "run",
    type: "easy_run",
    status: "planned",
    isKey: false,
    durationMinutes: 60,
    isRestDay: false,
    ...overrides
  };
}

function makeMacroCtx(overrides: Partial<MacroContext> = {}): MacroContext {
  return {
    raceName: null,
    raceDate: null,
    daysToRace: null,
    currentBlock: "Build",
    blockWeek: 2,
    blockTotalWeeks: 4,
    totalPlanWeeks: 16,
    currentPlanWeek: 6,
    cumulativeVolumeByDiscipline: {
      swim: { plannedMinutes: 120, actualMinutes: 100, deltaPct: -17 },
      bike: { plannedMinutes: 300, actualMinutes: 300, deltaPct: 0 },
      run: { plannedMinutes: 240, actualMinutes: 220, deltaPct: -8 }
    },
    ...overrides
  };
}

/** Returns a date string that is `delta` days offset from today (ISO format). */
function daysFromToday(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

const TODAY = daysFromToday(0);
const YESTERDAY = daysFromToday(-1);
const TWO_DAYS_AGO = daysFromToday(-2);
const THREE_DAYS_AGO = daysFromToday(-3);
const TOMORROW = daysFromToday(1);

// ---------------------------------------------------------------------------
// evaluateAdaptationTriggers
// ---------------------------------------------------------------------------

describe("evaluateAdaptationTriggers — no triggers", () => {
  it("returns empty array when all sessions are completed and check-in is null", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: YESTERDAY, status: "completed" }),
      makeSession({ id: "s2", date: TWO_DAYS_AGO, status: "completed" })
    ];
    const result = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(result).toEqual([]);
  });

  it("returns empty array for empty sessions array and null check-in", () => {
    const result = evaluateAdaptationTriggers([], null, makeMacroCtx());
    expect(result).toEqual([]);
  });

  it("ignores future planned sessions for trigger evaluation", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: TOMORROW, status: "planned" })
    ];
    const result = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(result).toEqual([]);
  });
});

describe("evaluateAdaptationTriggers — missed_key_session trigger", () => {
  it("fires when one key session is skipped on a past date", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "k1", date: YESTERDAY, isKey: true, status: "skipped" }),
      makeSession({ id: "s1", date: YESTERDAY, isKey: false, status: "completed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "missed_key_session");
    expect(trigger).toBeDefined();
    expect(trigger!.severity).toBe("high");
    expect(trigger!.affectedSessionIds).toEqual(["k1"]);
  });

  it("fires when a key session has status 'missed'", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "k1", date: YESTERDAY, isKey: true, status: "missed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "missed_key_session")).toBeDefined();
  });

  it("includes all missed key sessions in affectedSessionIds", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "k1", date: YESTERDAY, isKey: true, status: "skipped" }),
      makeSession({ id: "k2", date: TWO_DAYS_AGO, isKey: true, status: "missed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "missed_key_session");
    expect(trigger!.affectedSessionIds).toHaveLength(2);
    expect(trigger!.affectedSessionIds).toContain("k1");
    expect(trigger!.affectedSessionIds).toContain("k2");
  });

  it("uses plural detail string when multiple key sessions are missed", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "k1", date: YESTERDAY, isKey: true, status: "skipped" }),
      makeSession({ id: "k2", date: TWO_DAYS_AGO, isKey: true, status: "missed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "missed_key_session");
    expect(trigger!.detail).toMatch(/2 key sessions/);
  });

  it("uses singular detail string when exactly one key session is missed", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "k1", date: YESTERDAY, isKey: true, status: "skipped" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "missed_key_session");
    expect(trigger!.detail).toMatch(/1 key session[^s]/);
  });

  it("does NOT fire for a future key session that is still planned", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "k1", date: TOMORROW, isKey: true, status: "planned" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "missed_key_session")).toBeUndefined();
  });

  it("does NOT fire when a key session on a past date is completed", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "k1", date: YESTERDAY, isKey: true, status: "completed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "missed_key_session")).toBeUndefined();
  });
});

describe("evaluateAdaptationTriggers — consecutive_skips trigger", () => {
  it("fires at medium severity when exactly 2 consecutive sessions are missed", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: TWO_DAYS_AGO, status: "skipped" }),
      makeSession({ id: "s2", date: YESTERDAY, status: "missed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "consecutive_skips");
    expect(trigger).toBeDefined();
    expect(trigger!.severity).toBe("medium");
  });

  it("fires at high severity when 3+ consecutive sessions are missed", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: THREE_DAYS_AGO, status: "skipped" }),
      makeSession({ id: "s2", date: TWO_DAYS_AGO, status: "missed" }),
      makeSession({ id: "s3", date: YESTERDAY, status: "skipped" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "consecutive_skips");
    expect(trigger).toBeDefined();
    expect(trigger!.severity).toBe("high");
  });

  it("does NOT fire when only 1 session is skipped", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: YESTERDAY, status: "skipped" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "consecutive_skips")).toBeUndefined();
  });

  it("does NOT fire when skips are non-consecutive (a completed session breaks the streak)", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: THREE_DAYS_AGO, status: "skipped" }),
      makeSession({ id: "s2", date: TWO_DAYS_AGO, status: "completed" }),
      makeSession({ id: "s3", date: YESTERDAY, status: "skipped" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "consecutive_skips")).toBeUndefined();
  });

  it("does NOT count today's sessions as past skips", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: TODAY, status: "skipped" }),
      makeSession({ id: "s2", date: TODAY, status: "skipped" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "consecutive_skips")).toBeUndefined();
  });
});

describe("evaluateAdaptationTriggers — high_fatigue trigger", () => {
  it("fires at medium severity when fatigueScore is 7", () => {
    const checkIn: CheckInData = { fatigueScore: 7, stressScore: 5, motivationScore: 6, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "high_fatigue");
    expect(trigger).toBeDefined();
    expect(trigger!.severity).toBe("medium");
  });

  it("fires at medium severity when fatigueScore is 8", () => {
    const checkIn: CheckInData = { fatigueScore: 8, stressScore: 5, motivationScore: 6, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "high_fatigue");
    expect(trigger!.severity).toBe("medium");
  });

  it("fires at high severity when fatigueScore is 9", () => {
    const checkIn: CheckInData = { fatigueScore: 9, stressScore: 5, motivationScore: 6, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "high_fatigue");
    expect(trigger!.severity).toBe("high");
  });

  it("fires at high severity when fatigueScore is 10", () => {
    const checkIn: CheckInData = { fatigueScore: 10, stressScore: 3, motivationScore: 2, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "high_fatigue");
    expect(trigger!.severity).toBe("high");
  });

  it("does NOT fire when fatigueScore is 6", () => {
    const checkIn: CheckInData = { fatigueScore: 6, stressScore: 5, motivationScore: 6, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    expect(triggers.find((t) => t.type === "high_fatigue")).toBeUndefined();
  });

  it("does NOT fire when fatigueScore is null", () => {
    const checkIn: CheckInData = { fatigueScore: null, stressScore: 5, motivationScore: 6, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    expect(triggers.find((t) => t.type === "high_fatigue")).toBeUndefined();
  });

  it("does NOT fire when check-in is null", () => {
    const triggers = evaluateAdaptationTriggers([], null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "high_fatigue")).toBeUndefined();
  });

  it("includes remaining planned sessions in affectedSessionIds", () => {
    const checkIn: CheckInData = { fatigueScore: 8, stressScore: 5, motivationScore: 6, weekNotes: null };
    const sessions: SessionSummary[] = [
      makeSession({ id: "future1", date: TOMORROW, status: "planned" }),
      makeSession({ id: "future2", date: TOMORROW, status: "planned" }),
      makeSession({ id: "past1", date: YESTERDAY, status: "completed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, checkIn, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "high_fatigue");
    expect(trigger!.affectedSessionIds).toContain("future1");
    expect(trigger!.affectedSessionIds).toContain("future2");
    expect(trigger!.affectedSessionIds).not.toContain("past1");
  });

  it("includes today's planned sessions in affectedSessionIds", () => {
    const checkIn: CheckInData = { fatigueScore: 8, stressScore: 5, motivationScore: 6, weekNotes: null };
    const sessions: SessionSummary[] = [
      makeSession({ id: "today1", date: TODAY, status: "planned" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, checkIn, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "high_fatigue");
    expect(trigger!.affectedSessionIds).toContain("today1");
  });
});

describe("evaluateAdaptationTriggers — low_motivation trigger", () => {
  it("fires at low severity when motivationScore is 3", () => {
    const checkIn: CheckInData = { fatigueScore: 5, stressScore: 5, motivationScore: 3, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "low_motivation");
    expect(trigger).toBeDefined();
    expect(trigger!.severity).toBe("low");
  });

  it("fires when motivationScore is 1", () => {
    const checkIn: CheckInData = { fatigueScore: 5, stressScore: 5, motivationScore: 1, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    expect(triggers.find((t) => t.type === "low_motivation")).toBeDefined();
  });

  it("does NOT fire when motivationScore is 4", () => {
    const checkIn: CheckInData = { fatigueScore: 5, stressScore: 5, motivationScore: 4, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    expect(triggers.find((t) => t.type === "low_motivation")).toBeUndefined();
  });

  it("does NOT fire when motivationScore is null", () => {
    const checkIn: CheckInData = { fatigueScore: 5, stressScore: 5, motivationScore: null, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    expect(triggers.find((t) => t.type === "low_motivation")).toBeUndefined();
  });

  it("detail string contains the motivation score", () => {
    const checkIn: CheckInData = { fatigueScore: 5, stressScore: 5, motivationScore: 2, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "low_motivation");
    expect(trigger!.detail).toContain("2/10");
  });
});

describe("evaluateAdaptationTriggers — week_undercomplete trigger", () => {
  it("fires at medium severity when completion is between 40% and 60% with 3+ past sessions", () => {
    // 2 completed out of 4 past sessions (50% < 60%)
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: THREE_DAYS_AGO, status: "completed" }),
      makeSession({ id: "s2", date: THREE_DAYS_AGO, status: "completed" }),
      makeSession({ id: "s3", date: TWO_DAYS_AGO, status: "skipped" }),
      makeSession({ id: "s4", date: YESTERDAY, status: "missed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "week_undercomplete");
    expect(trigger).toBeDefined();
    expect(trigger!.severity).toBe("medium");
  });

  it("fires at high severity when completion is below 40%", () => {
    // 1 completed out of 5 = 20%
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: THREE_DAYS_AGO, status: "completed" }),
      makeSession({ id: "s2", date: THREE_DAYS_AGO, status: "skipped" }),
      makeSession({ id: "s3", date: TWO_DAYS_AGO, status: "missed" }),
      makeSession({ id: "s4", date: TWO_DAYS_AGO, status: "skipped" }),
      makeSession({ id: "s5", date: YESTERDAY, status: "missed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "week_undercomplete");
    expect(trigger).toBeDefined();
    expect(trigger!.severity).toBe("high");
  });

  it("does NOT fire when only 2 past sessions (threshold requires 3+)", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: YESTERDAY, status: "skipped" }),
      makeSession({ id: "s2", date: TWO_DAYS_AGO, status: "missed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "week_undercomplete")).toBeUndefined();
  });

  it("does NOT fire when completion is at or above 60%", () => {
    // 3 completed out of 4 = 75%
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: THREE_DAYS_AGO, status: "completed" }),
      makeSession({ id: "s2", date: THREE_DAYS_AGO, status: "completed" }),
      makeSession({ id: "s3", date: TWO_DAYS_AGO, status: "completed" }),
      makeSession({ id: "s4", date: YESTERDAY, status: "skipped" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "week_undercomplete")).toBeUndefined();
  });

  it("does NOT count still-planned sessions toward past completion rate", () => {
    // 3 non-planned past sessions with low completion, plus future planned sessions
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: THREE_DAYS_AGO, status: "skipped" }),
      makeSession({ id: "s2", date: TWO_DAYS_AGO, status: "missed" }),
      makeSession({ id: "s3", date: YESTERDAY, status: "skipped" }),
      makeSession({ id: "s4", date: TOMORROW, status: "planned" }) // should not count
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "week_undercomplete");
    // 0/3 = 0% → high severity
    expect(trigger).toBeDefined();
    expect(trigger!.severity).toBe("high");
  });

  it("detail string contains the rounded completion percentage", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "s1", date: THREE_DAYS_AGO, status: "completed" }),
      makeSession({ id: "s2", date: TWO_DAYS_AGO, status: "skipped" }),
      makeSession({ id: "s3", date: YESTERDAY, status: "missed" }),
      makeSession({ id: "s4", date: YESTERDAY, status: "missed" }),
      makeSession({ id: "s5", date: THREE_DAYS_AGO, status: "skipped" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    const trigger = triggers.find((t) => t.type === "week_undercomplete");
    expect(trigger).toBeDefined();
    expect(trigger!.detail).toMatch(/\d+%/);
  });
});

describe("evaluateAdaptationTriggers — multiple triggers can fire simultaneously", () => {
  it("returns both high_fatigue and low_motivation triggers when both thresholds met", () => {
    const checkIn: CheckInData = { fatigueScore: 8, stressScore: 7, motivationScore: 2, weekNotes: null };
    const triggers = evaluateAdaptationTriggers([], checkIn, makeMacroCtx());
    expect(triggers.find((t) => t.type === "high_fatigue")).toBeDefined();
    expect(triggers.find((t) => t.type === "low_motivation")).toBeDefined();
  });

  it("returns missed_key_session and consecutive_skips when both conditions met", () => {
    const sessions: SessionSummary[] = [
      makeSession({ id: "k1", date: TWO_DAYS_AGO, isKey: true, status: "skipped" }),
      makeSession({ id: "s2", date: YESTERDAY, status: "missed" })
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, makeMacroCtx());
    expect(triggers.find((t) => t.type === "missed_key_session")).toBeDefined();
    expect(triggers.find((t) => t.type === "consecutive_skips")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// buildAdaptationOptions
// ---------------------------------------------------------------------------

const baseConstraints = { daysRemaining: 3 };

function makeTrigger(type: AdaptationTrigger["type"], severity: AdaptationTrigger["severity"] = "medium"): AdaptationTrigger {
  return {
    type,
    severity,
    label: "Test trigger",
    detail: "Test detail",
    affectedSessionIds: []
  };
}

describe("buildAdaptationOptions — missed_key_session", () => {
  it("returns 'drop_optional' and 'keep_all' options when optional sessions exist", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const ids = options.map((o) => o.id);
    expect(ids).toContain("drop_optional");
    expect(ids).toContain("keep_all");
  });

  it("drops the last optional session (lowest priority)", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned", type: "easy_run" }),
      makeSession({ id: "o2", isKey: false, status: "planned", type: "strength" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const dropOpt = options.find((o) => o.id === "drop_optional");
    expect(dropOpt!.changes[0].sessionId).toBe("o2");
    expect(dropOpt!.changes[0].action).toBe("drop");
  });

  it("returns only 'keep_all' when no optional sessions exist", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options.map((o) => o.id)).not.toContain("drop_optional");
    expect(options.map((o) => o.id)).toContain("keep_all");
  });

  it("'keep_all' option marks all remaining sessions as 'keep'", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const keepAll = options.find((o) => o.id === "keep_all");
    expect(keepAll!.changes.every((c) => c.action === "keep")).toBe(true);
    expect(keepAll!.projectedCompletionPct).toBe(100);
  });

  it("'keep_all' keySessionImpact is 'protected' when key sessions remain", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const keepAll = options.find((o) => o.id === "keep_all");
    expect(keepAll!.keySessionImpact).toBe("protected");
  });

  it("'keep_all' keySessionImpact is 'none' when no key sessions remain", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const keepAll = options.find((o) => o.id === "keep_all");
    expect(keepAll!.keySessionImpact).toBe("none");
  });

  it("'drop_optional' projectedCompletionPct reflects one fewer session", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" }),
      makeSession({ id: "o2", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const dropOpt = options.find((o) => o.id === "drop_optional");
    // 2/3 sessions remaining after dropping one → 66%
    expect(dropOpt!.projectedCompletionPct).toBe(Math.round((2 / 3) * 100));
  });
});

describe("buildAdaptationOptions — high_fatigue", () => {
  it("returns 'shorten_non_key' option when non-key sessions exist", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned", durationMinutes: 90 }),
      makeSession({ id: "o1", isKey: false, status: "planned", durationMinutes: 60 })
    ];
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options.find((o) => o.id === "shorten_non_key")).toBeDefined();
  });

  it("'shorten_non_key' only shortens non-key sessions", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned", durationMinutes: 90 }),
      makeSession({ id: "o1", isKey: false, status: "planned", durationMinutes: 60 })
    ];
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const shortenOpt = options.find((o) => o.id === "shorten_non_key");
    const shortenedIds = shortenOpt!.changes.map((c) => c.sessionId);
    expect(shortenedIds).toContain("o1");
    expect(shortenedIds).not.toContain("k1");
  });

  it("'shorten_non_key' detail includes duration info", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "o1", isKey: false, status: "planned", durationMinutes: 60 })
    ];
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const shortenOpt = options.find((o) => o.id === "shorten_non_key");
    expect(shortenOpt!.changes[0].detail).toContain("60");
  });

  it("handles null durationMinutes gracefully with '?'", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "o1", isKey: false, status: "planned", durationMinutes: null })
    ];
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const shortenOpt = options.find((o) => o.id === "shorten_non_key");
    expect(shortenOpt!.changes[0].detail).toContain("?");
  });

  it("returns 'drop_all_optional' option when optional sessions exist", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options.find((o) => o.id === "drop_all_optional")).toBeDefined();
  });

  it("'drop_all_optional' changes drop all non-key sessions", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" }),
      makeSession({ id: "o2", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const dropOpt = options.find((o) => o.id === "drop_all_optional");
    const droppedIds = dropOpt!.changes.filter((c) => c.action === "drop").map((c) => c.sessionId);
    expect(droppedIds).toContain("o1");
    expect(droppedIds).toContain("o2");
    expect(droppedIds).not.toContain("k1");
  });

  it("does NOT return 'shorten_non_key' when all remaining sessions are key sessions", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" })
    ];
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options.find((o) => o.id === "shorten_non_key")).toBeUndefined();
  });

  it("does NOT return 'drop_all_optional' when no optional sessions remain", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" })
    ];
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options.find((o) => o.id === "drop_all_optional")).toBeUndefined();
  });

  it("returns empty options when no remaining sessions", () => {
    const trigger = makeTrigger("high_fatigue");
    const options = buildAdaptationOptions(trigger, [], baseConstraints);
    expect(options).toHaveLength(0);
  });
});

describe("buildAdaptationOptions — consecutive_skips", () => {
  it("returns 'key_sessions_only' option when key sessions exist", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("consecutive_skips");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options.find((o) => o.id === "key_sessions_only")).toBeDefined();
  });

  it("'key_sessions_only' keeps key sessions and drops optional sessions", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("consecutive_skips");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const opt = options.find((o) => o.id === "key_sessions_only");
    const keepActions = opt!.changes.filter((c) => c.action === "keep").map((c) => c.sessionId);
    const dropActions = opt!.changes.filter((c) => c.action === "drop").map((c) => c.sessionId);
    expect(keepActions).toContain("k1");
    expect(dropActions).toContain("o1");
  });

  it("always returns 'continue_planned' option", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" })
    ];
    const trigger = makeTrigger("consecutive_skips");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options.find((o) => o.id === "continue_planned")).toBeDefined();
  });

  it("does NOT return 'key_sessions_only' when no key sessions remain", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("consecutive_skips");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options.find((o) => o.id === "key_sessions_only")).toBeUndefined();
  });

  it("'continue_planned' keySessionImpact is 'none' when no key sessions", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("consecutive_skips");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const opt = options.find((o) => o.id === "continue_planned");
    expect(opt!.keySessionImpact).toBe("none");
  });
});

describe("buildAdaptationOptions — week_undercomplete", () => {
  it("behaves same as consecutive_skips: returns key_sessions_only and continue_planned", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("week_undercomplete");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    const ids = options.map((o) => o.id);
    expect(ids).toContain("key_sessions_only");
    expect(ids).toContain("continue_planned");
  });
});

describe("buildAdaptationOptions — low_motivation (default case)", () => {
  it("returns only 'continue_planned' for low_motivation trigger", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "s1", status: "planned" })
    ];
    const trigger = makeTrigger("low_motivation");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("continue_planned");
    expect(options[0].projectedCompletionPct).toBe(100);
  });

  it("all changes in 'continue_planned' use action 'keep'", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "s1", status: "planned" }),
      makeSession({ id: "s2", status: "planned" })
    ];
    const trigger = makeTrigger("low_motivation");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    expect(options[0].changes.every((c) => c.action === "keep")).toBe(true);
  });

  it("returns empty options when no remaining sessions for default trigger", () => {
    const trigger = makeTrigger("low_motivation");
    const options = buildAdaptationOptions(trigger, [], baseConstraints);
    // continue_planned is still generated with empty changes
    expect(options).toHaveLength(1);
    expect(options[0].changes).toHaveLength(0);
  });
});

describe("buildAdaptationOptions — safety filter (no >2 sessions per day via move)", () => {
  it("allows options where no 'move' changes are present (the common case)", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);
    // Options with keep/drop actions are not filtered
    expect(options.length).toBeGreaterThan(0);
  });
});

describe("buildAdaptationOptions — returned option shape", () => {
  it("every option has required fields with correct types", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);

    for (const opt of options) {
      expect(typeof opt.id).toBe("string");
      expect(typeof opt.label).toBe("string");
      expect(typeof opt.description).toBe("string");
      expect(Array.isArray(opt.changes)).toBe(true);
      expect(typeof opt.projectedCompletionPct).toBe("number");
      expect(["none", "protected", "at_risk"]).toContain(opt.keySessionImpact);
    }
  });

  it("every change entry has sessionId, action, and detail", () => {
    const remaining: SessionSummary[] = [
      makeSession({ id: "k1", isKey: true, status: "planned" }),
      makeSession({ id: "o1", isKey: false, status: "planned" })
    ];
    const trigger = makeTrigger("missed_key_session");
    const options = buildAdaptationOptions(trigger, remaining, baseConstraints);

    for (const opt of options) {
      for (const change of opt.changes) {
        expect(typeof change.sessionId).toBe("string");
        expect(["keep", "drop", "move", "shorten"]).toContain(change.action);
        expect(typeof change.detail).toBe("string");
      }
    }
  });
});
