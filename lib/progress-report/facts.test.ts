import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProgressReportFacts, computeBlockBoundaries } from "./facts";

// ---------------------------------------------------------------------------
// Minimal Supabase mock — per-table row arrays; each chain resolves to them.
// ---------------------------------------------------------------------------

type TableFixture = {
  data: unknown;
  error: unknown;
};

type TableBuilder = {
  select: (..._args: unknown[]) => TableBuilder;
  eq: (..._args: unknown[]) => TableBuilder;
  gte: (..._args: unknown[]) => TableBuilder;
  lte: (..._args: unknown[]) => TableBuilder;
  in: (..._args: unknown[]) => TableBuilder;
  order: (..._args: unknown[]) => TableBuilder;
  limit: (..._args: unknown[]) => TableBuilder;
  maybeSingle: () => Promise<TableFixture>;
  then: (resolve: (v: TableFixture) => void) => void;
};

function mockSupabase(fixtures: Record<string, TableFixture>): SupabaseClient {
  const makeBuilder = (fixture: TableFixture): TableBuilder => {
    const builder: TableBuilder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(fixture),
      then: (resolve) => resolve(fixture)
    };
    return builder;
  };

  return {
    from: (table: string) => {
      const fixture = fixtures[table];
      if (!fixture) throw new Error(`Unexpected table in test: ${table}`);
      return makeBuilder(fixture);
    }
  } as unknown as SupabaseClient;
}

describe("computeBlockBoundaries", () => {
  test("returns 28-day inclusive blocks", () => {
    const { blockStart, blockEnd, priorBlockStart, priorBlockEnd } =
      computeBlockBoundaries("2026-04-28");

    expect(blockEnd).toBe("2026-04-28");
    expect(blockStart).toBe("2026-04-01"); // 28 days inclusive = Apr 1..Apr 28
    expect(priorBlockEnd).toBe("2026-03-31");
    expect(priorBlockStart).toBe("2026-03-04"); // 28 days inclusive
  });

  test("current block and prior block do not overlap and are contiguous", () => {
    const { blockStart, priorBlockEnd } = computeBlockBoundaries("2026-04-28");
    const nextDay = new Date(`${priorBlockEnd}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    expect(nextDay.toISOString().slice(0, 10)).toBe(blockStart);
  });

  test("handles year boundaries", () => {
    const { blockStart, blockEnd } = computeBlockBoundaries("2026-01-15");
    expect(blockEnd).toBe("2026-01-15");
    expect(blockStart).toBe("2025-12-19");
  });
});

describe("buildProgressReportFacts query error handling", () => {
  const baseFixtures = (): Record<string, TableFixture> => ({
    completed_activities: { data: [], error: null },
    athlete_fitness: { data: [], error: null },
    sessions: { data: [], error: null }
  });

  test("throws when completed_activities query fails", async () => {
    const fixtures = baseFixtures();
    fixtures.completed_activities = {
      data: null,
      error: { message: "RLS denied" }
    };
    await expect(
      buildProgressReportFacts({
        supabase: mockSupabase(fixtures),
        athleteId: "user-1",
        blockEnd: "2026-04-28"
      })
    ).rejects.toThrow(/activities: RLS denied/);
  });

  test("throws when athlete_fitness query fails", async () => {
    const fixtures = baseFixtures();
    fixtures.athlete_fitness = {
      data: null,
      error: { message: "connection reset" }
    };
    await expect(
      buildProgressReportFacts({
        supabase: mockSupabase(fixtures),
        athleteId: "user-1",
        blockEnd: "2026-04-28"
      })
    ).rejects.toThrow(/athlete_fitness: connection reset/);
  });

  test("throws when sessions query fails", async () => {
    const fixtures = baseFixtures();
    fixtures.sessions = {
      data: null,
      error: { message: "timeout" }
    };
    await expect(
      buildProgressReportFacts({
        supabase: mockSupabase(fixtures),
        athleteId: "user-1",
        blockEnd: "2026-04-28"
      })
    ).rejects.toThrow(/sessions: timeout/);
  });
});

describe("buildProgressReportFacts fitness trajectory coverage", () => {
  // Minimal activity to keep the facts schema happy (≥ 2 factualBullets).
  const sampleActivity = {
    id: "act-1",
    user_id: "user-1",
    sport_type: "run",
    start_time_utc: "2026-04-10T06:00:00.000Z",
    duration_sec: 3600,
    moving_duration_sec: 3600,
    distance_m: 10000,
    avg_hr: 148,
    avg_power: null,
    avg_pace_per_100m_sec: null,
    metrics_v2: null
  };

  test("skips sports that only have prior-block fitness data", async () => {
    const fixtures: Record<string, TableFixture> = {
      // One activity in the current block so facts can be assembled.
      completed_activities: { data: [sampleActivity], error: null },
      athlete_fitness: {
        data: [
          // Only prior-block rows for "run" — no current-block coverage.
          { date: "2026-03-04", sport: "run", ctl: 20, atl: 18, tsb: 2, ramp_rate: 0.5 },
          { date: "2026-03-28", sport: "run", ctl: 26, atl: 22, tsb: 4, ramp_rate: 1.1 },
          // "total" has current-block coverage.
          { date: "2026-03-31", sport: "total", ctl: 52, atl: 48, tsb: 4, ramp_rate: 1.2 },
          { date: "2026-04-28", sport: "total", ctl: 58, atl: 52, tsb: 6, ramp_rate: 1.6 }
        ],
        error: null
      },
      sessions: { data: [], error: null }
    };

    const facts = await buildProgressReportFacts({
      supabase: mockSupabase(fixtures),
      athleteId: "user-1",
      blockEnd: "2026-04-28"
    });

    // "run" has only prior-block rows → must be skipped, not mislabeled.
    const runPoint = facts.fitnessTrajectory.find((f) => f.sport === "run");
    expect(runPoint).toBeUndefined();

    // "total" has current-block coverage and should emit.
    const totalPoint = facts.fitnessTrajectory.find((f) => f.sport === "total");
    expect(totalPoint).toBeDefined();
    expect(totalPoint?.currentCtlEnd).toBe(58);
    // Start row should come from the last row <= blockStart (2026-03-31),
    // not a hallucinated blockStart match.
    expect(totalPoint?.currentCtlStart).toBe(52);
  });

  test("emits a current-block point when fitness rows land inside the block", async () => {
    const fixtures: Record<string, TableFixture> = {
      completed_activities: { data: [sampleActivity], error: null },
      athlete_fitness: {
        data: [
          { date: "2026-03-31", sport: "run", ctl: 25, atl: 20, tsb: 5, ramp_rate: 1.0 },
          { date: "2026-04-10", sport: "run", ctl: 28, atl: 22, tsb: 6, ramp_rate: 1.2 },
          { date: "2026-04-25", sport: "run", ctl: 30, atl: 24, tsb: 6, ramp_rate: 1.3 }
        ],
        error: null
      },
      sessions: { data: [], error: null }
    };

    const facts = await buildProgressReportFacts({
      supabase: mockSupabase(fixtures),
      athleteId: "user-1",
      blockEnd: "2026-04-28"
    });

    const runPoint = facts.fitnessTrajectory.find((f) => f.sport === "run");
    expect(runPoint).toBeDefined();
    // startRow prefers the row just before blockStart (Mar 31), endRow is the
    // latest in-block row (Apr 25).
    expect(runPoint?.currentCtlStart).toBe(25);
    expect(runPoint?.currentCtlEnd).toBe(30);
  });
});
