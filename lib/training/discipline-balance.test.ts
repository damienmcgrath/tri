import {
  computeWeeklyDisciplineBalance,
  detectDisciplineImbalance,
} from "./discipline-balance";
import type { WeeklyDisciplineBalance } from "./discipline-balance";

// ---------------------------------------------------------------------------
// Supabase mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a fluent Supabase-like mock that returns `loadsRows` for the first
 * `.from()` call ("session_load") and `plannedRows` for the second ("sessions").
 */
function makeSupabase(
  loadsRows: object[] | null,
  plannedRows: object[] | null = []
) {
  let callCount = 0;

  const makeChain = (rows: object[] | null) => {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.gte = () => chain;
    chain.lte = () => Promise.resolve({ data: rows, error: null });
    return chain;
  };

  return {
    from: (_table: string) => ({
      select: (_cols: string) => {
        const rows = callCount++ === 0 ? loadsRows : plannedRows;
        return makeChain(rows);
      },
    }),
  };
}

/** A load row as returned by session_load */
function makeLoad(overrides: Partial<{
  sport: string | null;
  tss: number | string | null;
  duration_sec: number | null;
}> = {}) {
  return {
    sport: "run",
    tss: 100,
    duration_sec: 3600,
    ...overrides,
  };
}

/** A planned session row as returned by sessions */
function makePlanned(overrides: Partial<{
  sport: string | null;
  duration_minutes: number | null;
}> = {}) {
  return {
    sport: "run",
    duration_minutes: 60,
    ...overrides,
  };
}

const WEEK_START = "2024-04-01";
// WEEK_END would be 2024-04-07

// ---------------------------------------------------------------------------
// computeWeeklyDisciplineBalance
// ---------------------------------------------------------------------------

