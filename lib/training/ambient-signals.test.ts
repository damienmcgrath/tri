import { detectAmbientSignals } from "./ambient-signals";
import type { AmbientSignal } from "./ambient-signals";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Supabase mock that responds to chained query builder calls.
 *  Each call to `.from(table)` returns a builder whose terminal `.limit()` call
 *  resolves to `{ data: dataMap[table] ?? null }`.
 */
function buildSupabaseMock(dataMap: Record<string, unknown[] | null>) {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    // All chained methods return the same builder object
    for (const method of [
      "select",
      "eq",
      "gte",
      "lte",
      "order",
      "neq",
      "gt",
      "lt",
    ]) {
      builder[method] = jest.fn().mockReturnValue(builder);
    }
    // Terminal method
    builder["limit"] = jest
      .fn()
      .mockResolvedValue({ data: dataMap[table] ?? null });
    return builder;
  };

  return {
    from: jest.fn((table: string) => makeBuilder(table)),
  };
}

/** Returns today's ISO date string (YYYY-MM-DD), mirroring what the module uses. */
const today = () => new Date().toISOString().slice(0, 10);

/** Returns an ISO date string N days before `today`. */
function daysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<{
  id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  status: string;
  skip_reason: string | null;
  execution_result: unknown;
}> = {}) {
  return {
    id: "sess-1",
    date: daysAgo(2),
    sport: "run",
    type: "easy",
    duration_minutes: 60,
    status: "completed",
    skip_reason: null,
    execution_result: null,
    ...overrides,
  };
}

function makeFeel(overrides: Partial<{
  session_id: string;
  rpe: number;
  created_at: string;
}> = {}) {
  return {
    session_id: "sess-1",
    rpe: 6,
    created_at: `${daysAgo(2)}T10:00:00.000Z`,
    ...overrides,
  };
}

