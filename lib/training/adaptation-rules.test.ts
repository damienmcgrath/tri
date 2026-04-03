import {
  evaluateAdaptationTriggers,
  buildAdaptationOptions,
  type SessionSummary,
  type CheckInData,
  type AdaptationTrigger,
} from "./adaptation-rules";
import type { MacroContext } from "./macro-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides?: Partial<SessionSummary>): SessionSummary {
  return {
    id: "s1",
    date: "2026-04-01",
    sport: "run",
    type: "easy",
    status: "planned",
    isKey: false,
    durationMinutes: 45,
    ...overrides,
  };
}

function makeCheckIn(overrides?: Partial<CheckInData>): CheckInData {
  return {
    fatigueScore: null,
    stressScore: null,
    motivationScore: null,
    weekNotes: null,
    ...overrides,
  };
}

function makeMacroContext(): MacroContext {
  return {
    raceName: null,
    raceDate: null,
    daysToRace: null,
    currentBlock: "Build",
    blockWeek: 1,
    blockTotalWeeks: 3,
    totalPlanWeeks: 12,
    currentPlanWeek: 5,
    cumulativeVolumeByDiscipline: {
      swim: { plannedMinutes: 100, actualMinutes: 90, deltaPct: -10 },
      bike: { plannedMinutes: 200, actualMinutes: 180, deltaPct: -10 },
      run: { plannedMinutes: 150, actualMinutes: 140, deltaPct: -7 },
    },
  };
}

function makeTrigger(overrides?: Partial<AdaptationTrigger>): AdaptationTrigger {
  return {
    type: "missed_key_session",
    severity: "high",
    label: "Missed key session",
    detail: "1 key session missed.",
    affectedSessionIds: ["s1"],
    ...overrides,
  };
}

// Pin "today" so getTodayIso() inside the module returns a known date
beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-04-03T12:00:00Z"));
});
afterAll(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// evaluateAdaptationTriggers
// ---------------------------------------------------------------------------

describe("evaluateAdaptationTriggers", () => {
  const ctx = makeMacroContext();

  it("returns empty when all sessions completed", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "completed" }),
    ];
    expect(evaluateAdaptationTriggers(sessions, null, ctx)).toEqual([]);
  });

  it("detects missed key session with severity high", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", isKey: true, status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "completed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "missed_key_session");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
    expect(t!.affectedSessionIds).toContain("s1");
  });

  it("does NOT trigger missed_key_session for future dates", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-05", isKey: true, status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "missed_key_session")).toBeUndefined();
  });

  it("detects 2 consecutive skips with severity medium", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "consecutive_skips");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("medium");
  });

  it("detects 3+ consecutive skips with severity high", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-03-31", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "missed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "consecutive_skips");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
  });

  it("resets consecutive skips on a completed session in between", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-03-31", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "consecutive_skips")).toBeUndefined();
  });

  it("detects high fatigue 7-8 with medium severity", () => {
    const checkIn = makeCheckIn({ fatigueScore: 7 });
    const triggers = evaluateAdaptationTriggers([], checkIn, ctx);
    const t = triggers.find((t) => t.type === "high_fatigue");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("medium");
  });

  it("detects high fatigue 9+ with high severity", () => {
    const checkIn = makeCheckIn({ fatigueScore: 9 });
    const triggers = evaluateAdaptationTriggers([], checkIn, ctx);
    const t = triggers.find((t) => t.type === "high_fatigue");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
  });

  it("does not trigger fatigue at score 6", () => {
    const checkIn = makeCheckIn({ fatigueScore: 6 });
    const triggers = evaluateAdaptationTriggers([], checkIn, ctx);
    expect(triggers.find((t) => t.type === "high_fatigue")).toBeUndefined();
  });

  it("detects low motivation <= 3 with severity low", () => {
    const checkIn = makeCheckIn({ motivationScore: 3 });
    const triggers = evaluateAdaptationTriggers([], checkIn, ctx);
    const t = triggers.find((t) => t.type === "low_motivation");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("low");
  });

  it("does not trigger low motivation at score 4", () => {
    const checkIn = makeCheckIn({ motivationScore: 4 });
    const triggers = evaluateAdaptationTriggers([], checkIn, ctx);
    expect(triggers.find((t) => t.type === "low_motivation")).toBeUndefined();
  });

  it("detects week undercomplete < 60% with medium severity", () => {
    // 3 resolved past sessions, 1 completed = 33%
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "week_undercomplete");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high"); // 33% < 40% = high
  });

  it("detects week undercomplete 40-59% with medium severity", () => {
    // 5 resolved, 2 completed = 40% — boundary: exactly 40% is medium (not < 0.4)
    const sessions = [
      makeSession({ id: "s1", date: "2026-03-30", status: "completed" }),
      makeSession({ id: "s2", date: "2026-03-31", status: "completed" }),
      makeSession({ id: "s3", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s4", date: "2026-04-01", status: "missed" }),
      makeSession({ id: "s5", date: "2026-04-02", status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "week_undercomplete");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("medium");
  });

  it("does not trigger week_undercomplete with < 3 resolved sessions", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "week_undercomplete")).toBeUndefined();
  });

  it("can fire multiple triggers simultaneously", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", isKey: true, status: "missed" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "missed" }),
    ];
    const checkIn = makeCheckIn({ fatigueScore: 9, motivationScore: 2 });
    const triggers = evaluateAdaptationTriggers(sessions, checkIn, ctx);
    const types = triggers.map((t) => t.type);
    expect(types).toContain("missed_key_session");
    expect(types).toContain("consecutive_skips");
    expect(types).toContain("high_fatigue");
    expect(types).toContain("low_motivation");
    expect(types).toContain("week_undercomplete");
  });
});

