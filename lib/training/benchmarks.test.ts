import { deriveBenchmarks } from "./benchmarks";
import type { BenchmarkHighlight } from "./benchmarks";

function makeSupabase(currentRows: object[], priorRows: object[] = []) {
  let callCount = 0;
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            gte: () => ({
              lte: () => ({
                order: () => ({
                  then: undefined,
                  // Return currentRows on first call, priorRows on second
                  async *[Symbol.asyncIterator]() {},
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

// Minimal Supabase mock that returns two sequential datasets
function makeSeqSupabase(currentRows: object[], priorRows: object[] = []) {
  let callCount = 0;
  const makeChain = (rows: object[]) => {
    const chain: Record<string, unknown> = {};
    const terminal = { data: rows, error: null };
    const returnFn = () => Promise.resolve(terminal);
    chain.eq = () => chain;
    chain.in = () => chain;
    chain.gte = () => chain;
    chain.lte = () => chain;
    chain.order = returnFn;
    return chain;
  };

  return {
    from: (_table: string) => ({
      select: (_cols: string) => {
        const rows = callCount++ === 0 ? currentRows : priorRows;
        return makeChain(rows);
      },
    }),
  };
}

function makeRow(overrides: Partial<{
  id: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  moving_duration_sec: number | null;
  distance_m: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec: number | null;
  metrics_v2: Record<string, unknown> | null;
}> = {}) {
  return {
    id: "act-1",
    sport_type: "run",
    start_time_utc: "2024-03-10T08:00:00.000Z",
    duration_sec: 3600,
    moving_duration_sec: null,
    distance_m: 10000,
    avg_power: null,
    avg_pace_per_100m_sec: null,
    metrics_v2: null,
    ...overrides,
  };
}

const WEEK_START = "2024-03-11";
const WEEK_END = "2024-03-17";

describe("deriveBenchmarks", () => {
  it("returns [] when no qualifying activities exist", async () => {
    const supabase = makeSeqSupabase([]);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);
    expect(result).toEqual([]);
  });

  it("run benchmark: only considers runs >= 5km, picks lowest pace", async () => {
    const rows = [
      makeRow({ id: "short", distance_m: 3000, duration_sec: 1800 }),  // < 5km, excluded
      makeRow({ id: "slow", distance_m: 10000, duration_sec: 5000 }),   // 500 sec/km
      makeRow({ id: "fast", distance_m: 10000, duration_sec: 3000 }),   // 300 sec/km — best
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const run = result.find((b) => b.sport === "run");
    expect(run).toBeDefined();
    expect(run!.activityId).toBe("fast");
    expect(run!.value).toBeCloseTo(300, 0);
    expect(run!.label).toBe("Best run pace");
    expect(run!.unitLabel).toBe("/km");
  });

  it("run benchmark: uses moving_duration_sec when available", async () => {
    const rows = [
      makeRow({ id: "act", distance_m: 10000, duration_sec: 4000, moving_duration_sec: 3200 }),
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const run = result.find((b) => b.sport === "run");
    expect(run).toBeDefined();
    // moving_duration_sec / dist * 1000 = 3200 / 10000 * 1000 = 320
    expect(run!.value).toBeCloseTo(320, 0);
  });

  it("bike benchmark: prefers normalized power from metrics_v2 over avg_power", async () => {
    const rows = [
      makeRow({
        id: "bike-np",
        sport_type: "bike",
        duration_sec: 3600,
        avg_power: 200,
        metrics_v2: { power: { normalizedPower: 245 } },
      }),
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const bike = result.find((b) => b.sport === "bike");
    expect(bike).toBeDefined();
    expect(bike!.value).toBe(245);
    expect(bike!.formattedValue).toBe("245W");
  });

  it("bike benchmark: only considers rides >= 20min (1200sec), picks highest power", async () => {
    const rows = [
      makeRow({ id: "short-ride", sport_type: "bike", duration_sec: 600, avg_power: 300 }),  // excluded
      makeRow({ id: "low-power", sport_type: "bike", duration_sec: 3600, avg_power: 180 }),
      makeRow({ id: "high-power", sport_type: "bike", duration_sec: 3600, avg_power: 260 }),  // best
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const bike = result.find((b) => b.sport === "bike");
    expect(bike).toBeDefined();
    expect(bike!.activityId).toBe("high-power");
    expect(bike!.value).toBe(260);
  });

  it("swim benchmark: only considers swims >= 400m, uses avg_pace_per_100m_sec, picks lowest", async () => {
    const rows = [
      makeRow({ id: "short-swim", sport_type: "swim", distance_m: 200, avg_pace_per_100m_sec: 80 }),  // excluded
      makeRow({ id: "slow-swim", sport_type: "swim", distance_m: 2000, avg_pace_per_100m_sec: 110 }),
      makeRow({ id: "fast-swim", sport_type: "swim", distance_m: 1500, avg_pace_per_100m_sec: 90 }),   // best
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const swim = result.find((b) => b.sport === "swim");
    expect(swim).toBeDefined();
    expect(swim!.activityId).toBe("fast-swim");
    expect(swim!.value).toBe(90);
    expect(swim!.unitLabel).toBe("/100m");
  });

  it("handles all three sports in one dataset without cross-contamination", async () => {
    const rows = [
      makeRow({ id: "run-1", sport_type: "run", distance_m: 10000, duration_sec: 3200 }),
      makeRow({ id: "bike-1", sport_type: "bike", duration_sec: 3600, avg_power: 230 }),
      makeRow({ id: "swim-1", sport_type: "swim", distance_m: 1500, avg_pace_per_100m_sec: 95 }),
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    expect(result.length).toBe(3);
    expect(result.find((b) => b.sport === "run")?.activityId).toBe("run-1");
    expect(result.find((b) => b.sport === "bike")?.activityId).toBe("bike-1");
    expect(result.find((b) => b.sport === "swim")?.activityId).toBe("swim-1");
  });

  it("isThisWeek flag: true when activity date is within weekStart–weekEnd", async () => {
    const inWeek = makeRow({ id: "in-week", sport_type: "run", start_time_utc: "2024-03-14T10:00:00.000Z", distance_m: 10000, duration_sec: 3200 });
    const outOfWeek = makeRow({ id: "out-week", sport_type: "run", start_time_utc: "2024-03-05T10:00:00.000Z", distance_m: 10000, duration_sec: 3000 });
    // out-week has faster pace but we test both
    const rows = [inWeek, outOfWeek];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const run = result.find((b) => b.sport === "run");
    expect(run).toBeDefined();
    // out-week has faster pace (3000/10000*1000=300 vs 3200/10000*1000=320)
    expect(run!.activityId).toBe("out-week");
    expect(run!.isThisWeek).toBe(false);

    // Test with only the in-week activity
    const supabase2 = makeSeqSupabase([inWeek]);
    const result2 = await deriveBenchmarks(supabase2 as never, "user-1", WEEK_START, WEEK_END);
    const run2 = result2.find((b) => b.sport === "run");
    expect(run2!.isThisWeek).toBe(true);
  });

  it("prior-block delta: correctly computes delta when prior data exists", async () => {
    const currentRows = [
      makeRow({ id: "run-current", sport_type: "run", distance_m: 10000, duration_sec: 3000 }),  // 300 sec/km
    ];
    const priorRows = [
      makeRow({ id: "run-prior", sport_type: "run", distance_m: 10000, duration_sec: 3120 }),    // 312 sec/km (slower)
    ];
    const supabase = makeSeqSupabase(currentRows, priorRows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const run = result.find((b) => b.sport === "run");
    expect(run).toBeDefined();
    expect(run!.deltaVsPriorBlock).toBeGreaterThan(0);  // positive = faster
    expect(run!.deltaLabel).toMatch(/faster/);
  });

  it("prior-block delta: omitted when no prior data exists", async () => {
    const currentRows = [
      makeRow({ id: "run-1", sport_type: "run", distance_m: 10000, duration_sec: 3000 }),
    ];
    const supabase = makeSeqSupabase(currentRows, []);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const run = result.find((b) => b.sport === "run");
    expect(run).toBeDefined();
    expect(run!.deltaVsPriorBlock).toBeUndefined();
    expect(run!.deltaLabel).toBeUndefined();
  });

  it("formatting: run pace formats as M:SS/km", async () => {
    // 272 sec/km → 4:32/km
    const rows = [
      makeRow({ id: "run-1", sport_type: "run", distance_m: 10000, duration_sec: 2720 }),
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const run = result.find((b) => b.sport === "run");
    expect(run!.formattedValue).toBe("4:32/km");
  });

  it("formatting: swim pace formats as M:SS/100m", async () => {
    // 95 sec/100m → 1:35/100m
    const rows = [
      makeRow({ id: "swim-1", sport_type: "swim", distance_m: 1500, avg_pace_per_100m_sec: 95 }),
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const swim = result.find((b) => b.sport === "swim");
    expect(swim!.formattedValue).toBe("1:35/100m");
  });

  it("formatting: bike power formats as integer W", async () => {
    const rows = [
      makeRow({ id: "bike-1", sport_type: "bike", duration_sec: 3600, avg_power: 245.7 }),
    ];
    const supabase = makeSeqSupabase(rows);
    const result = await deriveBenchmarks(supabase as never, "user-1", WEEK_START, WEEK_END);

    const bike = result.find((b) => b.sport === "bike");
    expect(bike!.formattedValue).toBe("246W");
  });
});