describe("computeWeeklyDisciplineBalance", () => {
  it("returns empty actual and planned when both queries return null", async () => {
    const supabase = makeSupabase(null, null);
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.weekStart).toBe(WEEK_START);
    expect(result.actual).toEqual({});
    expect(result.planned).toEqual({});
    expect(result.totalActualTss).toBe(0);
    expect(result.totalPlannedTss).toBe(0);
  });

  it("returns empty actual and planned when both queries return empty arrays", async () => {
    const supabase = makeSupabase([], []);
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual).toEqual({});
    expect(result.planned).toEqual({});
    expect(result.totalActualTss).toBe(0);
    expect(result.totalPlannedTss).toBe(0);
  });

  it("aggregates TSS, duration, and session count for a single sport", async () => {
    const supabase = makeSupabase(
      [makeLoad({ sport: "run", tss: 80, duration_sec: 3600 })],
      []
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["run"]).toBeDefined();
    expect(result.actual["run"].tss).toBe(80);
    expect(result.actual["run"].durationMinutes).toBe(60); // 3600/60
    expect(result.actual["run"].sessionCount).toBe(1);
    expect(result.totalActualTss).toBe(80);
  });

  it("aggregates multiple sessions of the same sport", async () => {
    const supabase = makeSupabase(
      [
        makeLoad({ sport: "run", tss: 60, duration_sec: 2400 }),
        makeLoad({ sport: "run", tss: 40, duration_sec: 1800 }),
      ],
      []
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["run"].tss).toBe(100);
    expect(result.actual["run"].durationMinutes).toBe(70); // 40 + 30
    expect(result.actual["run"].sessionCount).toBe(2);
    expect(result.totalActualTss).toBe(100);
  });

  it("tracks multiple sports separately in actual", async () => {
    const supabase = makeSupabase(
      [
        makeLoad({ sport: "run", tss: 100, duration_sec: 3600 }),
        makeLoad({ sport: "bike", tss: 150, duration_sec: 5400 }),
        makeLoad({ sport: "swim", tss: 60, duration_sec: 2700 }),
      ],
      []
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["run"].tss).toBe(100);
    expect(result.actual["bike"].tss).toBe(150);
    expect(result.actual["swim"].tss).toBe(60);
    expect(result.totalActualTss).toBe(310);
  });

  it("assigns null sport to 'other' bucket for actual loads", async () => {
    const supabase = makeSupabase(
      [makeLoad({ sport: null, tss: 50, duration_sec: 1800 })],
      []
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["other"]).toBeDefined();
    expect(result.actual["other"].tss).toBe(50);
  });

  it("handles null tss (falls back to 0)", async () => {
    const supabase = makeSupabase(
      [makeLoad({ sport: "run", tss: null, duration_sec: 3600 })],
      []
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["run"].tss).toBe(0);
    expect(result.totalActualTss).toBe(0);
  });

  it("handles string-typed tss by coercing to number", async () => {
    const supabase = makeSupabase(
      [makeLoad({ sport: "run", tss: "75" as unknown as number, duration_sec: 3600 })],
      []
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["run"].tss).toBe(75);
  });

  it("handles null duration_sec (durationMinutes becomes 0)", async () => {
    const supabase = makeSupabase(
      [makeLoad({ sport: "run", tss: 80, duration_sec: null })],
      []
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["run"].durationMinutes).toBe(0);
  });

  it("rounds duration_sec to nearest minute", async () => {
    // 3650 sec → round(3650/60) = round(60.83) = 61
    const supabase = makeSupabase(
      [makeLoad({ sport: "bike", tss: 100, duration_sec: 3650 })],
      []
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["bike"].durationMinutes).toBe(61);
  });

  it("aggregates planned sessions: TSS estimated as 1 per minute", async () => {
    const supabase = makeSupabase(
      [],
      [makePlanned({ sport: "bike", duration_minutes: 90 })]
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.planned["bike"]).toBeDefined();
    expect(result.planned["bike"].tss).toBe(90); // 1 TSS per minute
    expect(result.planned["bike"].durationMinutes).toBe(90);
    expect(result.planned["bike"].sessionCount).toBe(1);
    expect(result.totalPlannedTss).toBe(90);
  });

  it("aggregates multiple planned sessions of the same sport", async () => {
    const supabase = makeSupabase(
      [],
      [
        makePlanned({ sport: "swim", duration_minutes: 45 }),
        makePlanned({ sport: "swim", duration_minutes: 30 }),
      ]
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.planned["swim"].tss).toBe(75);
    expect(result.planned["swim"].durationMinutes).toBe(75);
    expect(result.planned["swim"].sessionCount).toBe(2);
  });

  it("assigns null sport to 'other' in planned", async () => {
    const supabase = makeSupabase(
      [],
      [makePlanned({ sport: null, duration_minutes: 40 })]
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.planned["other"]).toBeDefined();
    expect(result.planned["other"].durationMinutes).toBe(40);
  });

  it("handles null duration_minutes in planned (defaults to 0)", async () => {
    const supabase = makeSupabase(
      [],
      [makePlanned({ sport: "run", duration_minutes: null })]
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.planned["run"].tss).toBe(0);
    expect(result.planned["run"].durationMinutes).toBe(0);
  });

  it("populates both actual and planned simultaneously", async () => {
    const supabase = makeSupabase(
      [makeLoad({ sport: "run", tss: 100, duration_sec: 3600 })],
      [makePlanned({ sport: "run", duration_minutes: 60 })]
    );
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      WEEK_START
    );

    expect(result.actual["run"].tss).toBe(100);
    expect(result.planned["run"].tss).toBe(60);
    expect(result.totalActualTss).toBe(100);
    expect(result.totalPlannedTss).toBe(60);
  });

  it("preserves weekStart in the returned object", async () => {
    const supabase = makeSupabase([], []);
    const result = await computeWeeklyDisciplineBalance(
      supabase as never,
      "user-1",
      "2024-01-15"
    );
    expect(result.weekStart).toBe("2024-01-15");
  });
});

// ---------------------------------------------------------------------------
// detectDisciplineImbalance
// ---------------------------------------------------------------------------

/** Build a WeeklyDisciplineBalance fixture from shorthand sport maps */
function makeBalance(
  actual: Record<string, { tss: number }>,
  planned: Record<string, { tss: number }>
): WeeklyDisciplineBalance {
  const toVolume = (tss: number) => ({
    tss,
    durationMinutes: tss,
    sessionCount: 1,
  });

  const actualFull = Object.fromEntries(
    Object.entries(actual).map(([k, v]) => [k, toVolume(v.tss)])
  );
  const plannedFull = Object.fromEntries(
    Object.entries(planned).map(([k, v]) => [k, toVolume(v.tss)])
  );

  const totalActualTss = Object.values(actual).reduce((s, v) => s + v.tss, 0);
  const totalPlannedTss = Object.values(planned).reduce((s, v) => s + v.tss, 0);

  return {
    weekStart: WEEK_START,
    actual: actualFull,
    planned: plannedFull,
    totalActualTss,
    totalPlannedTss,
  };
}

