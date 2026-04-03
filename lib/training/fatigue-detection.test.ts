import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectCrossDisciplineFatigue,
  detectDisciplineSpecificDecline,
  type FatigueSignal,
} from "./fatigue-detection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FitnessRow = { date: string; sport: string; tsb: number };

/**
 * Build a minimal Supabase client stub whose fluent query chain resolves to
 * the supplied rows. The chain mirrors the exact call sequence used inside
 * fatigue-detection.ts:
 *   from → select → eq → gte → in → order
 */
function mockSupabase(rows: FitnessRow[]): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            in: () => ({
              order: () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

/**
 * Build an array of `count` evenly-spaced rows for a given sport starting at
 * `firstTsb` and ending at `lastTsb`, assigned sequential ISO dates beginning
 * at "2026-03-24" (10 days before the frozen clock date of 2026-04-03).
 */
function makeRows(
  sport: string,
  firstTsb: number,
  lastTsb: number,
  count: number,
  startDate = "2026-03-24"
): FitnessRow[] {
  const rows: FitnessRow[] = [];
  const step = count === 1 ? 0 : (lastTsb - firstTsb) / (count - 1);
  let d = new Date(`${startDate}T00:00:00.000Z`);
  for (let i = 0; i < count; i++) {
    rows.push({
      date: d.toISOString().slice(0, 10),
      sport,
      tsb: firstTsb + step * i,
    });
    d = new Date(d.getTime() + 86_400_000);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Clock fixture — pin "today" so todayIso() / addDaysIso() are deterministic
// ---------------------------------------------------------------------------

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-04-03T12:00:00Z"));
});

afterAll(() => {
  jest.useRealTimers();
});

const USER_ID = "user-abc";

// ===========================================================================
// detectCrossDisciplineFatigue
// ===========================================================================

describe("detectCrossDisciplineFatigue", () => {
  // -------------------------------------------------------------------------
  // 1. Returns null when no data
  // -------------------------------------------------------------------------
  it("returns null when the query returns no rows", async () => {
    const supabase = mockSupabase([]);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. Returns null when fewer than 3 data points per sport
  // -------------------------------------------------------------------------
  it("returns null when every sport has fewer than 3 data points", async () => {
    // 2 rows per sport — each is dropped by the length < 3 guard
    const rows: FitnessRow[] = [
      { date: "2026-03-28", sport: "swim", tsb: 10 },
      { date: "2026-03-29", sport: "swim", tsb: 0 },
      { date: "2026-03-28", sport: "bike", tsb: 10 },
      { date: "2026-03-29", sport: "bike", tsb: 0 },
      { date: "2026-03-28", sport: "run", tsb: 10 },
      { date: "2026-03-29", sport: "run", tsb: 0 },
    ];
    const supabase = mockSupabase(rows);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 3. Returns null when only 1 sport is declining
  // -------------------------------------------------------------------------
  it("returns null when only 1 sport is declining", async () => {
    // swim: big drop  |  bike: flat  |  run: flat
    const rows: FitnessRow[] = [
      ...makeRows("swim", 20, -10, 6),   // avgFirst ≈ 13.3, avgSecond ≈ -3.3  → Δ ≈ -16.7
      ...makeRows("bike", 5, 5, 6),       // no change
      ...makeRows("run", 5, 5, 6),        // no change
    ];
    const supabase = mockSupabase(rows);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 4. Returns warning when exactly 2 sports are declining
  // -------------------------------------------------------------------------
  it("returns a warning signal when exactly 2 sports are declining", async () => {
    // swim & bike declining; run stable
    const rows: FitnessRow[] = [
      ...makeRows("swim", 20, -10, 6),
      ...makeRows("bike", 20, -10, 6),
      ...makeRows("run", 5, 5, 6),
    ];
    const supabase = mockSupabase(rows);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);

    expect(result).not.toBeNull();
    const signal = result as FatigueSignal;
    expect(signal.type).toBe("cross_discipline");
    expect(signal.severity).toBe("warning");
    expect(signal.sports).toHaveLength(2);
    expect(signal.sports).toEqual(expect.arrayContaining(["swim", "bike"]));
  });

  // -------------------------------------------------------------------------
  // 5. Returns alert when all 3 sports are declining
  // -------------------------------------------------------------------------
  it("returns an alert signal when all 3 sports are declining", async () => {
    const rows: FitnessRow[] = [
      ...makeRows("swim", 20, -10, 6),
      ...makeRows("bike", 20, -10, 6),
      ...makeRows("run", 20, -10, 6),
    ];
    const supabase = mockSupabase(rows);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);

    expect(result).not.toBeNull();
    const signal = result as FatigueSignal;
    expect(signal.severity).toBe("alert");
    expect(signal.sports).toHaveLength(3);
    expect(signal.sports).toEqual(expect.arrayContaining(["swim", "bike", "run"]));
  });

  // -------------------------------------------------------------------------
  // 6. TSB dropping by exactly 5 → NOT declining (boundary: must be >5 below)
  // -------------------------------------------------------------------------
  it("does NOT flag a sport as declining when the drop equals exactly 5", async () => {
    // We need avgSecond - avgFirst === -5 exactly.
    // Use 4 rows: first half [10, 10], second half [5, 5] → avgFirst=10, avgSecond=5, Δ=-5
    const exactDrop: FitnessRow[] = [
      { date: "2026-03-24", sport: "swim", tsb: 10 },
      { date: "2026-03-25", sport: "swim", tsb: 10 },
      { date: "2026-03-26", sport: "swim", tsb: 5 },
      { date: "2026-03-27", sport: "swim", tsb: 5 },
    ];
    const rows: FitnessRow[] = [
      ...exactDrop,
      // bike & run also have exact 5-point drop
      ...exactDrop.map((r) => ({ ...r, sport: "bike" })),
      ...exactDrop.map((r) => ({ ...r, sport: "run" })),
    ];
    const supabase = mockSupabase(rows);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);
    // Δ = -5 is NOT < -5, so no sport should be flagged
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7. TSB dropping by 5.1 → IS declining
  // -------------------------------------------------------------------------
  it("flags a sport as declining when the drop is 5.1 (just over boundary)", async () => {
    // 4 rows: firstHalf=[10, 10], secondHalf=[4.9, 4.9] → Δ = -5.1
    const slightDrop = (sport: string): FitnessRow[] => [
      { date: "2026-03-24", sport, tsb: 10 },
      { date: "2026-03-25", sport, tsb: 10 },
      { date: "2026-03-26", sport, tsb: 4.9 },
      { date: "2026-03-27", sport, tsb: 4.9 },
    ];
    const rows: FitnessRow[] = [
      ...slightDrop("swim"),
      ...slightDrop("bike"),
      ...makeRows("run", 5, 5, 4), // stable
    ];
    const supabase = mockSupabase(rows);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.sports).toEqual(expect.arrayContaining(["swim", "bike"]));
  });

  // -------------------------------------------------------------------------
  // 8. tsbValues contains second-half averages rounded to 1 decimal place
  // -------------------------------------------------------------------------
  it("populates tsbValues with second-half averages rounded to 1 decimal", async () => {
    // swim: 6 rows → firstHalf=[0,1,2], secondHalf=[3,4,5] → avgSecond = 4.0
    const rows: FitnessRow[] = [
      { date: "2026-03-24", sport: "swim", tsb: 0 },
      { date: "2026-03-25", sport: "swim", tsb: 1 },
      { date: "2026-03-26", sport: "swim", tsb: 2 },
      { date: "2026-03-27", sport: "swim", tsb: 3 },
      { date: "2026-03-28", sport: "swim", tsb: 4 },
      { date: "2026-03-29", sport: "swim", tsb: 5 },
    ];
    // bike: 6 rows → firstHalf=[20,20,20], secondHalf=[10,10,10] → avgSecond = 10.0
    const bikeRows: FitnessRow[] = [
      { date: "2026-03-24", sport: "bike", tsb: 20 },
      { date: "2026-03-25", sport: "bike", tsb: 20 },
      { date: "2026-03-26", sport: "bike", tsb: 20 },
      { date: "2026-03-27", sport: "bike", tsb: 10 },
      { date: "2026-03-28", sport: "bike", tsb: 10 },
      { date: "2026-03-29", sport: "bike", tsb: 10 },
    ];
    // run: same big drop for a 2-sport decline (warning)
    const runRows: FitnessRow[] = bikeRows.map((r) => ({ ...r, sport: "run" }));

    const supabase = mockSupabase([...rows, ...bikeRows, ...runRows]);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);

    // swim: avgSecond = (3+4+5)/3 = 4.0 — not declining but still in tsbValues
    // bike: avgSecond = 10.0 — declining (Δ = -10)
    // run:  avgSecond = 10.0 — declining (Δ = -10)
    expect(result).not.toBeNull();
    expect(result!.tsbValues["swim"]).toBe(4.0);
    expect(result!.tsbValues["bike"]).toBe(10.0);
    expect(result!.tsbValues["run"]).toBe(10.0);

    // Verify rounding: use a value that produces a non-trivial decimal
    // bike with secondHalf=[10, 10, 11] → avgSecond = 10.333… → rounded = 10.3
    const precisionRows: FitnessRow[] = [
      { date: "2026-03-24", sport: "bike", tsb: 20 },
      { date: "2026-03-25", sport: "bike", tsb: 20 },
      { date: "2026-03-26", sport: "bike", tsb: 20 },
      { date: "2026-03-27", sport: "bike", tsb: 10 },
      { date: "2026-03-28", sport: "bike", tsb: 10 },
      { date: "2026-03-29", sport: "bike", tsb: 11 },
    ];
    const supabase2 = mockSupabase([...rows, ...precisionRows, ...runRows]);
    const result2 = await detectCrossDisciplineFatigue(supabase2, USER_ID);
    expect(result2).not.toBeNull();
    expect(result2!.tsbValues["bike"]).toBe(10.3);
  });

  // -------------------------------------------------------------------------
  // 9. detail string mentions the declining sports
  // -------------------------------------------------------------------------
  it("includes the declining sports in the detail string", async () => {
    const rows: FitnessRow[] = [
      ...makeRows("swim", 20, -10, 6),
      ...makeRows("bike", 20, -10, 6),
      ...makeRows("run", 5, 5, 6),
    ];
    const supabase = mockSupabase(rows);
    const result = await detectCrossDisciplineFatigue(supabase, USER_ID);

    expect(result).not.toBeNull();
    expect(result!.detail).toContain("swim");
    expect(result!.detail).toContain("bike");
  });
});

// ===========================================================================
// detectDisciplineSpecificDecline
// ===========================================================================

describe("detectDisciplineSpecificDecline", () => {
  // -------------------------------------------------------------------------
  // 1. Returns empty array when no data
  // -------------------------------------------------------------------------
  it("returns an empty array when the query returns no rows", async () => {
    const supabase = mockSupabase([]);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. Returns empty when 2+ sports are declining (cross-discipline, not specific)
  // -------------------------------------------------------------------------
  it("returns empty when 2 sports are declining", async () => {
    const rows: FitnessRow[] = [
      ...makeRows("swim", 20, -10, 6),
      ...makeRows("bike", 20, -10, 6),
      ...makeRows("run", 5, 5, 6),
    ];
    const supabase = mockSupabase(rows);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);
    expect(result).toEqual([]);
  });

  it("returns empty when all 3 sports are declining", async () => {
    const rows: FitnessRow[] = [
      ...makeRows("swim", 20, -10, 6),
      ...makeRows("bike", 20, -10, 6),
      ...makeRows("run", 20, -10, 6),
    ];
    const supabase = mockSupabase(rows);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 3. Returns empty when 0 sports are declining
  // -------------------------------------------------------------------------
  it("returns empty when no sports are declining", async () => {
    const rows: FitnessRow[] = [
      ...makeRows("swim", 5, 5, 6),
      ...makeRows("bike", 5, 5, 6),
      ...makeRows("run", 5, 5, 6),
    ];
    const supabase = mockSupabase(rows);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 4. Returns signal when exactly 1 sport declining and others stable/rising
  // -------------------------------------------------------------------------
  it("returns a discipline_specific signal when exactly 1 sport is declining", async () => {
    // run declining; swim stable; bike rising
    const rows: FitnessRow[] = [
      ...makeRows("swim", 5, 5, 6),         // stable
      ...makeRows("bike", 0, 15, 6),         // rising (Δ = +15 > 5)
      ...makeRows("run", 20, -10, 6),        // declining (Δ ≈ -16.7)
    ];
    const supabase = mockSupabase(rows);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);

    expect(result).toHaveLength(1);
    const signal = result[0];
    expect(signal.type).toBe("discipline_specific");
    expect(signal.sports).toEqual(["run"]);
  });

  // -------------------------------------------------------------------------
  // 5. Severity is alert when latestTsb < -15
  // -------------------------------------------------------------------------
  it("returns alert severity when the latest TSB of the declining sport is < -15", async () => {
    // run ends at -20 (< -15)  →  alert
    const rows: FitnessRow[] = [
      ...makeRows("swim", 5, 5, 6),
      ...makeRows("bike", 5, 5, 6),
      ...makeRows("run", 10, -20, 6),  // latestTsb = -20
    ];
    const supabase = mockSupabase(rows);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("alert");
  });

  // -------------------------------------------------------------------------
  // 6. Severity is warning when latestTsb ≥ -15
  // -------------------------------------------------------------------------
  it("returns warning severity when the latest TSB of the declining sport is above -15", async () => {
    // run drops from 10 to -10 (latestTsb = -10, which is > -15)  →  warning
    const rows: FitnessRow[] = [
      ...makeRows("swim", 5, 5, 6),
      ...makeRows("bike", 5, 5, 6),
      ...makeRows("run", 10, -10, 6),  // latestTsb = -10
    ];
    const supabase = mockSupabase(rows);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
  });

  // -------------------------------------------------------------------------
  // 7. Boundary: latestTsb exactly -15 → warning (not alert; condition is < -15)
  // -------------------------------------------------------------------------
  it("returns warning (not alert) when latestTsb is exactly -15", async () => {
    // Construct rows where the last TSB value is exactly -15.
    // Use 6 rows where the 6th (latestTsb) = -15 and overall trend is declining.
    // firstHalf=[10,10,10], secondHalf=[0,0,-15] → avgFirst=10, avgSecond ≈ -1.7  Δ ≈ -11.7
    const runRows: FitnessRow[] = [
      { date: "2026-03-24", sport: "run", tsb: 10 },
      { date: "2026-03-25", sport: "run", tsb: 10 },
      { date: "2026-03-26", sport: "run", tsb: 10 },
      { date: "2026-03-27", sport: "run", tsb: 0 },
      { date: "2026-03-28", sport: "run", tsb: 0 },
      { date: "2026-03-29", sport: "run", tsb: -15 },  // latestTsb = -15 exactly
    ];
    const rows: FitnessRow[] = [
      ...makeRows("swim", 5, 5, 6),
      ...makeRows("bike", 5, 5, 6),
      ...runRows,
    ];
    const supabase = mockSupabase(rows);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);

    expect(result).toHaveLength(1);
    // -15 is NOT < -15, so severity must be "warning"
    expect(result[0].severity).toBe("warning");
  });

  // -------------------------------------------------------------------------
  // 8. tsbValues contains all sports' latest TSB values
  // -------------------------------------------------------------------------
  it("populates tsbValues with the latest TSB for every classified sport", async () => {
    // swim stable ending at 8; bike rising ending at 12; run declining ending at -5
    const swimRows: FitnessRow[] = [
      { date: "2026-03-24", sport: "swim", tsb: 8 },
      { date: "2026-03-25", sport: "swim", tsb: 8 },
      { date: "2026-03-26", sport: "swim", tsb: 8 },
      { date: "2026-03-27", sport: "swim", tsb: 8 },
      { date: "2026-03-28", sport: "swim", tsb: 8 },
      { date: "2026-03-29", sport: "swim", tsb: 8 },  // latestTsb swim = 8
    ];
    const bikeRows: FitnessRow[] = [
      { date: "2026-03-24", sport: "bike", tsb: 0 },
      { date: "2026-03-25", sport: "bike", tsb: 2 },
      { date: "2026-03-26", sport: "bike", tsb: 4 },
      { date: "2026-03-27", sport: "bike", tsb: 8 },
      { date: "2026-03-28", sport: "bike", tsb: 10 },
      { date: "2026-03-29", sport: "bike", tsb: 12 },  // latestTsb bike = 12
    ];
    const runRows: FitnessRow[] = [
      { date: "2026-03-24", sport: "run", tsb: 10 },
      { date: "2026-03-25", sport: "run", tsb: 8 },
      { date: "2026-03-26", sport: "run", tsb: 5 },
      { date: "2026-03-27", sport: "run", tsb: 0 },
      { date: "2026-03-28", sport: "run", tsb: -3 },
      { date: "2026-03-29", sport: "run", tsb: -5 },   // latestTsb run = -5
    ];

    const supabase = mockSupabase([...swimRows, ...bikeRows, ...runRows]);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);

    expect(result).toHaveLength(1);
    const { tsbValues } = result[0];

    // All three classified sports appear in tsbValues
    expect(tsbValues).toHaveProperty("swim");
    expect(tsbValues).toHaveProperty("bike");
    expect(tsbValues).toHaveProperty("run");

    // Each value is the last element in its sport's row list
    expect(tsbValues["swim"]).toBe(8);
    expect(tsbValues["bike"]).toBe(12);
    expect(tsbValues["run"]).toBe(-5);
  });

  // -------------------------------------------------------------------------
  // Additional: only 1 stable sport alongside the declining one still triggers
  // -------------------------------------------------------------------------
  it("returns a signal when 1 sport declining and only 1 other sport is stable (2 sports total)", async () => {
    // Only swim and run have enough data; bike has < 3 rows and is skipped.
    const rows: FitnessRow[] = [
      ...makeRows("swim", 5, 5, 6),       // stable
      ...makeRows("run", 20, -10, 6),     // declining
      // bike: only 2 rows — below the 3-row threshold, skipped
      { date: "2026-03-24", sport: "bike", tsb: 10 },
      { date: "2026-03-25", sport: "bike", tsb: 10 },
    ];
    const supabase = mockSupabase(rows);
    const result = await detectDisciplineSpecificDecline(supabase, USER_ID);

    // declining.length === 1, stableOrRising.length === 1 (≥ 1)  →  should fire
    expect(result).toHaveLength(1);
    expect(result[0].sports).toEqual(["run"]);
  });
});
