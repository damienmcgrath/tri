/**
 * Tests for fatigue-detection.ts
 *
 * Coverage targets: all exported functions, edge cases (no data, single data
 * point, sparse data), boundary conditions on TSB thresholds and severity
 * levels, and the discipline-specific vs cross-discipline discrimination logic.
 */

import {
  detectCrossDisciplineFatigue,
  detectDisciplineSpecificDecline,
  type FatigueSignal
} from "./fatigue-detection";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Supabase mock that returns the given rows from any query. */
function mockSupabase(rows: Array<{ date: string; sport: string; tsb: number }> | null): SupabaseClient {
  const builder: Record<string, unknown> = {};

  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    in: () => chain,
    order: () => Promise.resolve({ data: rows, error: null })
  };

  builder.from = () => chain;

  return builder as unknown as SupabaseClient;
}

/** Generate N rows for a sport with TSB values as supplied. */
function rows(sport: string, tsbValues: number[], startDate = "2026-03-01"): Array<{ date: string; sport: string; tsb: number }> {
  return tsbValues.map((tsb, i) => {
    const d = new Date(`${startDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), sport, tsb };
  });
}

// ---------------------------------------------------------------------------
// detectCrossDisciplineFatigue
// ---------------------------------------------------------------------------

describe("detectCrossDisciplineFatigue", () => {
  const USER = "user-1";

  it("returns null when no rows are returned", async () => {
    const supabase = mockSupabase([]);
    const result = await detectCrossDisciplineFatigue(supabase, USER);
    expect(result).toBeNull();
  });

  it("returns null when the database returns null data", async () => {
    const supabase = mockSupabase(null);
    const result = await detectCrossDisciplineFatigue(supabase, USER);
    expect(result).toBeNull();
  });

  it("returns null when fewer than 3 data points exist per sport (insufficient for trend)", async () => {
    // Only 2 rows per sport — length < 3 guard skips them
    const data = [
      ...rows("swim", [10, 5]),
      ...rows("bike", [10, 5]),
      ...rows("run", [10, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER);
    expect(result).toBeNull();
  });

  it("returns null when only one sport is declining", async () => {
    // swim: 10 → 3 (big drop), bike: 5 → 5 (stable), run: 8 → 9 (rising)
    const data = [
      ...rows("swim", [10, 10, 10, 3, 3, 3]),
      ...rows("bike", [5, 5, 5, 5, 5, 5]),
      ...rows("run", [8, 8, 8, 9, 9, 9])
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER);
    expect(result).toBeNull();
  });

  it("returns null when TSB drop is exactly at the threshold (not below -5)", async () => {
    // avgFirst = 10, avgSecond = 5 → delta = -5 (not < -5, so not declining)
    const data = [
      ...rows("swim", [10, 10, 10, 5, 5, 5]),
      ...rows("bike", [10, 10, 10, 5, 5, 5]),
      ...rows("run", [10, 10, 10, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER);
    expect(result).toBeNull();
  });

  it("returns a warning signal when exactly 2 sports are declining", async () => {
    // swim + bike declining (drop > 5), run stable
    const data = [
      ...rows("swim", [10, 10, 10, 3, 3, 3]),   // delta = -7
      ...rows("bike", [12, 12, 12, 4, 4, 4]),   // delta = -8
      ...rows("run", [5, 5, 5, 5, 5, 5])         // delta = 0
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("cross_discipline");
    expect(result!.severity).toBe("warning");
    expect(result!.sports).toHaveLength(2);
    expect(result!.sports).toContain("swim");
    expect(result!.sports).toContain("bike");
  });

  it("returns an alert signal when all 3 sports are declining", async () => {
    // All three sports show a drop of more than 5 points
    const data = [
      ...rows("swim", [15, 15, 15, 7, 7, 7]),   // delta = -8
      ...rows("bike", [20, 20, 20, 12, 12, 12]), // delta = -8
      ...rows("run", [10, 10, 10, 2, 2, 2])      // delta = -8
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER);

    expect(result).not.toBeNull();
    expect(result!.severity).toBe("alert");
    expect(result!.sports).toHaveLength(3);
  });

  it("includes tsbValues for all declining sports rounded to 1 decimal", async () => {
    const data = [
      ...rows("swim", [10, 10, 10, 2.55, 2.55, 2.55]),  // avgSecond = 2.55
      ...rows("bike", [15, 15, 15, 8, 8, 8]),             // avgSecond = 8
      ...rows("run", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER);

    expect(result).not.toBeNull();
    // tsbValues should be rounded to 1 decimal
    expect(result!.tsbValues["swim"]).toBe(2.6);
    expect(result!.tsbValues["bike"]).toBe(8);
  });

  it("detail string references the declining sports and lookback window", async () => {
    const data = [
      ...rows("swim", [10, 10, 10, 1, 1, 1]),
      ...rows("bike", [10, 10, 10, 1, 1, 1]),
      ...rows("run", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER, 10);

    expect(result!.detail).toContain("swim");
    expect(result!.detail).toContain("bike");
    expect(result!.detail).toContain("10 days");
    expect(result!.detail).toContain("systemic fatigue");
  });

  it("respects a custom lookbackDays parameter", async () => {
    // We just verify the function runs without error when lookbackDays differs
    const supabase = mockSupabase([]);
    const result = await detectCrossDisciplineFatigue(supabase, USER, 7);
    expect(result).toBeNull();
  });

  it("skips a sport that has exactly 2 rows (needs at least 3)", async () => {
    // bike only has 2 rows — should be ignored; only swim and run considered
    const data = [
      ...rows("swim", [10, 10, 10, 1, 1, 1]),
      { date: "2026-03-01", sport: "bike", tsb: 10 },
      { date: "2026-03-02", sport: "bike", tsb: 2 },
      ...rows("run", [10, 10, 10, 1, 1, 1])
    ];
    const supabase = mockSupabase(data);
    // Only swim + run are evaluated; bike is skipped
    // swim and run are both declining → still 2 → warning
    const result = await detectCrossDisciplineFatigue(supabase, USER);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
    expect(result!.sports).not.toContain("bike");
  });

  it("handles negative TSB values correctly", async () => {
    // Start already negative, then drop further
    const data = [
      ...rows("swim", [-5, -5, -5, -15, -15, -15]),  // delta = -10
      ...rows("bike", [-3, -3, -3, -12, -12, -12]),  // delta = -9
      ...rows("run", [-1, -1, -1, -1, -1, -1])        // stable
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("cross_discipline");
    expect(result!.tsbValues["swim"]).toBe(-15);
    expect(result!.tsbValues["bike"]).toBe(-12);
  });

  it("handles odd number of rows by flooring the split midpoint", async () => {
    // 7 rows: firstHalf = first 3, secondHalf = last 4
    // avgFirst of [10,10,10] = 10; avgSecond of [2,2,2,2] = 2 → delta = -8
    const swimData = rows("swim", [10, 10, 10, 2, 2, 2, 2]);
    const bikeData = rows("bike", [10, 10, 10, 2, 2, 2, 2]);
    const runData = rows("run", [5, 5, 5, 5, 5, 5, 5]);
    const supabase = mockSupabase([...swimData, ...bikeData, ...runData]);
    const result = await detectCrossDisciplineFatigue(supabase, USER);
    expect(result).not.toBeNull();
    expect(result!.sports).toContain("swim");
    expect(result!.sports).toContain("bike");
  });
});

// ---------------------------------------------------------------------------
// detectDisciplineSpecificDecline
// ---------------------------------------------------------------------------

describe("detectDisciplineSpecificDecline", () => {
  const USER = "user-2";

  it("returns empty array when no rows are returned", async () => {
    const supabase = mockSupabase([]);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toEqual([]);
  });

  it("returns empty array when the database returns null data", async () => {
    const supabase = mockSupabase(null);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toEqual([]);
  });

  it("returns empty array when fewer than 3 rows per sport (insufficient trend data)", async () => {
    const data = [
      ...rows("swim", [10, 2]),
      ...rows("bike", [10, 2]),
      ...rows("run", [10, 2])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toEqual([]);
  });

  it("returns empty array when all sports are stable", async () => {
    const data = [
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5]),
      ...rows("run", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toEqual([]);
  });

  it("returns empty array when all sports are declining (cross-discipline, not sport-specific)", async () => {
    const data = [
      ...rows("swim", [10, 10, 10, 2, 2, 2]),
      ...rows("bike", [10, 10, 10, 2, 2, 2]),
      ...rows("run", [10, 10, 10, 2, 2, 2])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toEqual([]);
  });

  it("returns empty array when two sports are declining (not exactly one)", async () => {
    const data = [
      ...rows("swim", [10, 10, 10, 2, 2, 2]),   // declining
      ...rows("bike", [10, 10, 10, 2, 2, 2]),   // declining
      ...rows("run", [5, 5, 5, 5, 5, 5])         // stable
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toEqual([]);
  });

  it("flags a single declining sport as discipline_specific with warning severity", async () => {
    // run declining; swim + bike stable
    const data = [
      ...rows("run", [10, 10, 10, 2, 2, 2]),    // delta = -8, latestTsb = 2
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    const signal = result[0];
    expect(signal.type).toBe("discipline_specific");
    expect(signal.severity).toBe("warning");
    expect(signal.sports).toEqual(["run"]);
  });

  it("issues an alert when the latest TSB of the declining sport is below -15", async () => {
    // run: first half avg = 5, second half avg = -17 → delta = -22 (declining)
    // latestTsb = -20 which is < -15 → alert
    const data = [
      ...rows("run", [5, 5, 5, -20, -20, -20]),
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("alert");
  });

  it("severity boundary: TSB exactly -15 is warning (not < -15)", async () => {
    const data = [
      ...rows("run", [5, 5, 5, -15, -15, -15]),  // latestTsb = -15
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
  });

  it("severity boundary: TSB of -15.1 triggers alert", async () => {
    const data = [
      ...rows("run", [5, 5, 5, -15.1, -15.1, -15.1]),
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("alert");
  });

  it("includes tsbValues for all sports that have sufficient data, rounded to 1 decimal", async () => {
    const data = [
      ...rows("run", [10, 10, 10, 2.567, 2.567, 2.567]),
      ...rows("swim", [8.123, 8.123, 8.123, 8.123, 8.123, 8.123]),
      ...rows("bike", [6, 6, 6, 6, 6, 6])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    const tsb = result[0].tsbValues;
    // latestTsb values are rounded to 1 decimal
    expect(tsb["run"]).toBe(2.6);    // last value 2.567 → 2.6
    expect(tsb["swim"]).toBe(8.1);   // last value 8.123 → 8.1
    expect(tsb["bike"]).toBe(6);
  });

  it("detail string names the declining sport and its rounded TSB", async () => {
    const data = [
      ...rows("bike", [10, 10, 10, 0, 0, 0]),   // latestTsb = 0, declining
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("run", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    expect(result[0].detail).toContain("bike");
    expect(result[0].detail).toContain("0");  // rounded TSB in detail
    expect(result[0].detail).toContain("recovery");
  });

  it("returns empty array when a rising sport exists but stableOrRising < 1 cannot happen here — single sport data", async () => {
    // Edge: only run has ≥ 3 rows, other sports are skipped (< 3 rows)
    // declining.length would be 1 (run) but stableOrRising.length = 0 → returns []
    const data = rows("run", [10, 10, 10, 2, 2, 2]);
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toEqual([]);
  });

  it("works with swim as the flagged sport", async () => {
    const data = [
      ...rows("swim", [15, 15, 15, 5, 5, 5]),   // delta = -10, latestTsb = 5
      ...rows("bike", [8, 8, 8, 8, 8, 8]),
      ...rows("run", [8, 8, 8, 8, 8, 8])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    expect(result[0].sports).toEqual(["swim"]);
    expect(result[0].type).toBe("discipline_specific");
  });

  it("works with bike as the flagged sport", async () => {
    const data = [
      ...rows("bike", [20, 20, 20, 8, 8, 8]),   // delta = -12
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("run", [5, 5, 5, 6, 6, 6])          // slightly rising but delta < 5 → stable
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    expect(result[0].sports).toEqual(["bike"]);
  });

  it("handles a rising sport alongside one declining sport", async () => {
    // run declining, swim rising, bike stable → exactly 1 declining, ≥1 stable/rising → signal
    const data = [
      ...rows("run", [10, 10, 10, 1, 1, 1]),     // declining
      ...rows("swim", [5, 5, 5, 12, 12, 12]),    // rising (delta > 5)
      ...rows("bike", [6, 6, 6, 6, 6, 6])         // stable
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);

    expect(result).toHaveLength(1);
    expect(result[0].sports).toEqual(["run"]);
  });

  it("TSB decline of exactly -5 is not flagged as declining (boundary condition)", async () => {
    // avgFirst = 10, avgSecond = 5 → delta = -5 (not < -5) → stable
    const data = [
      ...rows("run", [10, 10, 10, 5, 5, 5]),
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toEqual([]);
  });

  it("TSB decline of just below -5 is flagged as declining", async () => {
    // avgFirst ≈ 10, avgSecond ≈ 4.9 → delta ≈ -5.1 < -5 → declining
    const data = [
      ...rows("run", [10, 10, 10, 4.9, 4.9, 4.9]),
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toHaveLength(1);
    expect(result[0].sports).toEqual(["run"]);
  });

  it("uses the last value in the series as latestTsb for severity calculation", async () => {
    // The last value is -20 (alert), even though avg of second half might be less extreme
    const data = [
      ...rows("run", [5, 5, 5, -10, -10, -20]),  // latestTsb = -20 → alert
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectDisciplineSpecificDecline(supabase, USER);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("alert");
  });
});

// ---------------------------------------------------------------------------
// FatigueSignal type shape validation
// ---------------------------------------------------------------------------

describe("FatigueSignal shape", () => {
  const USER = "user-3";

  it("cross_discipline signal has all required fields", async () => {
    const data = [
      ...rows("swim", [10, 10, 10, 2, 2, 2]),
      ...rows("bike", [10, 10, 10, 2, 2, 2]),
      ...rows("run", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const result = await detectCrossDisciplineFatigue(supabase, USER);

    expect(result).toMatchObject<FatigueSignal>({
      type: "cross_discipline",
      severity: expect.stringMatching(/^(warning|alert)$/),
      sports: expect.any(Array),
      detail: expect.any(String),
      tsbValues: expect.any(Object)
    });
  });

  it("discipline_specific signal has all required fields", async () => {
    const data = [
      ...rows("run", [10, 10, 10, 2, 2, 2]),
      ...rows("swim", [5, 5, 5, 5, 5, 5]),
      ...rows("bike", [5, 5, 5, 5, 5, 5])
    ];
    const supabase = mockSupabase(data);
    const results = await detectDisciplineSpecificDecline(supabase, USER);

    expect(results[0]).toMatchObject<FatigueSignal>({
      type: "discipline_specific",
      severity: expect.stringMatching(/^(warning|alert)$/),
      sports: expect.any(Array),
      detail: expect.any(String),
      tsbValues: expect.any(Object)
    });
  });
});