describe("detectDisciplineImbalance", () => {
  it("returns [] when totalActualTss is 0", () => {
    const balance = makeBalance({}, { run: { tss: 100 } });
    expect(detectDisciplineImbalance(balance)).toEqual([]);
  });

  it("returns [] when totalPlannedTss is 0", () => {
    const balance = makeBalance({ run: { tss: 100 } }, {});
    expect(detectDisciplineImbalance(balance)).toEqual([]);
  });

  it("returns [] when both totals are 0", () => {
    const balance = makeBalance({}, {});
    expect(detectDisciplineImbalance(balance)).toEqual([]);
  });

  it("returns [] when distribution matches planned exactly", () => {
    // run 50%, bike 50% actual = run 50%, bike 50% planned
    const balance = makeBalance(
      { run: { tss: 50 }, bike: { tss: 50 } },
      { run: { tss: 50 }, bike: { tss: 50 } }
    );
    expect(detectDisciplineImbalance(balance)).toEqual([]);
  });

  it("returns [] when deviation is exactly at the threshold (not strictly greater)", () => {
    // actual: run 60%, bike 40% vs planned: run 50%, bike 50% → delta = 10pp
    // threshold default is 10 — Math.abs(10) > 10 is false, so no imbalance
    const balance = makeBalance(
      { run: { tss: 60 }, bike: { tss: 40 } },
      { run: { tss: 50 }, bike: { tss: 50 } }
    );
    expect(detectDisciplineImbalance(balance)).toEqual([]);
  });

  it("detects imbalance when deviation exceeds threshold", () => {
    // actual: run 70%, bike 30% vs planned: run 50%, bike 50% → delta = +20pp for run
    const balance = makeBalance(
      { run: { tss: 70 }, bike: { tss: 30 } },
      { run: { tss: 50 }, bike: { tss: 50 } }
    );
    const result = detectDisciplineImbalance(balance);

    expect(result.length).toBeGreaterThan(0);
    const run = result.find((i) => i.sport === "run");
    expect(run).toBeDefined();
    expect(run!.direction).toBe("over");
    expect(run!.deltaPp).toBe(20);
    expect(run!.actualPct).toBe(70);
    expect(run!.plannedPct).toBe(50);
  });

  it("reports 'under' direction when actual is below planned", () => {
    // actual: swim 10%, run 90% vs planned: swim 40%, run 60% → swim is -30pp (under)
    const balance = makeBalance(
      { swim: { tss: 10 }, run: { tss: 90 } },
      { swim: { tss: 40 }, run: { tss: 60 } }
    );
    const result = detectDisciplineImbalance(balance);

    const swim = result.find((i) => i.sport === "swim");
    expect(swim).toBeDefined();
    expect(swim!.direction).toBe("under");
    expect(swim!.deltaPp).toBe(-30);
  });

  it("sorts imbalances by absolute deltaPp descending", () => {
    // run: +25pp deviation, bike: -15pp deviation
    const balance = makeBalance(
      { run: { tss: 75 }, bike: { tss: 15 }, swim: { tss: 10 } },
      { run: { tss: 50 }, bike: { tss: 30 }, swim: { tss: 20 } }
    );
    const result = detectDisciplineImbalance(balance);

    // First entry must have the largest absolute delta
    expect(Math.abs(result[0].deltaPp)).toBeGreaterThanOrEqual(
      Math.abs(result[result.length - 1].deltaPp)
    );
  });

  it("excludes 'other' sport from imbalance detection", () => {
    // 'other' deviates wildly; should not appear in results
    const balance = makeBalance(
      { other: { tss: 90 }, run: { tss: 10 } },
      { other: { tss: 10 }, run: { tss: 90 } }
    );
    const result = detectDisciplineImbalance(balance);
    expect(result.find((i) => i.sport === "other")).toBeUndefined();
  });

  it("excludes 'strength' sport from imbalance detection", () => {
    const balance = makeBalance(
      { strength: { tss: 90 }, run: { tss: 10 } },
      { strength: { tss: 10 }, run: { tss: 90 } }
    );
    const result = detectDisciplineImbalance(balance);
    expect(result.find((i) => i.sport === "strength")).toBeUndefined();
  });

  it("handles a sport present in actual but absent from planned (plannedPct = 0)", () => {
    // run is 100% of actual but 0% of planned → +100pp deviation
    const balance = makeBalance(
      { run: { tss: 100 } },
      { bike: { tss: 100 } }
    );
    const result = detectDisciplineImbalance(balance);

    const run = result.find((i) => i.sport === "run");
    expect(run).toBeDefined();
    expect(run!.plannedPct).toBe(0);
    expect(run!.actualPct).toBe(100);
    expect(run!.direction).toBe("over");
  });

  it("handles a sport present in planned but absent from actual (actualPct = 0)", () => {
    // bike is 0% of actual but 50% of planned → -50pp deviation
    const balance = makeBalance(
      { run: { tss: 100 } },
      { run: { tss: 50 }, bike: { tss: 50 } }
    );
    const result = detectDisciplineImbalance(balance);

    const bike = result.find((i) => i.sport === "bike");
    expect(bike).toBeDefined();
    expect(bike!.actualPct).toBe(0);
    expect(bike!.direction).toBe("under");
  });

  it("respects a custom threshold parameter", () => {
    // delta of exactly 5pp; default threshold (10) would miss it; threshold 4 should catch it
    const balance = makeBalance(
      { run: { tss: 55 }, bike: { tss: 45 } },
      { run: { tss: 50 }, bike: { tss: 50 } }
    );

    const defaultResult = detectDisciplineImbalance(balance, 10);
    expect(defaultResult).toEqual([]);

    const lenientResult = detectDisciplineImbalance(balance, 4);
    expect(lenientResult.length).toBeGreaterThan(0);
  });

  it("rounds actualPct, plannedPct, and deltaPp to integers", () => {
    // Use values that produce fractional percentages
    // actual: run 2/3, bike 1/3 (66.67%, 33.33%)
    // planned: run 1/2, bike 1/2 (50%, 50%)
    // delta run: +17pp, delta bike: -17pp
    const balance = makeBalance(
      { run: { tss: 200 }, bike: { tss: 100 } },
      { run: { tss: 50 }, bike: { tss: 50 } }
    );
    const result = detectDisciplineImbalance(balance);

    for (const item of result) {
      expect(Number.isInteger(item.actualPct)).toBe(true);
      expect(Number.isInteger(item.plannedPct)).toBe(true);
      expect(Number.isInteger(item.deltaPp)).toBe(true);
    }
  });

  it("returns all three triathlon sports when all three are imbalanced", () => {
    // Skew heavily: run overweighted, swim and bike underweighted
    const balance = makeBalance(
      { run: { tss: 80 }, bike: { tss: 10 }, swim: { tss: 10 } },
      { run: { tss: 40 }, bike: { tss: 30 }, swim: { tss: 30 } }
    );
    const result = detectDisciplineImbalance(balance);

    const sports = result.map((i) => i.sport);
    expect(sports).toContain("run");
    expect(sports).toContain("bike");
    expect(sports).toContain("swim");
  });

  it("produces no duplicates for the same sport", () => {
    const balance = makeBalance(
      { run: { tss: 80 }, bike: { tss: 20 } },
      { run: { tss: 50 }, bike: { tss: 50 } }
    );
    const result = detectDisciplineImbalance(balance);
    const sports = result.map((i) => i.sport);
    const unique = new Set(sports);
    expect(unique.size).toBe(sports.length);
  });

  it("returns empty array when all deviant sports are 'other' or 'strength'", () => {
    const balance = makeBalance(
      { other: { tss: 70 }, strength: { tss: 30 } },
      { other: { tss: 30 }, strength: { tss: 70 } }
    );
    expect(detectDisciplineImbalance(balance)).toEqual([]);
  });
});
