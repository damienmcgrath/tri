/**
 * Tests for lib/athlete-context.ts
 *
 * Covers:
 * - getAthleteContextSnapshot: context assembly, missing data, edge cases
 * - saveAthleteContext: upsert mapping, validation errors
 * - saveWeeklyCheckin: upsert mapping, conflict key, validation errors
 * - getCurrentWeekStart: returns a Monday in ISO format
 */

import {
  getAthleteContextSnapshot,
  saveAthleteContext,
  saveWeeklyCheckin,
  getCurrentWeekStart,
  athleteContextInputSchema,
  athleteCheckinInputSchema
} from "./athlete-context";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

jest.mock("./training/fitness-model", () => ({
  getLatestFitness: jest.fn(),
  getTsbTrend: jest.fn(),
  getReadinessState: jest.fn()
}));

jest.mock("./training/benchmarks", () => ({
  deriveBenchmarks: jest.fn()
}));

import { getLatestFitness, getTsbTrend, getReadinessState } from "./training/fitness-model";
import { deriveBenchmarks } from "./training/benchmarks";

const mockGetLatestFitness = getLatestFitness as jest.MockedFunction<typeof getLatestFitness>;
const mockGetTsbTrend = getTsbTrend as jest.MockedFunction<typeof getTsbTrend>;
const mockGetReadinessState = getReadinessState as jest.MockedFunction<typeof getReadinessState>;
const mockDeriveBenchmarks = deriveBenchmarks as jest.MockedFunction<typeof deriveBenchmarks>;

// ---------------------------------------------------------------------------
// Supabase query builder factories
//
// athlete-context.ts uses two distinct terminal patterns:
//
//   "maybeSingle-terminal"  — chain ends with .limit(n).maybeSingle()
//     Used by: training_plans, athlete_ftp_history
//     In these builders, limit() must return `this` so maybeSingle() can follow.
//
//   "limit-terminal"        — chain ends with .limit(n)  (returns a Promise)
//     Used by: athlete_observed_patterns, sessions
//
//   "maybeSingle-only"      — chain ends with .maybeSingle()  (no limit in chain)
//     Used by: profiles, athlete_context, athlete_checkins
// ---------------------------------------------------------------------------

/** limit() returns this → terminal is .maybeSingle() */
function createMaybeSingleBuilder(resolvedValue: { data: unknown; error: null | { message: string } }) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ["select", "eq", "gte", "lte", "in", "order", "limit", "upsert", "insert", "single"]) {
    builder[method] = jest.fn().mockReturnThis();
  }
  builder.maybeSingle = jest.fn().mockResolvedValue(resolvedValue);
  return builder;
}

/** limit() is the terminal call — returns a Promise */
function createLimitTerminalBuilder(resolvedValue: { data: unknown; error: null | { message: string } }) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ["select", "eq", "gte", "lte", "in", "order", "upsert", "insert", "single"]) {
    builder[method] = jest.fn().mockReturnThis();
  }
  builder.limit = jest.fn().mockResolvedValue(resolvedValue);
  builder.maybeSingle = jest.fn().mockResolvedValue(resolvedValue);
  return builder;
}

// Alias for readability; same shape as maybeSingle builder (no limit in chain at all)
const createBuilder = createMaybeSingleBuilder;

// Minimal full-data profile row
const PROFILE_ROW = {
  id: "athlete-1",
  display_name: "Alice Runner",
  race_name: "Spring 70.3",
  race_date: "2026-06-07",
  active_plan_id: "plan-abc"
};

// Minimal context row
const CONTEXT_ROW = {
  athlete_id: "athlete-1",
  experience_level: "intermediate",
  goal_type: "perform",
  priority_event_name: "Summer Ironman",
  priority_event_date: "2026-08-15",
  limiters: ["pacing", "nutrition"],
  strongest_disciplines: ["bike"],
  weakest_disciplines: ["swim"],
  weekly_constraints: ["no morning weekdays"],
  injury_notes: "mild left knee",
  coaching_preference: "direct",
  updated_at: "2026-03-01T00:00:00.000Z"
};