// ---------------------------------------------------------------------------
// buildAdaptationOptions
// ---------------------------------------------------------------------------

describe("buildAdaptationOptions", () => {
  it("returns drop_optional + keep_all for missed_key_session with optional sessions", () => {
    const remaining = [
      makeSession({ id: "s1", isKey: true }),
      makeSession({ id: "s2", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, { daysRemaining: 4 });
    expect(options).toHaveLength(2);
    expect(options[0].id).toBe("drop_optional");
    expect(options[0].keySessionImpact).toBe("protected");
    expect(options[1].id).toBe("keep_all");
  });

  it("returns only keep_all for missed_key_session with no optional sessions", () => {
    const remaining = [
      makeSession({ id: "s1", isKey: true }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, { daysRemaining: 4 });
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("keep_all");
  });

  it("returns shorten + drop options for high_fatigue", () => {
    const remaining = [
      makeSession({ id: "s1", isKey: true }),
      makeSession({ id: "s2", isKey: false }),
      makeSession({ id: "s3", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "high_fatigue" });
    const options = buildAdaptationOptions(trigger, remaining, { daysRemaining: 4 });
    const ids = options.map((o) => o.id);
    expect(ids).toContain("shorten_non_key");
    expect(ids).toContain("drop_all_optional");
  });

  it("returns no shorten/drop options for high_fatigue with only key sessions", () => {
    const remaining = [
      makeSession({ id: "s1", isKey: true }),
    ];
    const trigger = makeTrigger({ type: "high_fatigue" });
    const options = buildAdaptationOptions(trigger, remaining, { daysRemaining: 4 });
    expect(options).toHaveLength(0);
  });

  it("returns key_sessions_only + continue_planned for consecutive_skips", () => {
    const remaining = [
      makeSession({ id: "s1", isKey: true }),
      makeSession({ id: "s2", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "consecutive_skips" });
    const options = buildAdaptationOptions(trigger, remaining, { daysRemaining: 4 });
    const ids = options.map((o) => o.id);
    expect(ids).toContain("key_sessions_only");
    expect(ids).toContain("continue_planned");
  });

  it("returns key_sessions_only + continue_planned for week_undercomplete", () => {
    const remaining = [
      makeSession({ id: "s1", isKey: true }),
      makeSession({ id: "s2", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "week_undercomplete" });
    const options = buildAdaptationOptions(trigger, remaining, { daysRemaining: 4 });
    const ids = options.map((o) => o.id);
    expect(ids).toContain("key_sessions_only");
    expect(ids).toContain("continue_planned");
  });

  it("returns continue_planned for unknown trigger type", () => {
    const remaining = [makeSession({ id: "s1" })];
    const trigger = makeTrigger({ type: "low_motivation" });
    const options = buildAdaptationOptions(trigger, remaining, { daysRemaining: 4 });
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("continue_planned");
  });

  it("computes correct projectedCompletionPct for drop_optional", () => {
    const remaining = [
      makeSession({ id: "s1", isKey: true }),
      makeSession({ id: "s2", isKey: false }),
      makeSession({ id: "s3", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, { daysRemaining: 4 });
    const dropOption = options.find((o) => o.id === "drop_optional");
    expect(dropOption!.projectedCompletionPct).toBe(67); // 2/3 rounded
  });
});