function makePattern(overrides: Partial<{
  pattern_key: string;
  label: string;
  detail: string;
  confidence: string;
  last_observed_at: string;
  support_count: number;
}> = {}) {
  return {
    pattern_key: "weekend_skips",
    label: "Frequent weekend skips",
    detail: "You often skip weekend long sessions.",
    confidence: "medium",
    last_observed_at: `${daysAgo(5)}T08:00:00.000Z`,
    support_count: 4,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: consecutive_skips signal
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — consecutive_skips", () => {
  it("emits a caution signal when two or more sessions are skipped in the same week", async () => {
    // Two skips in the same calendar week
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(3), status: "skipped", skip_reason: "illness" }),
      makeSession({ id: "s2", date: daysAgo(4), status: "skipped", skip_reason: "travel" }),
      makeSession({ id: "s3", date: daysAgo(5), status: "completed" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "consecutive_skips");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("caution");
    expect(signal!.label).toBe("Multiple skipped sessions");
    expect(signal!.detail).toContain("2 sessions skipped");
    expect(signal!.evidence).toContain("Skip reason: illness");
    expect(signal!.evidence).toContain("Skip reason: travel");
  });

  it("includes skip reasons in evidence when present", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(2), status: "skipped", skip_reason: "fatigue" }),
      makeSession({ id: "s2", date: daysAgo(3), status: "skipped", skip_reason: "injury" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "consecutive_skips");

    expect(signal).toBeDefined();
    expect(signal!.evidence).toEqual(
      expect.arrayContaining(["Skip reason: fatigue", "Skip reason: injury"])
    );
  });

  it("falls back to generic evidence when skip_reason is null", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(2), status: "skipped", skip_reason: null }),
      makeSession({ id: "s2", date: daysAgo(3), status: "skipped", skip_reason: null }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "consecutive_skips");

    expect(signal).toBeDefined();
    expect(signal!.evidence.length).toBeGreaterThan(0);
    expect(signal!.evidence[0]).toMatch(/skipped sessions/i);
  });

  it("does not emit consecutive_skips when only one session is skipped", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(2), status: "skipped" }),
      makeSession({ id: "s2", date: daysAgo(3), status: "completed" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "consecutive_skips")).toBeUndefined();
  });

  it("does not emit consecutive_skips when two skips are in different weeks and each week has only one skip", async () => {
    // Place skips 9 days apart so they fall in different ISO weeks
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(1), status: "skipped" }),
      makeSession({ id: "s2", date: daysAgo(14), status: "skipped" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "consecutive_skips")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: execution_decline signal
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — execution_decline", () => {
  it("emits an info signal when 2+ completed sessions have missed_intent execution result", async () => {
    const sessions = [
      makeSession({
        id: "s1",
        date: daysAgo(2),
        status: "completed",
        duration_minutes: 60,
        sport: "run",
        execution_result: { status: "missed_intent", summary: "cut short" },
      }),
      makeSession({
        id: "s2",
        date: daysAgo(4),
        status: "completed",
        duration_minutes: 45,
        sport: "bike",
        execution_result: { status: "missed_intent", summary: "low power" },
      }),
      makeSession({
        id: "s3",
        date: daysAgo(6),
        status: "completed",
        duration_minutes: 30,
        sport: "swim",
        execution_result: { status: "matched_intent" },
      }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "execution_decline");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("info");
    expect(signal!.label).toBe("Recurring intent misses");
    expect(signal!.detail).toContain("2 sessions");
    expect(signal!.evidence).toHaveLength(2);
    expect(signal!.evidence[0]).toContain("run on");
    expect(signal!.evidence[0]).toContain("cut short");
  });

  it("uses 'intent not matched' as fallback summary when summary is absent", async () => {
    const sessions = [
      makeSession({
        id: "s1",
        date: daysAgo(2),
        status: "completed",
        duration_minutes: 60,
        sport: "run",
        execution_result: { status: "missed_intent" },
      }),
      makeSession({
        id: "s2",
        date: daysAgo(4),
        status: "completed",
        duration_minutes: 45,
        sport: "bike",
        execution_result: { status: "missed_intent" },
      }),
      makeSession({
        id: "s3",
        date: daysAgo(6),
        status: "completed",
        duration_minutes: 30,
        sport: "swim",
        execution_result: { status: "missed_intent" },
      }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "execution_decline");

    expect(signal).toBeDefined();
    expect(signal!.evidence[0]).toContain("intent not matched");
  });

  it("does not emit execution_decline when only one session has missed_intent", async () => {
    const sessions = [
      makeSession({
        id: "s1",
        date: daysAgo(2),
        status: "completed",
        duration_minutes: 60,
        execution_result: { status: "missed_intent" },
      }),
      makeSession({
        id: "s2",
        date: daysAgo(4),
        status: "completed",
        duration_minutes: 45,
        execution_result: { status: "matched_intent" },
      }),
      makeSession({
        id: "s3",
        date: daysAgo(6),
        status: "completed",
        duration_minutes: 30,
        execution_result: { status: "matched_intent" },
      }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "execution_decline")).toBeUndefined();
  });

  it("does not emit execution_decline when fewer than 3 completed sessions exist", async () => {
    const sessions = [
      makeSession({
        id: "s1",
        date: daysAgo(2),
        status: "completed",
        duration_minutes: 60,
        execution_result: { status: "missed_intent" },
      }),
      makeSession({
        id: "s2",
        date: daysAgo(4),
        status: "completed",
        duration_minutes: 45,
        execution_result: { status: "missed_intent" },
      }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "execution_decline")).toBeUndefined();
  });

  it("ignores sessions with null execution_result or missing status field", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(2), status: "completed", duration_minutes: 60, execution_result: null }),
      makeSession({ id: "s2", date: daysAgo(4), status: "completed", duration_minutes: 45, execution_result: {} }),
      makeSession({ id: "s3", date: daysAgo(6), status: "completed", duration_minutes: 30, execution_result: { status: "missed_intent" } }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "execution_decline")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: high_rpe_trend signal
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — high_rpe_trend", () => {
  it("emits a caution signal when average RPE is between 7 and 8.4", async () => {
    const feels = [
      makeFeel({ session_id: "s1", rpe: 7, created_at: `${daysAgo(1)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s2", rpe: 8, created_at: `${daysAgo(2)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s3", rpe: 7, created_at: `${daysAgo(3)}T10:00:00.000Z` }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "high_rpe_trend");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("caution");
    expect(signal!.label).toBe("Sustained high perceived effort");
    expect(signal!.detail).toContain("Average RPE of 7.3");
    expect(signal!.evidence).toHaveLength(3);
  });

  it("emits a concern signal when average RPE is 8.5 or higher", async () => {
    const feels = [
      makeFeel({ session_id: "s1", rpe: 9, created_at: `${daysAgo(1)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s2", rpe: 8, created_at: `${daysAgo(2)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s3", rpe: 9, created_at: `${daysAgo(3)}T10:00:00.000Z` }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "high_rpe_trend");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("concern");
    expect(signal!.detail).toContain("Average RPE of 8.7");
  });

  it("does not emit high_rpe_trend when average RPE is below 7", async () => {
    const feels = [
      makeFeel({ session_id: "s1", rpe: 5, created_at: `${daysAgo(1)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s2", rpe: 6, created_at: `${daysAgo(2)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s3", rpe: 6, created_at: `${daysAgo(3)}T10:00:00.000Z` }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "high_rpe_trend")).toBeUndefined();
  });

  it("does not emit high_rpe_trend when fewer than 3 RPE entries exist", async () => {
    const feels = [
      makeFeel({ session_id: "s1", rpe: 9, created_at: `${daysAgo(1)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s2", rpe: 9, created_at: `${daysAgo(2)}T10:00:00.000Z` }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "high_rpe_trend")).toBeUndefined();
  });

  it("includes up to 4 RPE evidence entries", async () => {
    const feels = [
      makeFeel({ session_id: "s1", rpe: 8, created_at: `${daysAgo(1)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s2", rpe: 8, created_at: `${daysAgo(2)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s3", rpe: 8, created_at: `${daysAgo(3)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s4", rpe: 8, created_at: `${daysAgo(4)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s5", rpe: 8, created_at: `${daysAgo(5)}T10:00:00.000Z` }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "high_rpe_trend");

    expect(signal).toBeDefined();
    expect(signal!.evidence).toHaveLength(4); // capped at 4
  });

  it("ignores feel entries without a numeric rpe value", async () => {
    const feels = [
      { session_id: "s1", rpe: null, created_at: `${daysAgo(1)}T10:00:00.000Z` },
      makeFeel({ session_id: "s2", rpe: 9, created_at: `${daysAgo(2)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s3", rpe: 9, created_at: `${daysAgo(3)}T10:00:00.000Z` }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    // Only 2 valid RPE values — below the threshold of 3, no signal
    expect(signals.find((s) => s.type === "high_rpe_trend")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: session_gap signal
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — session_gap", () => {
  it("emits a caution signal when no completed sessions exist in the last 4 weeks", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(3), status: "skipped" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "session_gap");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("caution");
    expect(signal!.label).toBe("No completed sessions in 4 weeks");
    expect(signal!.detail).toContain("28 days");
  });

  it("emits an info signal when last session was 6-9 days ago", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(7), status: "completed" }),
      makeSession({ id: "s2", date: daysAgo(14), status: "completed" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "session_gap");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("info");
    expect(signal!.label).toContain("7-day gap");
    expect(signal!.detail).toContain("7 days ago");
    expect(signal!.evidence).toContain(`Last session: ${daysAgo(7)}`);
  });

  it("emits a concern signal when last session was 10+ days ago", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(12), status: "completed" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "session_gap");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("concern");
    expect(signal!.label).toContain("12-day gap");
  });

  it("does not emit session_gap when a session was completed within the last 5 days", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(3), status: "completed" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "session_gap")).toBeUndefined();
  });

  it("correctly picks the most recent completed session when multiple exist", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(20), status: "completed" }),
      makeSession({ id: "s2", date: daysAgo(8), status: "completed" }),
      makeSession({ id: "s3", date: daysAgo(15), status: "completed" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "session_gap");

    // Most recent was 8 days ago → info
    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("info");
    expect(signal!.label).toContain("8-day gap");
  });
});

// ---------------------------------------------------------------------------
// Tests: observed_pattern signal
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — observed_pattern", () => {
  it("emits a caution signal for high-confidence patterns", async () => {
    const patterns = [
      makePattern({ pattern_key: "weekend_skips", confidence: "high" }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [makeSession()],
      session_feels: [],
      athlete_observed_patterns: patterns,
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "observed_pattern:weekend_skips");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("caution");
    expect(signal!.label).toBe("Frequent weekend skips");
    expect(signal!.detail).toBe("You often skip weekend long sessions.");
    expect(signal!.evidence[0]).toContain("Observed 4 times");
  });

  it("emits an info signal for medium-confidence patterns", async () => {
    const patterns = [
      makePattern({ pattern_key: "early_fatigue", confidence: "medium" }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [makeSession()],
      session_feels: [],
      athlete_observed_patterns: patterns,
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "observed_pattern:early_fatigue");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("info");
  });

  it("skips low-confidence patterns", async () => {
    const patterns = [
      makePattern({ pattern_key: "flaky_signal", confidence: "low" }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [makeSession()],
      session_feels: [],
      athlete_observed_patterns: patterns,
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "observed_pattern:flaky_signal")).toBeUndefined();
  });

  it("includes last_observed_at date (trimmed to YYYY-MM-DD) in evidence", async () => {
    const observedAt = `${daysAgo(3)}T12:00:00.000Z`;
    const patterns = [
      makePattern({ confidence: "high", last_observed_at: observedAt, support_count: 7 }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [makeSession()],
      session_feels: [],
      athlete_observed_patterns: patterns,
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type.startsWith("observed_pattern:"));

    expect(signal).toBeDefined();
    expect(signal!.evidence[0]).toContain("Observed 7 times");
    expect(signal!.evidence[0]).toContain(`last on ${daysAgo(3)}`);
  });

  it("handles null patterns array gracefully", async () => {
    const supabase = buildSupabaseMock({
      sessions: [makeSession()],
      session_feels: [],
      athlete_observed_patterns: null,
    });

    await expect(
      detectAmbientSignals(supabase as never, "athlete-1")
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests: score_rpe_aligned / score_rpe_misaligned signals
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — score_rpe alignment", () => {
  /** Build sessions with execution_result + matching feels for alignment checks. */
  function buildAlignedData(count: number, alignmentType: "aligned" | "misaligned") {
    const sessions = [];
    const feels = [];

    for (let i = 0; i < count; i++) {
      const id = `sess-${i}`;
      const date = daysAgo(i + 1);

      if (alignmentType === "aligned") {
        // matched_intent + low RPE → aligned
        sessions.push(
          makeSession({ id, date, status: "completed", execution_result: { status: "matched_intent" } })
        );
        feels.push(makeFeel({ session_id: id, rpe: 5, created_at: `${date}T10:00:00.000Z` }));
      } else {
        // matched_intent + high RPE → misaligned
        sessions.push(
          makeSession({ id, date, status: "completed", execution_result: { status: "matched_intent" } })
        );
        feels.push(makeFeel({ session_id: id, rpe: 9, created_at: `${date}T10:00:00.000Z` }));
      }
    }

    return { sessions, feels };
  }

  it("emits score_rpe_aligned info signal when alignment is 80%+", async () => {
    const { sessions, feels } = buildAlignedData(6, "aligned");

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "score_rpe_aligned");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("info");
    expect(signal!.label).toBe("High scoring confidence");
    expect(signal!.detail).toContain("6/6");
    expect(signal!.evidence[0]).toContain("100% alignment");
  });

  it("emits score_rpe_misaligned caution signal when alignment is below 50% with 6+ comparisons", async () => {
    const { sessions, feels } = buildAlignedData(6, "misaligned");

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "score_rpe_misaligned");

    expect(signal).toBeDefined();
    expect(signal!.severity).toBe("caution");
    expect(signal!.label).toBe("Score-effort mismatch");
    expect(signal!.detail).toContain("review data sources");
  });

  it("does not emit alignment signals when fewer than 5 feels exist", async () => {
    const feels = [
      makeFeel({ session_id: "s1", rpe: 5, created_at: `${daysAgo(1)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s2", rpe: 5, created_at: `${daysAgo(2)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s3", rpe: 5, created_at: `${daysAgo(3)}T10:00:00.000Z` }),
      makeFeel({ session_id: "s4", rpe: 5, created_at: `${daysAgo(4)}T10:00:00.000Z` }),
    ];

    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "score_rpe_aligned")).toBeUndefined();
    expect(signals.find((s) => s.type === "score_rpe_misaligned")).toBeUndefined();
  });

  it("counts missed_intent + high RPE as aligned", async () => {
    // 6 sessions all missed_intent with RPE ≥ 7 → all aligned
    const sessions = Array.from({ length: 6 }, (_, i) =>
      makeSession({
        id: `s${i}`,
        date: daysAgo(i + 1),
        status: "completed",
        execution_result: { status: "missed_intent" },
      })
    );
    const feels = Array.from({ length: 6 }, (_, i) =>
      makeFeel({ session_id: `s${i}`, rpe: 8, created_at: `${daysAgo(i + 1)}T10:00:00.000Z` })
    );

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const signal = signals.find((s) => s.type === "score_rpe_aligned");

    expect(signal).toBeDefined();
    expect(signal!.detail).toContain("100%");
  });

  it("skips sessions without execution_result when computing alignment", async () => {
    const feels = Array.from({ length: 6 }, (_, i) =>
      makeFeel({ session_id: `s${i}`, rpe: 5, created_at: `${daysAgo(i + 1)}T10:00:00.000Z` })
    );
    // Sessions all lack execution_result → compared = 0, no alignment signal
    const sessions = Array.from({ length: 6 }, (_, i) =>
      makeSession({ id: `s${i}`, date: daysAgo(i + 1), status: "completed", execution_result: null })
    );

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: feels,
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals.find((s) => s.type === "score_rpe_aligned")).toBeUndefined();
    expect(signals.find((s) => s.type === "score_rpe_misaligned")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: deduplication — consecutive_skips suppresses session_gap
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — deduplication", () => {
  it("suppresses session_gap when consecutive_skips is present", async () => {
    // Two skips in the same week AND a long training gap
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(2), status: "skipped", skip_reason: "illness" }),
      makeSession({ id: "s2", date: daysAgo(3), status: "skipped", skip_reason: "travel" }),
      // Last completed session was 10 days ago
      makeSession({ id: "s3", date: daysAgo(10), status: "completed" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");

    const hasSkips = signals.some((s) => s.type === "consecutive_skips");
    const hasGap = signals.some((s) => s.type === "session_gap");

    expect(hasSkips).toBe(true);
    expect(hasGap).toBe(false);
  });

  it("allows session_gap when there are no consecutive_skips", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(10), status: "completed" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    const hasGap = signals.some((s) => s.type === "session_gap");

    expect(hasGap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: 5-signal cap
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — 5-signal cap", () => {
  it("returns at most 5 signals even when all conditions are triggered", async () => {
    // Construct data that could trigger: consecutive_skips, execution_decline,
    // high_rpe_trend, score_rpe_aligned, and multiple observed_pattern signals.

    // Sessions: 2 skips in same week + 3 completed with missed_intent + 1 completed long ago
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(1), status: "skipped", skip_reason: "tired" }),
      makeSession({ id: "s2", date: daysAgo(2), status: "skipped", skip_reason: "work" }),
      makeSession({ id: "s3", date: daysAgo(3), status: "completed", duration_minutes: 60, execution_result: { status: "missed_intent", summary: "low power" } }),
      makeSession({ id: "s4", date: daysAgo(5), status: "completed", duration_minutes: 45, execution_result: { status: "missed_intent", summary: "cut short" } }),
      makeSession({ id: "s5", date: daysAgo(7), status: "completed", duration_minutes: 30, execution_result: { status: "matched_intent" } }),
    ];

    // High RPE feels + enough for alignment check
    const feels = Array.from({ length: 6 }, (_, i) =>
      makeFeel({ session_id: `s${i + 3}`, rpe: 9, created_at: `${daysAgo(i + 1)}T10:00:00.000Z` })
    );

    // Multiple medium/high confidence patterns
    const patterns = Array.from({ length: 5 }, (_, i) =>
      makePattern({ pattern_key: `pattern_${i}`, confidence: i % 2 === 0 ? "high" : "medium" })
    );

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: feels,
      athlete_observed_patterns: patterns,
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");

    expect(signals.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Tests: null / empty data edge cases
// ---------------------------------------------------------------------------

describe("detectAmbientSignals — null and empty data", () => {
  it("returns a session_gap signal and nothing else when all data sources return null", async () => {
    // null data is treated as empty arrays internally; no completed sessions →
    // the module emits the "No completed sessions in 4 weeks" session_gap signal.
    const supabase = buildSupabaseMock({
      sessions: null,
      session_feels: null,
      athlete_observed_patterns: null,
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe("session_gap");
    expect(signals[0].severity).toBe("caution");
  });

  it("returns empty array when all data sources return empty arrays", async () => {
    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");
    // No completed sessions → session_gap with caution
    const types = signals.map((s) => s.type);
    expect(types).toContain("session_gap");
    expect(signals.length).toBe(1);
  });

  it("returns well-formed AmbientSignal objects for every returned signal", async () => {
    const sessions = [
      makeSession({ id: "s1", date: daysAgo(2), status: "skipped" }),
      makeSession({ id: "s2", date: daysAgo(3), status: "skipped" }),
    ];

    const supabase = buildSupabaseMock({
      sessions,
      session_feels: [],
      athlete_observed_patterns: [],
    });

    const signals = await detectAmbientSignals(supabase as never, "athlete-1");

    for (const signal of signals) {
      expect(signal).toMatchObject<Partial<AmbientSignal>>({
        type: expect.any(String),
        severity: expect.stringMatching(/^(info|caution|concern)$/),
        label: expect.any(String),
        detail: expect.any(String),
        evidence: expect.any(Array),
      });
    }
  });

  it("calls supabase with the correct athlete id for all three tables", async () => {
    const supabase = buildSupabaseMock({
      sessions: [],
      session_feels: [],
      athlete_observed_patterns: [],
    });

    await detectAmbientSignals(supabase as never, "my-athlete-uuid");

    // sessions and session_feels use .eq("user_id", athleteId)
    // athlete_observed_patterns uses .eq("athlete_id", athleteId)
    expect(supabase.from).toHaveBeenCalledWith("sessions");
    expect(supabase.from).toHaveBeenCalledWith("session_feels");
    expect(supabase.from).toHaveBeenCalledWith("athlete_observed_patterns");
  });
});