// Minimal plan row
const PLAN_ROW = {
  id: "plan-abc",
  name: "16-week 70.3",
  start_date: "2026-01-01",
  duration_weeks: 16
};

// Minimal checkin row
const CHECKIN_ROW = {
  fatigue: 3,
  sleep_quality: 4,
  soreness: 2,
  stress: 1,
  confidence: 5,
  note: "Feeling good",
  updated_at: "2026-04-01T09:00:00.000Z"
};

// Minimal patterns rows
const PATTERN_ROWS = [
  {
    pattern_key: "consistent_swim",
    label: "Consistent swim pacing",
    detail: "Athlete maintains 1:35/100m across sets",
    confidence: "high",
    source_session_ids: ["session-1", "session-2"]
  }
];

// Minimal upcoming sessions rows
const SESSION_ROWS = [
  { session_name: "Long Run", type: "run" },
  { session_name: null, type: "bike" }
];

// Minimal FTP row
const FTP_ROW = {
  value: 280,
  source: "garmin_detected",
  recorded_at: "2026-03-15T00:00:00.000Z"
};

// ---------------------------------------------------------------------------
// Build a mock supabase that maps each table to a dedicated builder
// ---------------------------------------------------------------------------

function buildSupabase(overrides: Record<string, unknown> = {}) {
  const defaults = {
    // maybeSingle-only terminals (no .limit before .maybeSingle)
    profiles: createMaybeSingleBuilder({ data: PROFILE_ROW, error: null }),
    athlete_context: createMaybeSingleBuilder({ data: CONTEXT_ROW, error: null }),
    athlete_checkins: createMaybeSingleBuilder({ data: CHECKIN_ROW, error: null }),
    // limit → maybeSingle chain
    training_plans: createMaybeSingleBuilder({ data: PLAN_ROW, error: null }),
    athlete_ftp_history: createMaybeSingleBuilder({ data: FTP_ROW, error: null }),
    // limit-terminal (limit IS the terminal promise)
    athlete_observed_patterns: createLimitTerminalBuilder({ data: PATTERN_ROWS, error: null }),
    sessions: createLimitTerminalBuilder({ data: SESSION_ROWS, error: null })
  };

  const builders: Record<string, unknown> = { ...defaults, ...overrides };

  const supabase = {
    from: jest.fn((table: string) => {
      if (builders[table]) return builders[table];
      throw new Error(`Unexpected table queried: "${table}"`);
    })
  };

  return { supabase, builders };
}

// ---------------------------------------------------------------------------
// Default mock setup: fitness model returns data, benchmarks return empty
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  mockGetLatestFitness.mockResolvedValue({
    total: { ctl: 55, atl: 60, tsb: -5, rampRate: 1.2 },
    swim: { ctl: 20, atl: 22, tsb: -2, rampRate: null },
    bike: { ctl: 30, atl: 32, tsb: -2, rampRate: null },
    run: { ctl: 5, atl: 6, tsb: -1, rampRate: null },
    strength: { ctl: 0, atl: 0, tsb: 0, rampRate: null },
    other: { ctl: 0, atl: 0, tsb: 0, rampRate: null }
  } as never);

  mockGetTsbTrend.mockResolvedValue("stable" as never);
  mockGetReadinessState.mockReturnValue("absorbing" as never);
  mockDeriveBenchmarks.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// getAthleteContextSnapshot — happy path
// ---------------------------------------------------------------------------

