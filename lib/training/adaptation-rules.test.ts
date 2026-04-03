import {
  evaluateAdaptationTriggers,
  buildAdaptationOptions,
  type SessionSummary,
  type CheckInData,
  type AdaptationTrigger,
} from "./adaptation-rules";
import type { MacroContext } from "./macro-context";

// ---------------------------------------------------------------------------
// Factories
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
    detail: "1 key session missed this week.",
    affectedSessionIds: ["s1"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pin "today" globally so getTodayIso() inside the module returns 2026-04-03
// ---------------------------------------------------------------------------
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

  // 1. Returns empty when all sessions completed
  it("returns empty array when all past sessions are completed", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "completed" }),
      makeSession({ id: "s3", date: "2026-04-05", status: "planned" }), // future
    ];
    expect(evaluateAdaptationTriggers(sessions, null, ctx)).toEqual([]);
  });

  // 2. Detects missed key session (severity high)
  it("detects a skipped key session on or before today with severity high", () => {
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

  it("detects a missed key session with status 'missed' with severity high", () => {
    const sessions = [
      makeSession({ id: "key1", date: "2026-04-02", isKey: true, status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "missed_key_session");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
  });

  it("includes all missed key sessions in affectedSessionIds and uses plural label", () => {
    const sessions = [
      makeSession({ id: "k1", date: "2026-04-01", isKey: true, status: "missed" }),
      makeSession({ id: "k2", date: "2026-04-02", isKey: true, status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "missed_key_session");
    expect(t).toBeDefined();
    expect(t!.affectedSessionIds).toEqual(expect.arrayContaining(["k1", "k2"]));
    expect(t!.detail).toBe("2 key sessions missed this week.");
  });

  it("does not fire missed_key_session for a non-key skipped session", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", isKey: false, status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "missed_key_session")).toBeUndefined();
  });

  // 3. Does NOT trigger missed_key_session for future dates
  it("does NOT trigger missed_key_session for future dates", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-05", isKey: true, status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "missed_key_session")).toBeUndefined();
  });

  // 4. Detects 2 consecutive skips (severity medium)
  it("detects 2 consecutive skips with severity medium", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "consecutive_skips");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("medium");
    expect(t!.detail).toBe("2 consecutive sessions missed.");
  });

  // 5. Detects 3+ consecutive skips (severity high)
  it("detects 3 consecutive skips with severity high", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-03-31", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "missed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "consecutive_skips");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
    expect(t!.detail).toBe("3 consecutive sessions missed.");
  });

  it("does not fire consecutive_skips for only 1 skipped session", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "completed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "consecutive_skips")).toBeUndefined();
  });

  // 6. Consecutive skips resets on completed session in between
  it("resets the consecutive-skip counter on a completed session between two skips", () => {
    // Pattern: skip, complete, skip — max run is 1, no trigger
    const sessions = [
      makeSession({ id: "s1", date: "2026-03-31", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "consecutive_skips")).toBeUndefined();
  });

  it("reports the max run when reset occurs mid-week: skip-skip-complete-skip is medium (max=2)", () => {
    // s1+s2 form a run of 2, then s3 resets, then s4 is 1 → max=2 → medium
    const sessions = [
      makeSession({ id: "s1", date: "2026-03-31", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "missed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "completed" }),
      makeSession({ id: "s4", date: "2026-04-02", status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "consecutive_skips");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("medium");
    expect(t!.detail).toBe("2 consecutive sessions missed.");
  });

  // 7. High fatigue score 7-8 → medium severity
  it("fires high_fatigue with medium severity at fatigueScore 7", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ fatigueScore: 7 }), ctx);
    const t = triggers.find((t) => t.type === "high_fatigue");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("medium");
    expect(t!.detail).toBe("Check-in fatigue score: 7/10.");
  });

  it("fires high_fatigue with medium severity at fatigueScore 8", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ fatigueScore: 8 }), ctx);
    const t = triggers.find((t) => t.type === "high_fatigue");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("medium");
  });

  // 8. High fatigue score 9-10 → high severity
  it("fires high_fatigue with high severity at fatigueScore 9", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ fatigueScore: 9 }), ctx);
    const t = triggers.find((t) => t.type === "high_fatigue");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
  });

  it("fires high_fatigue with high severity at fatigueScore 10", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ fatigueScore: 10 }), ctx);
    const t = triggers.find((t) => t.type === "high_fatigue");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
  });

  // 9. Fatigue score 6 → no trigger
  it("does not fire high_fatigue at fatigueScore 6", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ fatigueScore: 6 }), ctx);
    expect(triggers.find((t) => t.type === "high_fatigue")).toBeUndefined();
  });

  it("does not fire high_fatigue when checkIn is null", () => {
    const triggers = evaluateAdaptationTriggers([], null, ctx);
    expect(triggers.find((t) => t.type === "high_fatigue")).toBeUndefined();
  });

  it("does not fire high_fatigue when fatigueScore is null", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ fatigueScore: null }), ctx);
    expect(triggers.find((t) => t.type === "high_fatigue")).toBeUndefined();
  });

  it("high_fatigue affectedSessionIds contains only planned sessions dated today or later", () => {
    const sessions = [
      makeSession({ id: "past", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "today-planned", date: "2026-04-03", status: "planned" }), // today
      makeSession({ id: "future-planned", date: "2026-04-05", status: "planned" }),
      makeSession({ id: "future-skipped", date: "2026-04-05", status: "skipped" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, makeCheckIn({ fatigueScore: 8 }), ctx);
    const t = triggers.find((t) => t.type === "high_fatigue");
    expect(t).toBeDefined();
    expect(t!.affectedSessionIds).toContain("today-planned");
    expect(t!.affectedSessionIds).toContain("future-planned");
    expect(t!.affectedSessionIds).not.toContain("past");
    expect(t!.affectedSessionIds).not.toContain("future-skipped");
  });

  // 10. Low motivation ≤3 → trigger with severity low
  it("fires low_motivation with severity low at motivationScore 3", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ motivationScore: 3 }), ctx);
    const t = triggers.find((t) => t.type === "low_motivation");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("low");
    expect(t!.detail).toBe("Check-in motivation score: 3/10.");
  });

  it("fires low_motivation at motivationScore 1", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ motivationScore: 1 }), ctx);
    expect(triggers.find((t) => t.type === "low_motivation")).toBeDefined();
  });

  // 11. Motivation 4 → no trigger
  it("does not fire low_motivation at motivationScore 4", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ motivationScore: 4 }), ctx);
    expect(triggers.find((t) => t.type === "low_motivation")).toBeUndefined();
  });

  it("does not fire low_motivation when motivationScore is null", () => {
    const triggers = evaluateAdaptationTriggers([], makeCheckIn({ motivationScore: null }), ctx);
    expect(triggers.find((t) => t.type === "low_motivation")).toBeUndefined();
  });

  // 12. Week undercomplete (<60%, ≥3 resolved sessions) → medium
  it("fires week_undercomplete with medium severity when completion is 40–59%", () => {
    // 5 resolved past sessions, 2 completed = 40% — exactly at boundary (<0.4 is false, <0.6 is true) → medium
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

  it("fires week_undercomplete with medium severity when completion is 50%", () => {
    // 4 resolved past sessions, 2 completed = 50%
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "skipped" }),
      makeSession({ id: "s4", date: "2026-04-02", status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "week_undercomplete");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("medium");
    expect(t!.detail).toBe("Only 50% of past sessions completed this week.");
  });

  // 13. Week undercomplete (<40%) → high
  it("fires week_undercomplete with high severity when completion is below 40%", () => {
    // 4 resolved past sessions, 1 completed = 25%
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "missed" }),
      makeSession({ id: "s4", date: "2026-04-02", status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "week_undercomplete");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
    expect(t!.detail).toBe("Only 25% of past sessions completed this week.");
  });

  it("fires week_undercomplete with high severity when completion is 0%", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "missed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    const t = triggers.find((t) => t.type === "week_undercomplete");
    expect(t).toBeDefined();
    expect(t!.severity).toBe("high");
    expect(t!.detail).toBe("Only 0% of past sessions completed this week.");
  });

  // 14. Week undercomplete with <3 resolved sessions → no trigger
  it("does not fire week_undercomplete when fewer than 3 past resolved sessions", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "week_undercomplete")).toBeUndefined();
  });

  it("does not fire week_undercomplete when completion is exactly 60%", () => {
    // 5 resolved past sessions, 3 completed = exactly 60% → condition is < 0.6, which is false
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "completed" }),
      makeSession({ id: "s4", date: "2026-04-02", status: "skipped" }),
      makeSession({ id: "s5", date: "2026-04-02", status: "missed" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "week_undercomplete")).toBeUndefined();
  });

  it("does not count future planned sessions as resolved for week_undercomplete", () => {
    // Only 2 past-resolved sessions (both skipped), rest are future
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s2", date: "2026-04-02", status: "missed" }),
      makeSession({ id: "s3", date: "2026-04-05", status: "planned" }),
      makeSession({ id: "s4", date: "2026-04-06", status: "planned" }),
      makeSession({ id: "s5", date: "2026-04-07", status: "planned" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    expect(triggers.find((t) => t.type === "week_undercomplete")).toBeUndefined();
  });

  // 15. Multiple triggers can fire simultaneously
  it("fires missed_key_session, consecutive_skips, high_fatigue and low_motivation together", () => {
    const sessions = [
      makeSession({ id: "key1", date: "2026-04-01", isKey: true, status: "missed" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "missed" }),
      makeSession({ id: "future", date: "2026-04-05", status: "planned" }),
    ];
    const checkIn = makeCheckIn({ fatigueScore: 9, motivationScore: 2 });
    const triggers = evaluateAdaptationTriggers(sessions, checkIn, ctx);
    const types = triggers.map((t) => t.type);
    expect(types).toContain("missed_key_session");
    expect(types).toContain("consecutive_skips");
    expect(types).toContain("high_fatigue");
    expect(types).toContain("low_motivation");
  });

  it("fires week_undercomplete and high_fatigue simultaneously", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-01", status: "completed" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "missed" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "skipped" }),
      makeSession({ id: "s4", date: "2026-04-02", status: "missed" }),
      makeSession({ id: "future", date: "2026-04-05", status: "planned" }),
    ];
    const triggers = evaluateAdaptationTriggers(sessions, makeCheckIn({ fatigueScore: 7 }), ctx);
    const types = triggers.map((t) => t.type);
    expect(types).toContain("week_undercomplete");
    expect(types).toContain("high_fatigue");
  });

  it("fires all five trigger types simultaneously when all conditions are met", () => {
    const sessions = [
      makeSession({ id: "key1", date: "2026-04-01", isKey: true, status: "missed" }),
      makeSession({ id: "s2", date: "2026-04-01", status: "skipped" }),
      makeSession({ id: "s3", date: "2026-04-02", status: "missed" }),
      makeSession({ id: "future", date: "2026-04-05", status: "planned" }),
    ];
    const checkIn = makeCheckIn({ fatigueScore: 9, motivationScore: 1 });
    const triggers = evaluateAdaptationTriggers(sessions, checkIn, ctx);
    const types = triggers.map((t) => t.type);
    expect(types).toContain("missed_key_session");
    expect(types).toContain("consecutive_skips");
    expect(types).toContain("high_fatigue");
    expect(types).toContain("low_motivation");
    expect(types).toContain("week_undercomplete");
  });

  // Edge: today's sessions are excluded from the "past" streak calculation
  it("excludes today's sessions from consecutive-skips past streak", () => {
    // today = 2026-04-03; only dates strictly < today feed the streak
    const sessions = [
      makeSession({ id: "s1", date: "2026-04-02", status: "skipped" }),   // past
      makeSession({ id: "s2", date: "2026-04-03", status: "skipped" }),   // today → excluded
    ];
    const triggers = evaluateAdaptationTriggers(sessions, null, ctx);
    // Only 1 past skip → no consecutive_skips trigger
    expect(triggers.find((t) => t.type === "consecutive_skips")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildAdaptationOptions
// ---------------------------------------------------------------------------

describe("buildAdaptationOptions", () => {
  const constraints = { daysRemaining: 4 };

  // 1. missed_key_session with optional sessions → drop_optional + keep_all
  it("returns drop_optional and keep_all options when optional sessions exist", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
      makeSession({ id: "opt2", date: "2026-04-07", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const ids = options.map((o) => o.id);
    expect(ids).toContain("drop_optional");
    expect(ids).toContain("keep_all");
    expect(options).toHaveLength(2);
  });

  it("drop_optional drops the last non-key session in the array", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
      makeSession({ id: "opt2", date: "2026-04-07", isKey: false }), // last optional
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const dropOpt = options.find((o) => o.id === "drop_optional")!;
    expect(dropOpt.changes).toHaveLength(1);
    expect(dropOpt.changes[0].sessionId).toBe("opt2");
    expect(dropOpt.changes[0].action).toBe("drop");
  });

  it("drop_optional keySessionImpact is protected", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options.find((o) => o.id === "drop_optional")!.keySessionImpact).toBe("protected");
  });

  it("keep_all has projectedCompletionPct of 100", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const keepAll = options.find((o) => o.id === "keep_all")!;
    expect(keepAll.projectedCompletionPct).toBe(100);
  });

  it("keep_all keySessionImpact is protected when key sessions remain", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options.find((o) => o.id === "keep_all")!.keySessionImpact).toBe("protected");
  });

  it("keep_all keySessionImpact is none when no key sessions remain", () => {
    const remaining = [
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
      makeSession({ id: "opt2", date: "2026-04-07", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options.find((o) => o.id === "keep_all")!.keySessionImpact).toBe("none");
  });

  it("keep_all changes array has keep action for every remaining session", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const keepAll = options.find((o) => o.id === "keep_all")!;
    expect(keepAll.changes).toHaveLength(2);
    expect(keepAll.changes.every((c) => c.action === "keep")).toBe(true);
  });

  // 2. missed_key_session with no optional sessions → only keep_all
  it("returns only keep_all when there are no optional sessions", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "key2", date: "2026-04-06", isKey: true }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("keep_all");
  });

  // 3. high_fatigue with non-key sessions → shorten_non_key + drop_all_optional
  it("returns shorten_non_key and drop_all_optional for high_fatigue with non-key sessions", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false, durationMinutes: 60 }),
      makeSession({ id: "opt2", date: "2026-04-07", isKey: false, durationMinutes: 45 }),
    ];
    const trigger = makeTrigger({ type: "high_fatigue", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const ids = options.map((o) => o.id);
    expect(ids).toContain("shorten_non_key");
    expect(ids).toContain("drop_all_optional");
  });

  it("shorten_non_key only shortens non-key sessions, not key sessions", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true, durationMinutes: 90 }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false, durationMinutes: 60 }),
    ];
    const trigger = makeTrigger({ type: "high_fatigue", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const shortenOpt = options.find((o) => o.id === "shorten_non_key")!;
    expect(shortenOpt.changes).toHaveLength(1);
    expect(shortenOpt.changes[0].sessionId).toBe("opt1");
    expect(shortenOpt.changes[0].action).toBe("shorten");
    expect(shortenOpt.changes[0].detail).toBe("Reduce from 60min by ~20%");
  });

  it("shorten_non_key has projectedCompletionPct of 90 and keySessionImpact protected", () => {
    const remaining = [
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false, durationMinutes: 45 }),
    ];
    const trigger = makeTrigger({ type: "high_fatigue", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const shortenOpt = options.find((o) => o.id === "shorten_non_key")!;
    expect(shortenOpt.projectedCompletionPct).toBe(90);
    expect(shortenOpt.keySessionImpact).toBe("protected");
  });

  it("drop_all_optional drops all non-key sessions with action 'drop'", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
      makeSession({ id: "opt2", date: "2026-04-07", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "high_fatigue", severity: "high" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const dropAllOpt = options.find((o) => o.id === "drop_all_optional")!;
    expect(dropAllOpt.changes).toHaveLength(2);
    expect(dropAllOpt.changes.every((c) => c.action === "drop")).toBe(true);
    expect(dropAllOpt.changes.map((c) => c.sessionId)).toEqual(
      expect.arrayContaining(["opt1", "opt2"])
    );
    expect(dropAllOpt.keySessionImpact).toBe("protected");
  });

  it("drop_all_optional projectedCompletionPct is keySessions / total * 100", () => {
    // 1 key + 3 optional = 4 total → 1/4 = 25%
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
      makeSession({ id: "opt2", date: "2026-04-06", isKey: false }),
      makeSession({ id: "opt3", date: "2026-04-07", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "high_fatigue", severity: "high" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const dropAllOpt = options.find((o) => o.id === "drop_all_optional")!;
    expect(dropAllOpt.projectedCompletionPct).toBe(25);
  });

  // 4. high_fatigue with only key sessions → no shorten or drop options
  it("returns no options when all remaining sessions are key for high_fatigue", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "key2", date: "2026-04-06", isKey: true }),
    ];
    const trigger = makeTrigger({ type: "high_fatigue", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options).toHaveLength(0);
  });

  // 5. consecutive_skips → key_sessions_only + continue_planned
  it("returns key_sessions_only and continue_planned for consecutive_skips", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "consecutive_skips", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const ids = options.map((o) => o.id);
    expect(ids).toContain("key_sessions_only");
    expect(ids).toContain("continue_planned");
  });

  it("key_sessions_only marks key sessions as keep and optional sessions as drop", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "consecutive_skips", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const keysOnly = options.find((o) => o.id === "key_sessions_only")!;
    const keepChange = keysOnly.changes.find((c) => c.sessionId === "key1");
    const dropChange = keysOnly.changes.find((c) => c.sessionId === "opt1");
    expect(keepChange?.action).toBe("keep");
    expect(dropChange?.action).toBe("drop");
  });

  it("key_sessions_only has projectedCompletionPct of 100 and keySessionImpact protected", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "consecutive_skips", severity: "high" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const keysOnly = options.find((o) => o.id === "key_sessions_only")!;
    expect(keysOnly.projectedCompletionPct).toBe(100);
    expect(keysOnly.keySessionImpact).toBe("protected");
  });

  it("omits key_sessions_only when no key sessions exist for consecutive_skips", () => {
    const remaining = [
      makeSession({ id: "opt1", date: "2026-04-05", isKey: false }),
      makeSession({ id: "opt2", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "consecutive_skips", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const ids = options.map((o) => o.id);
    expect(ids).not.toContain("key_sessions_only");
    expect(ids).toContain("continue_planned");
  });

  // 6. week_undercomplete → same as consecutive_skips
  it("returns key_sessions_only and continue_planned for week_undercomplete", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "week_undercomplete", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const ids = options.map((o) => o.id);
    expect(ids).toContain("key_sessions_only");
    expect(ids).toContain("continue_planned");
  });

  it("week_undercomplete continue_planned uses keep action for all sessions", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "week_undercomplete", severity: "medium" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    const cont = options.find((o) => o.id === "continue_planned")!;
    expect(cont.changes.every((c) => c.action === "keep")).toBe(true);
    expect(cont.projectedCompletionPct).toBe(100);
  });

  // 7. Unknown trigger type → continue_planned
  it("returns continue_planned for low_motivation trigger type (default branch)", () => {
    const remaining = [makeSession({ id: "s1", date: "2026-04-05", isKey: false })];
    const trigger = makeTrigger({ type: "low_motivation", severity: "low" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("continue_planned");
    expect(options[0].projectedCompletionPct).toBe(100);
    expect(options[0].changes.every((c) => c.action === "keep")).toBe(true);
  });

  it("continue_planned for default branch has keySessionImpact protected when key sessions remain", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "low_motivation", severity: "low" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options[0].keySessionImpact).toBe("protected");
  });

  it("continue_planned for default branch has keySessionImpact none when no key sessions remain", () => {
    const remaining = [makeSession({ id: "opt1", date: "2026-04-05", isKey: false })];
    const trigger = makeTrigger({ type: "low_motivation", severity: "low" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options[0].keySessionImpact).toBe("none");
  });

  // 8. projectedCompletionPct and keySessionImpact values are correct
  it("computes correct drop_optional projectedCompletionPct: (n-1)/n rounded", () => {
    // 3 remaining sessions → drop 1 → 2/3 ≈ 67%
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
      makeSession({ id: "opt2", date: "2026-04-07", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options.find((o) => o.id === "drop_optional")!.projectedCompletionPct).toBe(67);
  });

  it("computes correct drop_optional projectedCompletionPct for 2 sessions: 1/2 = 50%", () => {
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-06", isKey: false }),
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    expect(options.find((o) => o.id === "drop_optional")!.projectedCompletionPct).toBe(50);
  });

  // Safety filter: options with move actions that exceed 2 sessions/day are removed
  it("does not filter out options that use only keep/drop/shorten actions", () => {
    // None of the current code paths produce "move" actions, so safety filter passes through
    const remaining = [
      makeSession({ id: "key1", date: "2026-04-05", isKey: true }),
      makeSession({ id: "opt1", date: "2026-04-05", isKey: false }), // same day
    ];
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, remaining, constraints);
    // Both drop_optional and keep_all survive since neither uses "move"
    expect(options.find((o) => o.id === "drop_optional")).toBeDefined();
    expect(options.find((o) => o.id === "keep_all")).toBeDefined();
  });

  // Edge: empty remaining sessions
  it("handles empty remaining sessions gracefully for missed_key_session (keep_all only, no changes)", () => {
    const trigger = makeTrigger({ type: "missed_key_session" });
    const options = buildAdaptationOptions(trigger, [], constraints);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("keep_all");
    expect(options[0].changes).toHaveLength(0);
  });

  it("handles empty remaining sessions for high_fatigue (no options)", () => {
    const trigger = makeTrigger({ type: "high_fatigue", severity: "medium" });
    const options = buildAdaptationOptions(trigger, [], constraints);
    expect(options).toHaveLength(0);
  });

  it("handles empty remaining sessions for consecutive_skips (continue_planned only, no changes)", () => {
    const trigger = makeTrigger({ type: "consecutive_skips", severity: "high" });
    const options = buildAdaptationOptions(trigger, [], constraints);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("continue_planned");
    expect(options[0].changes).toHaveLength(0);
  });

  it("handles empty remaining sessions for week_undercomplete (continue_planned only, no changes)", () => {
    const trigger = makeTrigger({ type: "week_undercomplete", severity: "medium" });
    const options = buildAdaptationOptions(trigger, [], constraints);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("continue_planned");
    expect(options[0].changes).toHaveLength(0);
  });

  it("handles empty remaining sessions for default branch (continue_planned, no changes)", () => {
    const trigger = makeTrigger({ type: "low_motivation", severity: "low" });
    const options = buildAdaptationOptions(trigger, [], constraints);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("continue_planned");
    expect(options[0].changes).toHaveLength(0);
    expect(options[0].keySessionImpact).toBe("none");
  });
});