describe("getAthleteContextSnapshot — happy path", () => {
  it("assembles identity from profile", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.identity).toEqual({
      athleteId: "athlete-1",
      displayName: "Alice Runner"
    });
  });

  it("prefers context table priority_event fields over profile race fields", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    // context has "Summer Ironman" / "2026-08-15" which should win over profile's "Spring 70.3" / "2026-06-07"
    expect(snapshot.goals.priorityEventName).toBe("Summer Ironman");
    expect(snapshot.goals.priorityEventDate).toBe("2026-08-15");
  });

  it("falls back to profile race fields when context table is null", async () => {
    const { supabase } = buildSupabase({
      athlete_context: createBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.goals.priorityEventName).toBe("Spring 70.3");
    expect(snapshot.goals.priorityEventDate).toBe("2026-06-07");
  });

  it("assembles declared from context row", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    const { declared } = snapshot;
    expect(declared.experienceLevel.value).toBe("intermediate");
    expect(declared.experienceLevel.source).toBe("athlete_declared");
    expect(declared.experienceLevel.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(declared.limiters).toEqual([
      { value: "pacing", source: "athlete_declared", updatedAt: "2026-03-01T00:00:00.000Z" },
      { value: "nutrition", source: "athlete_declared", updatedAt: "2026-03-01T00:00:00.000Z" }
    ]);
    expect(declared.strongestDisciplines).toEqual(["bike"]);
    expect(declared.weakestDisciplines).toEqual(["swim"]);
    expect(declared.weeklyConstraints).toEqual(["no morning weekdays"]);
    expect(declared.injuryNotes).toBe("mild left knee");
    expect(declared.coachingPreference).toBe("direct");
  });

  it("uses profile active_plan_id for derived.activePlanId when available", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.derived.activePlanId).toBe("plan-abc");
  });

  it("falls back to training_plans id when profile has no active_plan_id", async () => {
    const profileWithoutPlan = createBuilder({
      data: { ...PROFILE_ROW, active_plan_id: null },
      error: null
    });
    const { supabase } = buildSupabase({ profiles: profileWithoutPlan });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.derived.activePlanId).toBe("plan-abc");
  });

  it("maps upcoming sessions: uses session_name when present, type otherwise", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.derived.upcomingKeySessions).toEqual(["Long Run", "bike"]);
  });

  it("maps observed patterns from athlete_observed_patterns", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.observed.recurringPatterns).toHaveLength(1);
    expect(snapshot.observed.recurringPatterns[0]).toMatchObject({
      key: "consistent_swim",
      label: "Consistent swim pacing",
      confidence: "high",
      sourceSessionIds: ["session-1", "session-2"]
    });
  });

  it("maps weekly check-in state", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.weeklyState).toEqual({
      fatigue: 3,
      sleepQuality: 4,
      soreness: 2,
      stress: 1,
      confidence: 5,
      note: "Feeling good",
      updatedAt: "2026-04-01T09:00:00.000Z"
    });
  });

  it("maps latest FTP when present", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.ftp).toEqual({
      value: 280,
      source: "garmin_detected",
      recordedAt: "2026-03-15T00:00:00.000Z"
    });
  });

  it("returns fitness object when fitness model has data", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.fitness).not.toBeNull();
    expect(snapshot.fitness).toMatchObject({
      ctl: 55,
      atl: 60,
      tsb: -5,
      rampRate: 1.2,
      readiness: "absorbing"
    });
    // Non-zero disciplines should appear in perDiscipline
    expect(snapshot.fitness?.perDiscipline).toMatchObject({
      swim: { ctl: 20, atl: 22, tsb: -2 },
      bike: { ctl: 30, atl: 32, tsb: -2 },
      run: { ctl: 5, atl: 6, tsb: -1 }
    });
    // Zero-value disciplines should be omitted
    expect(snapshot.fitness?.perDiscipline).not.toHaveProperty("strength");
    expect(snapshot.fitness?.perDiscipline).not.toHaveProperty("other");
  });

  it("queries sessions with correct role filter", async () => {
    const { supabase, builders } = buildSupabase();
    await getAthleteContextSnapshot(supabase as never, "athlete-1");

    const sessionsBuilder = builders.sessions as Record<string, jest.Mock>;
    expect(sessionsBuilder.in).toHaveBeenCalledWith("session_role", ["key", "supporting"]);
  });

  it("queries athlete_ftp_history ordered by recorded_at desc", async () => {
    const { supabase, builders } = buildSupabase();
    await getAthleteContextSnapshot(supabase as never, "athlete-1");

    const ftpBuilder = builders.athlete_ftp_history as Record<string, jest.Mock>;
    expect(ftpBuilder.order).toHaveBeenCalledWith("recorded_at", { ascending: false });
  });
});

// ---------------------------------------------------------------------------
// getAthleteContextSnapshot — missing / null data handling
// ---------------------------------------------------------------------------

describe("getAthleteContextSnapshot — missing data", () => {
  it("handles null profile gracefully", async () => {
    const { supabase } = buildSupabase({
      profiles: createBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.identity.displayName).toBeNull();
    expect(snapshot.derived.activePlanId).toBe("plan-abc"); // falls back to training_plans
  });

  it("handles null athlete_context gracefully — all declared fields are empty/null", async () => {
    const { supabase } = buildSupabase({
      athlete_context: createBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.declared.experienceLevel.value).toBeNull();
    expect(snapshot.declared.experienceLevel.source).toBe("unknown");
    expect(snapshot.declared.limiters).toEqual([]);
    expect(snapshot.declared.strongestDisciplines).toEqual([]);
    expect(snapshot.declared.weakestDisciplines).toEqual([]);
    expect(snapshot.declared.weeklyConstraints).toEqual([]);
    expect(snapshot.declared.injuryNotes).toBeNull();
    expect(snapshot.declared.coachingPreference).toBeNull();
    expect(snapshot.goals.goalType).toBeNull();
  });

  it("handles null training plan — phase is null, activePlanId from profile", async () => {
    const { supabase } = buildSupabase({
      training_plans: createBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.derived.phase).toBeNull();
    expect(snapshot.derived.activePlanId).toBe("plan-abc"); // from profile
  });

  it("handles null checkin — weeklyState all null", async () => {
    const { supabase } = buildSupabase({
      athlete_checkins: createBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.weeklyState.fatigue).toBeNull();
    expect(snapshot.weeklyState.sleepQuality).toBeNull();
    expect(snapshot.weeklyState.soreness).toBeNull();
    expect(snapshot.weeklyState.stress).toBeNull();
    expect(snapshot.weeklyState.confidence).toBeNull();
    expect(snapshot.weeklyState.note).toBeNull();
    expect(snapshot.weeklyState.updatedAt).toBeNull();
  });

  it("handles null patterns — observed.recurringPatterns is empty array", async () => {
    const { supabase } = buildSupabase({
      athlete_observed_patterns: createLimitTerminalBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.observed.recurringPatterns).toEqual([]);
  });

  it("handles null sessions — upcomingKeySessions is empty array", async () => {
    const { supabase } = buildSupabase({
      sessions: createLimitTerminalBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.derived.upcomingKeySessions).toEqual([]);
  });

  it("handles null FTP — ftp is null", async () => {
    const { supabase } = buildSupabase({
      athlete_ftp_history: createBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.ftp).toBeNull();
  });

  it("handles null profile AND null context — daysToRace is null", async () => {
    const { supabase } = buildSupabase({
      profiles: createBuilder({ data: null, error: null }),
      athlete_context: createBuilder({ data: null, error: null })
    });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.goals.priorityEventDate).toBeNull();
    expect(snapshot.derived.daysToRace).toBeNull();
  });

  it("handles fitness model returning null — fitness is null", async () => {
    mockGetLatestFitness.mockResolvedValue(null as never);
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.fitness).toBeNull();
  });

  it("handles fitness model throwing — fitness is null (graceful catch)", async () => {
    mockGetLatestFitness.mockRejectedValue(new Error("DB connection failed"));
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.fitness).toBeNull();
  });

  it("handles benchmarks throwing — recentBests is empty array (graceful catch)", async () => {
    mockDeriveBenchmarks.mockRejectedValue(new Error("Benchmark query failed"));
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.recentBests).toEqual([]);
  });

  it("handles all null data everywhere without throwing", async () => {
    const { supabase } = buildSupabase({
      profiles: createMaybeSingleBuilder({ data: null, error: null }),
      athlete_context: createMaybeSingleBuilder({ data: null, error: null }),
      training_plans: createMaybeSingleBuilder({ data: null, error: null }),
      athlete_checkins: createMaybeSingleBuilder({ data: null, error: null }),
      athlete_observed_patterns: createLimitTerminalBuilder({ data: null, error: null }),
      sessions: createLimitTerminalBuilder({ data: null, error: null }),
      athlete_ftp_history: createMaybeSingleBuilder({ data: null, error: null })
    });
    mockGetLatestFitness.mockResolvedValue(null as never);
    mockDeriveBenchmarks.mockResolvedValue([]);

    await expect(getAthleteContextSnapshot(supabase as never, "athlete-1")).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getAthleteContextSnapshot — limiters with non-string array values
// ---------------------------------------------------------------------------

describe("getAthleteContextSnapshot — asStringArray edge cases", () => {
  it("filters out non-string entries in limiters array", async () => {
    const contextWithMixedLimiters = createBuilder({
      data: {
        ...CONTEXT_ROW,
        limiters: ["valid-limiter", null, 42, "", "  ", "another-limiter"]
      },
      error: null
    });
    const { supabase } = buildSupabase({ athlete_context: contextWithMixedLimiters });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    // asStringArray filters out non-strings, empty, and whitespace-only strings
    const limiterValues = snapshot.declared.limiters.map((l) => l.value);
    expect(limiterValues).toEqual(["valid-limiter", "another-limiter"]);
  });

  it("returns empty arrays when strongest/weakest disciplines are null rather than arrays", async () => {
    const contextWithNullArrays = createBuilder({
      data: {
        ...CONTEXT_ROW,
        strongest_disciplines: null,
        weakest_disciplines: null,
        weekly_constraints: null
      },
      error: null
    });
    const { supabase } = buildSupabase({ athlete_context: contextWithNullArrays });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.declared.strongestDisciplines).toEqual([]);
    expect(snapshot.declared.weakestDisciplines).toEqual([]);
    expect(snapshot.declared.weeklyConstraints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAthleteContextSnapshot — fitness perDiscipline filtering
// ---------------------------------------------------------------------------

describe("getAthleteContextSnapshot — fitness perDiscipline zero-filtering", () => {
  it("excludes a discipline from perDiscipline when both ctl and atl are 0", async () => {
    mockGetLatestFitness.mockResolvedValue({
      total: { ctl: 30, atl: 32, tsb: -2, rampRate: null },
      swim: { ctl: 0, atl: 0, tsb: 0, rampRate: null },
      bike: { ctl: 28, atl: 30, tsb: -2, rampRate: null },
      run: { ctl: 2, atl: 2, tsb: 0, rampRate: null },
      strength: { ctl: 0, atl: 0, tsb: 0, rampRate: null },
      other: { ctl: 0, atl: 0, tsb: 0, rampRate: null }
    } as never);

    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.fitness?.perDiscipline).not.toHaveProperty("swim");
    expect(snapshot.fitness?.perDiscipline).toHaveProperty("bike");
    expect(snapshot.fitness?.perDiscipline).toHaveProperty("run");
  });

  it("includes a discipline when ctl is 0 but atl is greater than 0", async () => {
    mockGetLatestFitness.mockResolvedValue({
      total: { ctl: 5, atl: 10, tsb: -5, rampRate: null },
      swim: { ctl: 0, atl: 5, tsb: -5, rampRate: null },
      bike: { ctl: 0, atl: 0, tsb: 0, rampRate: null },
      run: { ctl: 0, atl: 0, tsb: 0, rampRate: null },
      strength: { ctl: 0, atl: 0, tsb: 0, rampRate: null },
      other: { ctl: 0, atl: 0, tsb: 0, rampRate: null }
    } as never);

    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.fitness?.perDiscipline).toHaveProperty("swim");
    expect(snapshot.fitness?.perDiscipline.swim).toEqual({ ctl: 0, atl: 5, tsb: -5 });
  });
});

// ---------------------------------------------------------------------------
// getAthleteContextSnapshot — recentBests
// ---------------------------------------------------------------------------

describe("getAthleteContextSnapshot — recentBests", () => {
  it("maps up to 3 benchmark entries", async () => {
    mockDeriveBenchmarks.mockResolvedValue([
      { sport: "run", label: "Best 5k", formattedValue: "21:30", activityDate: "2026-03-15" },
      { sport: "bike", label: "Best 20min power", formattedValue: "280W", activityDate: "2026-03-10" },
      { sport: "swim", label: "Best 400m", formattedValue: "6:40", activityDate: "2026-03-08" },
      { sport: "run", label: "Best 10k", formattedValue: "45:00", activityDate: "2026-03-01" }
    ] as never);

    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.recentBests).toHaveLength(3);
    expect(snapshot.recentBests?.[0]).toEqual({
      sport: "run",
      label: "Best 5k",
      formattedValue: "21:30",
      date: "2026-03-15"
    });
    // Fourth entry must be omitted (slice(0, 3))
    expect(snapshot.recentBests?.map((b) => b.label)).not.toContain("Best 10k");
  });

  it("returns empty array when no benchmarks exist", async () => {
    mockDeriveBenchmarks.mockResolvedValue([]);
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.recentBests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAthleteContextSnapshot — derived phase inference
// ---------------------------------------------------------------------------

describe("getAthleteContextSnapshot — derived.phase inference", () => {
  // We freeze today for these tests using the plan row's start_date and duration_weeks.
  // inferPhase is deterministic given start_date, duration_weeks, and the runtime date.
  // Instead of mocking Date (complex), we verify the output shape is one of the known phases.

  const VALID_PHASES = new Set(["pre_plan", "base", "build", "peak", "taper", null]);

  it("always returns a valid phase value", async () => {
    const { supabase } = buildSupabase();
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(VALID_PHASES.has(snapshot.derived.phase)).toBe(true);
  });

  it("returns pre_plan when start_date is far in the future", async () => {
    const futurePlan = createBuilder({
      data: { ...PLAN_ROW, start_date: "2099-01-01", duration_weeks: 16 },
      error: null
    });
    const { supabase } = buildSupabase({ training_plans: futurePlan });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.derived.phase).toBe("pre_plan");
  });

  it("returns taper for a plan near its end", async () => {
    // A 16-week plan that started 15 weeks ago → week 15 of 16 → taper
    const fifteenWeeksAgo = new Date(Date.now() - 15 * 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    const nearEndPlan = createBuilder({
      data: { ...PLAN_ROW, start_date: fifteenWeeksAgo, duration_weeks: 16 },
      error: null
    });
    const { supabase } = buildSupabase({ training_plans: nearEndPlan });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.derived.phase).toBe("taper");
  });

  it("returns base for a plan in its first two weeks", async () => {
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    const earlyPlan = createBuilder({
      data: { ...PLAN_ROW, start_date: oneWeekAgo, duration_weeks: 16 },
      error: null
    });
    const { supabase } = buildSupabase({ training_plans: earlyPlan });
    const snapshot = await getAthleteContextSnapshot(supabase as never, "athlete-1");

    expect(snapshot.derived.phase).toBe("base");
  });
});

// ---------------------------------------------------------------------------
// saveAthleteContext
// ---------------------------------------------------------------------------

describe("saveAthleteContext", () => {
  function buildSaveSupabase(upsertResult: { data: null; error: null | { message: string } }) {
    const contextBuilder = {
      upsert: jest.fn().mockResolvedValue(upsertResult)
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "athlete_context") return contextBuilder;
        throw new Error(`Unexpected table: "${table}"`);
      })
    };
    return { supabase, contextBuilder };
  }

  it("upserts with correctly mapped columns", async () => {
    const { supabase, contextBuilder } = buildSaveSupabase({ data: null, error: null });

    await saveAthleteContext(supabase as never, "athlete-1", {
      experienceLevel: "advanced",
      goalType: "qualify",
      priorityEventName: "Kona",
      priorityEventDate: "2026-10-10",
      limiters: ["heat", "hills"],
      strongestDisciplines: ["swim"],
      weakestDisciplines: ["run"],
      weeklyConstraints: ["no Tuesdays"],
      injuryNotes: "IT band",
      coachingPreference: "supportive"
    });

    expect(contextBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        athlete_id: "athlete-1",
        experience_level: "advanced",
        goal_type: "qualify",
        priority_event_name: "Kona",
        priority_event_date: "2026-10-10",
        limiters: ["heat", "hills"],
        strongest_disciplines: ["swim"],
        weakest_disciplines: ["run"],
        weekly_constraints: ["no Tuesdays"],
        injury_notes: "IT band",
        coaching_preference: "supportive"
      })
    );
  });

  it("maps nullish optional fields to null in upsert payload", async () => {
    const { supabase, contextBuilder } = buildSaveSupabase({ data: null, error: null });

    await saveAthleteContext(supabase as never, "athlete-1", {
      limiters: [],
      strongestDisciplines: [],
      weakestDisciplines: [],
      weeklyConstraints: []
    });

    expect(contextBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        experience_level: null,
        goal_type: null,
        priority_event_name: null,
        priority_event_date: null,
        injury_notes: null,
        coaching_preference: null
      })
    );
  });

  it("throws when supabase returns an error", async () => {
    const { supabase } = buildSaveSupabase({
      data: null,
      error: { message: "unique constraint violation" }
    });

    await expect(
      saveAthleteContext(supabase as never, "athlete-1", {
        limiters: [],
        strongestDisciplines: [],
        weakestDisciplines: [],
        weeklyConstraints: []
      })
    ).rejects.toThrow("unique constraint violation");
  });

  it("throws ZodError when input fails validation", async () => {
    const { supabase } = buildSaveSupabase({ data: null, error: null });

    // limiters exceeds max of 8
    await expect(
      saveAthleteContext(supabase as never, "athlete-1", {
        limiters: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        strongestDisciplines: [],
        weakestDisciplines: [],
        weeklyConstraints: []
      } as never)
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// saveWeeklyCheckin
// ---------------------------------------------------------------------------

describe("saveWeeklyCheckin", () => {
  function buildCheckinSupabase(upsertResult: { data: null; error: null | { message: string } }) {
    const checkinBuilder = {
      upsert: jest.fn().mockResolvedValue(upsertResult)
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "athlete_checkins") return checkinBuilder;
        throw new Error(`Unexpected table: "${table}"`);
      })
    };
    return { supabase, checkinBuilder };
  }

  it("upserts with correctly mapped columns and conflict key", async () => {
    const { supabase, checkinBuilder } = buildCheckinSupabase({ data: null, error: null });

    await saveWeeklyCheckin(supabase as never, "athlete-1", {
      weekStart: "2026-04-07",
      fatigue: 2,
      sleepQuality: 4,
      soreness: 1,
      stress: 3,
      confidence: 5,
      note: "Feeling strong"
    });

    expect(checkinBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        athlete_id: "athlete-1",
        week_start: "2026-04-07",
        fatigue: 2,
        sleep_quality: 4,
        soreness: 1,
        stress: 3,
        confidence: 5,
        note: "Feeling strong"
      }),
      { onConflict: "athlete_id,week_start" }
    );
  });

  it("maps null optional fields to null in upsert payload", async () => {
    const { supabase, checkinBuilder } = buildCheckinSupabase({ data: null, error: null });

    await saveWeeklyCheckin(supabase as never, "athlete-1", {
      weekStart: "2026-04-07"
    });

    expect(checkinBuilder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fatigue: null,
        sleep_quality: null,
        soreness: null,
        stress: null,
        confidence: null,
        note: null
      }),
      expect.any(Object)
    );
  });

  it("throws when supabase returns an error", async () => {
    const { supabase } = buildCheckinSupabase({
      data: null,
      error: { message: "RLS policy violation" }
    });

    await expect(
      saveWeeklyCheckin(supabase as never, "athlete-1", {
        weekStart: "2026-04-07"
      })
    ).rejects.toThrow("RLS policy violation");
  });

  it("throws ZodError for invalid weekStart date format", async () => {
    const { supabase } = buildCheckinSupabase({ data: null, error: null });

    await expect(
      saveWeeklyCheckin(supabase as never, "athlete-1", {
        weekStart: "not-a-date"
      } as never)
    ).rejects.toThrow();
  });

  it("throws ZodError for out-of-range fatigue value", async () => {
    const { supabase } = buildCheckinSupabase({ data: null, error: null });

    await expect(
      saveWeeklyCheckin(supabase as never, "athlete-1", {
        weekStart: "2026-04-07",
        fatigue: 6
      } as never)
    ).rejects.toThrow();
  });

  it("throws ZodError for fatigue of 0 (below min of 1)", async () => {
    const { supabase } = buildCheckinSupabase({ data: null, error: null });

    await expect(
      saveWeeklyCheckin(supabase as never, "athlete-1", {
        weekStart: "2026-04-07",
        fatigue: 0
      } as never)
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getCurrentWeekStart
// ---------------------------------------------------------------------------

describe("getCurrentWeekStart", () => {
  it("returns a string in ISO date format (YYYY-MM-DD)", () => {
    const result = getCurrentWeekStart();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns a Monday (day index 1 in UTC)", () => {
    const result = getCurrentWeekStart();
    const date = new Date(`${result}T00:00:00.000Z`);
    expect(date.getUTCDay()).toBe(1); // 1 = Monday
  });

  it("returns a date not more than 6 days before today", () => {
    const today = new Date();
    const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const weekStart = new Date(`${getCurrentWeekStart()}T00:00:00.000Z`).getTime();
    const diffDays = (todayMs - weekStart) / 86400000;

    expect(diffDays).toBeGreaterThanOrEqual(0);
    expect(diffDays).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Zod schema validation (exported schemas)
// ---------------------------------------------------------------------------

describe("athleteContextInputSchema", () => {
  it("accepts a fully populated input", () => {
    const result = athleteContextInputSchema.safeParse({
      experienceLevel: "beginner",
      goalType: "finish",
      priorityEventName: "Local Sprint",
      priorityEventDate: "2026-09-01",
      limiters: ["swim anxiety"],
      strongestDisciplines: ["run"],
      weakestDisciplines: ["swim"],
      weeklyConstraints: ["no mornings"],
      injuryNotes: "none",
      coachingPreference: "balanced"
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal input with only required-by-default array fields", () => {
    const result = athleteContextInputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limiters).toEqual([]);
    }
  });

  it("rejects invalid experienceLevel value", () => {
    const result = athleteContextInputSchema.safeParse({ experienceLevel: "expert" });
    expect(result.success).toBe(false);
  });

  it("rejects limiters array exceeding max 8 items", () => {
    const result = athleteContextInputSchema.safeParse({
      limiters: ["a", "b", "c", "d", "e", "f", "g", "h", "i"]
    });
    expect(result.success).toBe(false);
  });

  it("rejects priorityEventDate in non-date format", () => {
    const result = athleteContextInputSchema.safeParse({ priorityEventDate: "tomorrow" });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from priorityEventName", () => {
    const result = athleteContextInputSchema.safeParse({
      priorityEventName: "  Ironman  "
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priorityEventName).toBe("Ironman");
    }
  });
});

describe("athleteCheckinInputSchema", () => {
  it("accepts a fully populated check-in", () => {
    const result = athleteCheckinInputSchema.safeParse({
      weekStart: "2026-04-07",
      fatigue: 3,
      sleepQuality: 4,
      soreness: 2,
      stress: 1,
      confidence: 5,
      note: "Legs heavy"
    });
    expect(result.success).toBe(true);
  });

  it("requires weekStart", () => {
    const result = athleteCheckinInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects non-integer fatigue", () => {
    const result = athleteCheckinInputSchema.safeParse({
      weekStart: "2026-04-07",
      fatigue: 2.5
    });
    expect(result.success).toBe(false);
  });

  it("rejects fatigue above 5", () => {
    const result = athleteCheckinInputSchema.safeParse({
      weekStart: "2026-04-07",
      fatigue: 6
    });
    expect(result.success).toBe(false);
  });

  it("rejects note exceeding 400 characters", () => {
    const result = athleteCheckinInputSchema.safeParse({
      weekStart: "2026-04-07",
      note: "x".repeat(401)
    });
    expect(result.success).toBe(false);
  });

  it("accepts note at exactly 400 characters", () => {
    const result = athleteCheckinInputSchema.safeParse({
      weekStart: "2026-04-07",
      note: "x".repeat(400)
    });
    expect(result.success).toBe(true);
  });
});
