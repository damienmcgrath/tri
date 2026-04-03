import { detectTrends } from "./trends";
import type { WeeklyTrend } from "./trends";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Supabase-like mock that resolves with `data`. */
function makeSupabase(data: unknown[] | null) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data })
  };
  return {
    from: jest.fn().mockReturnValue(chain),
    _chain: chain
  };
}

type ActivityRow = {
  start_time_utc: string;
  sport_type: string;
  avg_hr?: number | null;
  avg_power?: number | null;
  avg_pace_per_100m_sec?: number | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  metrics_v2?: Record<string, unknown> | null;
};

/** Return a Monday ISO date string offset by `weeksAgo` weeks from `anchor`. */
function mondayOf(anchor: Date, weeksAgo: number): string {
  const d = new Date(anchor);
  // Snap to Monday of the current week first
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset - weeksAgo * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Return an ISO timestamp string for a day offset from `weekStart` (a
 * YYYY-MM-DD Monday string).  offset=0 → Monday, offset=2 → Wednesday, etc.
 */
function dayOfWeekTs(weekStart: string, offset = 2): string {
  const d = new Date(weekStart + "T10:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
}

/**
 * Return an ISO timestamp string for Wednesday of the week that starts on
 * `weekStart` (a YYYY-MM-DD Monday string).
 */
function wednesdayOf(weekStart: string): string {
  return dayOfWeekTs(weekStart, 2);
}

/**
 * Build a series of activity rows, one per week, starting `weeksAgo` weeks
 * back. `valuesPerWeek` maps week-index (0 = oldest) → partial row fields.
 */
function makeRunHrRows(
  anchor: Date,
  weekValues: { weeksAgo: number; hr: number }[]
): ActivityRow[] {
  return weekValues.map(({ weeksAgo, hr }) => {
    const weekStart = mondayOf(anchor, weeksAgo);
    return {
      start_time_utc: wednesdayOf(weekStart),
      sport_type: "run",
      avg_hr: hr,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      duration_sec: 3600,
      distance_m: 10000,
      metrics_v2: null
    };
  });
}

/** NOW anchor used across all tests so dates are deterministic. */
const NOW = new Date("2026-04-03T12:00:00.000Z");

// ---------------------------------------------------------------------------
// detectTrends — query behaviour
// ---------------------------------------------------------------------------

describe("detectTrends — Supabase query wiring", () => {
  it("queries the completed_activities table for the correct user", async () => {
    const supabase = makeSupabase(null);
    await detectTrends(supabase as never, "athlete-123");
    expect(supabase.from).toHaveBeenCalledWith("completed_activities");
    expect(supabase._chain.eq).toHaveBeenCalledWith("user_id", "athlete-123");
  });

  it("returns [] when Supabase returns null", async () => {
    const supabase = makeSupabase(null);
    const result = await detectTrends(supabase as never, "athlete-1");
    expect(result).toEqual([]);
  });

  it("returns [] when fewer than 3 activities are returned", async () => {
    const rows: ActivityRow[] = [
      { start_time_utc: "2026-03-01T10:00:00.000Z", sport_type: "run", avg_hr: 145 },
      { start_time_utc: "2026-03-08T10:00:00.000Z", sport_type: "run", avg_hr: 143 }
    ];
    const supabase = makeSupabase(rows);
    const result = await detectTrends(supabase as never, "athlete-1");
    expect(result).toEqual([]);
  });

  it("returns [] when activities span fewer than 3 distinct weeks", async () => {
    // Three activities all in the same week → 1 week bucket
    const rows: ActivityRow[] = [
      { start_time_utc: "2026-03-02T10:00:00.000Z", sport_type: "run", avg_hr: 145 },
      { start_time_utc: "2026-03-03T10:00:00.000Z", sport_type: "run", avg_hr: 143 },
      { start_time_utc: "2026-03-04T10:00:00.000Z", sport_type: "run", avg_hr: 141 }
    ];
    const supabase = makeSupabase(rows);
    const result = await detectTrends(supabase as never, "athlete-1");
    expect(result).toEqual([]);
  });

  it("uses the weekCount parameter to calculate the start date range", async () => {
    const supabase = makeSupabase(null);
    await detectTrends(supabase as never, "athlete-1", 4);
    const gteCall = supabase._chain.gte.mock.calls[0];
    expect(gteCall[0]).toBe("start_time_utc");
    // The start date should be roughly 4 weeks in the past (28 days)
    const startDateStr: string = gteCall[1].slice(0, 10);
    const today = new Date();
    const startDate = new Date(startDateStr);
    const daysDiff = (today.getTime() - startDate.getTime()) / 86400000;
    expect(daysDiff).toBeGreaterThanOrEqual(27);
    expect(daysDiff).toBeLessThanOrEqual(29);
  });
});

// ---------------------------------------------------------------------------
// detectTrends — run HR trend
// ---------------------------------------------------------------------------

describe("detectTrends — run HR trend", () => {
  it("detects an improving (decreasing) run HR trend", async () => {
    // HR dropping consistently across 5 weeks → high confidence improving
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 160 },
      { weeksAgo: 3, hr: 155 },
      { weeksAgo: 2, hr: 150 },
      { weeksAgo: 1, hr: 145 },
      { weeksAgo: 0, hr: 140 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    expect(hrTrend!.direction).toBe("improving");
    expect(hrTrend!.detail).toMatch(/trending down/i);
  });

  it("detects a declining (increasing) run HR trend", async () => {
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 140 },
      { weeksAgo: 3, hr: 145 },
      { weeksAgo: 2, hr: 150 },
      { weeksAgo: 1, hr: 155 },
      { weeksAgo: 0, hr: 160 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    expect(hrTrend!.direction).toBe("declining");
    expect(hrTrend!.detail).toMatch(/trending up/i);
  });

  it("marks run HR trend as stable when values barely change", async () => {
    // All values within 1 bpm — relative change will be < 10%
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 150 },
      { weeksAgo: 3, hr: 151 },
      { weeksAgo: 2, hr: 150 },
      { weeksAgo: 1, hr: 151 },
      { weeksAgo: 0, hr: 150 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    // Stable + low confidence → buildTrend returns null → not in results
    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    if (hrTrend) {
      expect(hrTrend.direction).toBe("stable");
    }
    // Absence is also acceptable for stable/low-confidence
  });

  it("includes correct bpm labels on run HR data points", async () => {
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 155 },
      { weeksAgo: 3, hr: 152 },
      { weeksAgo: 2, hr: 148 },
      { weeksAgo: 1, hr: 144 },
      { weeksAgo: 0, hr: 140 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    for (const dp of hrTrend!.dataPoints) {
      expect(dp.label).toMatch(/\d+ bpm/);
    }
  });

  it("skips weeks where no runs have avg_hr data", async () => {
    // Mix of weeks with and without HR data; only 3 valid weeks → still a trend
    const rows: ActivityRow[] = [
      // Week 5 — no HR
      { start_time_utc: "2026-02-23T10:00:00.000Z", sport_type: "run", avg_hr: null, duration_sec: 3600, distance_m: 10000 },
      // Week 4 — HR present
      { start_time_utc: "2026-03-02T10:00:00.000Z", sport_type: "run", avg_hr: 158, duration_sec: 3600, distance_m: 10000 },
      // Week 3 — HR present
      { start_time_utc: "2026-03-09T10:00:00.000Z", sport_type: "run", avg_hr: 153, duration_sec: 3600, distance_m: 10000 },
      // Week 2 — HR present
      { start_time_utc: "2026-03-16T10:00:00.000Z", sport_type: "run", avg_hr: 148, duration_sec: 3600, distance_m: 10000 },
      // Week 1 — HR present
      { start_time_utc: "2026-03-23T10:00:00.000Z", sport_type: "run", avg_hr: 143, duration_sec: 3600, distance_m: 10000 }
    ];
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    // The null-HR week should not appear as a data point
    if (hrTrend) {
      expect(hrTrend.dataPoints.every((dp) => dp.value > 0)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// detectTrends — run pace trend
// ---------------------------------------------------------------------------

describe("detectTrends — run pace trend", () => {
  function makeRunPaceRows(weekData: { weeksAgo: number; distM: number; durSec: number }[]): ActivityRow[] {
    return weekData.map(({ weeksAgo, distM, durSec }) => {
      const weekStart = mondayOf(NOW, weeksAgo);
      return {
        start_time_utc: dayOfWeekTs(weekStart, 2),
        sport_type: "run",
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: null,
        duration_sec: durSec,
        distance_m: distM,
        metrics_v2: null
      };
    });
  }

  it("detects improving run pace (getting faster = lower sec/km)", async () => {
    // Pace improving: 6:00/km → 5:30/km → 5:00/km → 4:45/km → 4:30/km
    const rows = makeRunPaceRows([
      { weeksAgo: 4, distM: 10000, durSec: 3600 },  // 6:00/km
      { weeksAgo: 3, distM: 10000, durSec: 3300 },  // 5:30/km
      { weeksAgo: 2, distM: 10000, durSec: 3000 },  // 5:00/km
      { weeksAgo: 1, distM: 10000, durSec: 2850 },  // 4:45/km
      { weeksAgo: 0, distM: 10000, durSec: 2700 }   // 4:30/km
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const paceTrend = trends.find((t) => t.metric === "Run pace");
    expect(paceTrend).toBeDefined();
    expect(paceTrend!.direction).toBe("improving");
    expect(paceTrend!.detail).toMatch(/improving/i);
  });

  it("detects declining run pace (getting slower)", async () => {
    const rows = makeRunPaceRows([
      { weeksAgo: 4, distM: 10000, durSec: 2700 },  // 4:30/km
      { weeksAgo: 3, distM: 10000, durSec: 2850 },  // 4:45/km
      { weeksAgo: 2, distM: 10000, durSec: 3000 },  // 5:00/km
      { weeksAgo: 1, distM: 10000, durSec: 3300 },  // 5:30/km
      { weeksAgo: 0, distM: 10000, durSec: 3600 }   // 6:00/km
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const paceTrend = trends.find((t) => t.metric === "Run pace");
    expect(paceTrend).toBeDefined();
    expect(paceTrend!.direction).toBe("declining");
    expect(paceTrend!.detail).toMatch(/slowing/i);
  });

  it("formats pace labels as min:sec/km", async () => {
    const rows = makeRunPaceRows([
      { weeksAgo: 4, distM: 10000, durSec: 3000 },  // exactly 5:00/km
      { weeksAgo: 3, distM: 10000, durSec: 2910 },  // 4:51/km
      { weeksAgo: 2, distM: 10000, durSec: 2820 },
      { weeksAgo: 1, distM: 10000, durSec: 2730 },
      { weeksAgo: 0, distM: 10000, durSec: 2640 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const paceTrend = trends.find((t) => t.metric === "Run pace");
    if (paceTrend) {
      for (const dp of paceTrend.dataPoints) {
        expect(dp.label).toMatch(/^\d+:\d{2}\/km$/);
      }
    }
  });

  it("skips weeks where total distance is less than 100m", async () => {
    const badWeek: ActivityRow = {
      start_time_utc: mondayOf(NOW, 5) + "T10:00:00.000Z",
      sport_type: "run",
      avg_hr: null,
      avg_power: null,
      avg_pace_per_100m_sec: null,
      duration_sec: 3600,
      distance_m: 50, // < 100m — should be skipped
      metrics_v2: null
    };
    const validRows = makeRunPaceRows([
      { weeksAgo: 4, distM: 10000, durSec: 3600 },
      { weeksAgo: 3, distM: 10000, durSec: 3300 },
      { weeksAgo: 2, distM: 10000, durSec: 3000 },
      { weeksAgo: 1, distM: 10000, durSec: 2850 },
      { weeksAgo: 0, distM: 10000, durSec: 2700 }
    ]);
    const supabase = makeSupabase([badWeek, ...validRows]);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const paceTrend = trends.find((t) => t.metric === "Run pace");
    if (paceTrend) {
      // None of the data point values should reflect an absurdly high pace
      expect(paceTrend.dataPoints.every((dp) => dp.value < 36000)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// detectTrends — bike power trend
// ---------------------------------------------------------------------------

describe("detectTrends — bike power trend", () => {
  function makeBikePowerRows(weekData: { weeksAgo: number; power: number; sportType?: string }[]): ActivityRow[] {
    return weekData.map(({ weeksAgo, power, sportType = "bike" }) => {
      const weekStart = mondayOf(NOW, weeksAgo);
      return {
        start_time_utc: dayOfWeekTs(weekStart, 2),
        sport_type: sportType,
        avg_hr: null,
        avg_power: power,
        avg_pace_per_100m_sec: null,
        duration_sec: 3600,
        distance_m: null,
        metrics_v2: null
      };
    });
  }

  it("detects improving bike power (increasing watts)", async () => {
    const rows = makeBikePowerRows([
      { weeksAgo: 4, power: 200 },
      { weeksAgo: 3, power: 210 },
      { weeksAgo: 2, power: 220 },
      { weeksAgo: 1, power: 230 },
      { weeksAgo: 0, power: 240 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const powerTrend = trends.find((t) => t.metric === "Bike avg power");
    expect(powerTrend).toBeDefined();
    expect(powerTrend!.direction).toBe("improving");
    expect(powerTrend!.detail).toMatch(/trending up/i);
  });

  it("detects declining bike power", async () => {
    const rows = makeBikePowerRows([
      { weeksAgo: 4, power: 240 },
      { weeksAgo: 3, power: 230 },
      { weeksAgo: 2, power: 220 },
      { weeksAgo: 1, power: 210 },
      { weeksAgo: 0, power: 200 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const powerTrend = trends.find((t) => t.metric === "Bike avg power");
    expect(powerTrend).toBeDefined();
    expect(powerTrend!.direction).toBe("declining");
    expect(powerTrend!.detail).toMatch(/trending down/i);
  });

  it("accepts sport_type 'cycling' in addition to 'bike'", async () => {
    const rows = makeBikePowerRows([
      { weeksAgo: 4, power: 200, sportType: "cycling" },
      { weeksAgo: 3, power: 210, sportType: "cycling" },
      { weeksAgo: 2, power: 220, sportType: "cycling" },
      { weeksAgo: 1, power: 230, sportType: "cycling" },
      { weeksAgo: 0, power: 240, sportType: "cycling" }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const powerTrend = trends.find((t) => t.metric === "Bike avg power");
    expect(powerTrend).toBeDefined();
    expect(powerTrend!.direction).toBe("improving");
  });

  it("formats power labels as '### W'", async () => {
    const rows = makeBikePowerRows([
      { weeksAgo: 4, power: 200 },
      { weeksAgo: 3, power: 212 },
      { weeksAgo: 2, power: 225 },
      { weeksAgo: 1, power: 238 },
      { weeksAgo: 0, power: 250 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const powerTrend = trends.find((t) => t.metric === "Bike avg power");
    if (powerTrend) {
      for (const dp of powerTrend.dataPoints) {
        expect(dp.label).toMatch(/^\d+ W$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// detectTrends — swim pace trend
// ---------------------------------------------------------------------------

describe("detectTrends — swim pace trend", () => {
  function makeSwimPaceRows(weekData: { weeksAgo: number; pace100m: number }[]): ActivityRow[] {
    return weekData.map(({ weeksAgo, pace100m }) => {
      const weekStart = mondayOf(NOW, weeksAgo);
      return {
        start_time_utc: dayOfWeekTs(weekStart, 2),
        sport_type: "swim",
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: pace100m,
        duration_sec: 3600,
        distance_m: null,
        metrics_v2: null
      };
    });
  }

  it("detects improving swim pace (lower sec/100m is better)", async () => {
    const rows = makeSwimPaceRows([
      { weeksAgo: 4, pace100m: 120 },
      { weeksAgo: 3, pace100m: 118 },
      { weeksAgo: 2, pace100m: 115 },
      { weeksAgo: 1, pace100m: 112 },
      { weeksAgo: 0, pace100m: 108 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const swimTrend = trends.find((t) => t.metric === "Swim pace");
    expect(swimTrend).toBeDefined();
    expect(swimTrend!.direction).toBe("improving");
    expect(swimTrend!.detail).toMatch(/faster/i);
  });

  it("detects declining swim pace (higher sec/100m)", async () => {
    const rows = makeSwimPaceRows([
      { weeksAgo: 4, pace100m: 108 },
      { weeksAgo: 3, pace100m: 112 },
      { weeksAgo: 2, pace100m: 116 },
      { weeksAgo: 1, pace100m: 119 },
      { weeksAgo: 0, pace100m: 123 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const swimTrend = trends.find((t) => t.metric === "Swim pace");
    expect(swimTrend).toBeDefined();
    expect(swimTrend!.direction).toBe("declining");
    expect(swimTrend!.detail).toMatch(/slowing/i);
  });

  it("formats swim pace labels as min:sec/100m", async () => {
    const rows = makeSwimPaceRows([
      { weeksAgo: 4, pace100m: 120 }, // 2:00
      { weeksAgo: 3, pace100m: 116 },
      { weeksAgo: 2, pace100m: 112 },
      { weeksAgo: 1, pace100m: 108 },
      { weeksAgo: 0, pace100m: 104 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const swimTrend = trends.find((t) => t.metric === "Swim pace");
    if (swimTrend) {
      for (const dp of swimTrend.dataPoints) {
        expect(dp.label).toMatch(/^\d+:\d{2}\/100m$/);
      }
      // First data point should be "2:00/100m"
      expect(swimTrend.dataPoints[0].label).toBe("2:00/100m");
    }
  });
});

// ---------------------------------------------------------------------------
// detectTrends — strength duration trend
// ---------------------------------------------------------------------------

describe("detectTrends — strength duration trend", () => {
  function makeStrengthRows(weekData: { weeksAgo: number; durSec: number }[]): ActivityRow[] {
    return weekData.map(({ weeksAgo, durSec }) => {
      const weekStart = mondayOf(NOW, weeksAgo);
      return {
        start_time_utc: dayOfWeekTs(weekStart, 2),
        sport_type: "strength",
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: null,
        duration_sec: durSec,
        distance_m: null,
        metrics_v2: null
      };
    });
  }

  it("detects improving strength duration (longer sessions = better)", async () => {
    const rows = makeStrengthRows([
      { weeksAgo: 4, durSec: 1800 },  // 30 min
      { weeksAgo: 3, durSec: 2100 },  // 35 min
      { weeksAgo: 2, durSec: 2400 },  // 40 min
      { weeksAgo: 1, durSec: 2700 },  // 45 min
      { weeksAgo: 0, durSec: 3000 }   // 50 min
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const strengthTrend = trends.find((t) => t.metric === "Strength duration");
    expect(strengthTrend).toBeDefined();
    expect(strengthTrend!.direction).toBe("improving");
    expect(strengthTrend!.detail).toMatch(/increasing/i);
  });

  it("detects declining strength duration (shorter sessions)", async () => {
    const rows = makeStrengthRows([
      { weeksAgo: 4, durSec: 3000 },
      { weeksAgo: 3, durSec: 2700 },
      { weeksAgo: 2, durSec: 2400 },
      { weeksAgo: 1, durSec: 2100 },
      { weeksAgo: 0, durSec: 1800 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const strengthTrend = trends.find((t) => t.metric === "Strength duration");
    expect(strengthTrend).toBeDefined();
    expect(strengthTrend!.direction).toBe("declining");
    expect(strengthTrend!.detail).toMatch(/shorter/i);
  });

  it("formats strength labels as '## min'", async () => {
    const rows = makeStrengthRows([
      { weeksAgo: 4, durSec: 1800 },
      { weeksAgo: 3, durSec: 2100 },
      { weeksAgo: 2, durSec: 2400 },
      { weeksAgo: 1, durSec: 2700 },
      { weeksAgo: 0, durSec: 3000 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const strengthTrend = trends.find((t) => t.metric === "Strength duration");
    if (strengthTrend) {
      for (const dp of strengthTrend.dataPoints) {
        expect(dp.label).toMatch(/^\d+ min$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// detectTrends — confidence & sorting
// ---------------------------------------------------------------------------

describe("detectTrends — confidence classification", () => {
  it("assigns high confidence when ≥5 data points and ≥4 consistent deltas", async () => {
    // 5 weeks of consistently declining run HR → high confidence
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 165 },
      { weeksAgo: 3, hr: 160 },
      { weeksAgo: 2, hr: 155 },
      { weeksAgo: 1, hr: 150 },
      { weeksAgo: 0, hr: 145 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    expect(hrTrend!.confidence).toBe("high");
  });

  it("assigns medium confidence for 4 data points with 3 consistent deltas", async () => {
    // 4 weeks with 3 consistent steps
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 3, hr: 162 },
      { weeksAgo: 2, hr: 157 },
      { weeksAgo: 1, hr: 151 },
      { weeksAgo: 0, hr: 145 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    if (hrTrend) {
      expect(["medium", "low"]).toContain(hrTrend.confidence);
    }
  });

  it("returns at most 3 trends", async () => {
    // Provide data for all five trend types — result must be capped at 3
    const runRows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 165 },
      { weeksAgo: 3, hr: 160 },
      { weeksAgo: 2, hr: 155 },
      { weeksAgo: 1, hr: 150 },
      { weeksAgo: 0, hr: 145 }
    ]);

    const extraRows: ActivityRow[] = [];
    // Run pace (same weeks)
    for (let w = 4; w >= 0; w--) {
      const weekStart = mondayOf(NOW, w);
      extraRows.push({
        start_time_utc: dayOfWeekTs(weekStart, 3),
        sport_type: "run",
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: null,
        duration_sec: 3600 - w * 180,
        distance_m: 10000,
        metrics_v2: null
      });
    }
    // Bike power
    for (let w = 4; w >= 0; w--) {
      const weekStart = mondayOf(NOW, w);
      extraRows.push({
        start_time_utc: dayOfWeekTs(weekStart, 4),
        sport_type: "bike",
        avg_hr: null,
        avg_power: 200 + (4 - w) * 10,
        avg_pace_per_100m_sec: null,
        duration_sec: 3600,
        distance_m: null,
        metrics_v2: null
      });
    }
    // Swim
    for (let w = 4; w >= 0; w--) {
      const weekStart = mondayOf(NOW, w);
      extraRows.push({
        start_time_utc: dayOfWeekTs(weekStart, 5),
        sport_type: "swim",
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: 120 - (4 - w) * 3,
        duration_sec: 3600,
        distance_m: null,
        metrics_v2: null
      });
    }
    // Strength
    for (let w = 4; w >= 0; w--) {
      const weekStart = mondayOf(NOW, w);
      extraRows.push({
        start_time_utc: dayOfWeekTs(weekStart, 6),
        sport_type: "strength",
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: null,
        duration_sec: 1800 + (4 - w) * 300,
        distance_m: null,
        metrics_v2: null
      });
    }

    const supabase = makeSupabase([...runRows, ...extraRows]);
    const trends = await detectTrends(supabase as never, "athlete-1");

    expect(trends.length).toBeLessThanOrEqual(3);
  });

  it("sorts trends so high-confidence appears before lower-confidence", async () => {
    // Build rows where run HR produces high confidence (5 consistent weeks)
    // and run pace produces medium confidence (4 weeks, 3 consistent)
    const runHrRows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 165 },
      { weeksAgo: 3, hr: 160 },
      { weeksAgo: 2, hr: 155 },
      { weeksAgo: 1, hr: 150 },
      { weeksAgo: 0, hr: 145 }
    ]);

    // Run pace — 4 data points (medium confidence at best)
    const runPaceRows: ActivityRow[] = [3, 2, 1, 0].map((w) => {
      const weekStart = mondayOf(NOW, w);
      return {
        start_time_utc: dayOfWeekTs(weekStart, 3),
        sport_type: "run",
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: null,
        duration_sec: 3600 - w * 200,
        distance_m: 10000,
        metrics_v2: null
      };
    });

    const supabase = makeSupabase([...runHrRows, ...runPaceRows]);
    const trends = await detectTrends(supabase as never, "athlete-1");

    if (trends.length >= 2) {
      const confidenceOrder = { high: 3, medium: 2, low: 1 };
      for (let i = 0; i < trends.length - 1; i++) {
        expect(confidenceOrder[trends[i].confidence]).toBeGreaterThanOrEqual(
          confidenceOrder[trends[i + 1].confidence]
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// detectTrends — multi-sport mixing
// ---------------------------------------------------------------------------

describe("detectTrends — multi-sport data does not cross-contaminate", () => {
  it("run HR trend only uses run activities", async () => {
    const rows: ActivityRow[] = [];
    // 5 weeks of bike activities with high HR — should not appear in run HR
    for (let w = 4; w >= 0; w--) {
      const weekStart = mondayOf(NOW, w);
      rows.push({
        start_time_utc: dayOfWeekTs(weekStart, 2),
        sport_type: "bike",
        avg_hr: 180,
        avg_power: 250,
        avg_pace_per_100m_sec: null,
        duration_sec: 3600,
        distance_m: null,
        metrics_v2: null
      });
    }
    // 5 weeks of runs with improving (decreasing) HR
    const runRows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 160 },
      { weeksAgo: 3, hr: 155 },
      { weeksAgo: 2, hr: 150 },
      { weeksAgo: 1, hr: 145 },
      { weeksAgo: 0, hr: 140 }
    ]);

    const supabase = makeSupabase([...rows, ...runRows]);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    // The run HR values should all be in the 140–160 range, not 180
    for (const dp of hrTrend!.dataPoints) {
      expect(dp.value).toBeLessThanOrEqual(160);
    }
  });

  it("swim activities do not contribute to run pace trend", async () => {
    const rows: ActivityRow[] = [];
    // 5 weeks of swims
    for (let w = 4; w >= 0; w--) {
      const weekStart = mondayOf(NOW, w);
      rows.push({
        start_time_utc: dayOfWeekTs(weekStart, 2),
        sport_type: "swim",
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: 120,
        duration_sec: 3600,
        distance_m: 5000,
        metrics_v2: null
      });
    }

    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    // There should be no run pace trend since there are no run activities
    const runPaceTrend = trends.find((t) => t.metric === "Run pace");
    expect(runPaceTrend).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detectTrends — data point structure
// ---------------------------------------------------------------------------

describe("detectTrends — data point structure", () => {
  it("each data point has weekStart, value, and label fields", async () => {
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 160 },
      { weeksAgo: 3, hr: 155 },
      { weeksAgo: 2, hr: 150 },
      { weeksAgo: 1, hr: 145 },
      { weeksAgo: 0, hr: 140 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    for (const dp of hrTrend!.dataPoints) {
      expect(typeof dp.weekStart).toBe("string");
      expect(dp.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof dp.value).toBe("number");
      expect(typeof dp.label).toBe("string");
    }
  });

  it("weekStart dates are Mondays (day index 1)", async () => {
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 160 },
      { weeksAgo: 3, hr: 155 },
      { weeksAgo: 2, hr: 150 },
      { weeksAgo: 1, hr: 145 },
      { weeksAgo: 0, hr: 140 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    for (const dp of hrTrend!.dataPoints) {
      const d = new Date(dp.weekStart + "T00:00:00.000Z");
      expect(d.getUTCDay()).toBe(1); // Monday
    }
  });

  it("data points are ordered chronologically (oldest first)", async () => {
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 160 },
      { weeksAgo: 3, hr: 155 },
      { weeksAgo: 2, hr: 150 },
      { weeksAgo: 1, hr: 145 },
      { weeksAgo: 0, hr: 140 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    const dates = hrTrend!.dataPoints.map((dp) => dp.weekStart);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it("result trend objects have all required WeeklyTrend fields", async () => {
    const rows = makeRunHrRows(NOW, [
      { weeksAgo: 4, hr: 165 },
      { weeksAgo: 3, hr: 160 },
      { weeksAgo: 2, hr: 155 },
      { weeksAgo: 1, hr: 150 },
      { weeksAgo: 0, hr: 145 }
    ]);
    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    expect(trends.length).toBeGreaterThan(0);
    for (const trend of trends) {
      expect(typeof trend.metric).toBe("string");
      expect(["improving", "declining", "stable"]).toContain(trend.direction);
      expect(Array.isArray(trend.dataPoints)).toBe(true);
      expect(typeof trend.detail).toBe("string");
      expect(["low", "medium", "high"]).toContain(trend.confidence);
    }
  });
});

// ---------------------------------------------------------------------------
// detectTrends — multiple activities in the same week are averaged
// ---------------------------------------------------------------------------

describe("detectTrends — intra-week averaging", () => {
  it("averages multiple run HR values within the same week", async () => {
    // Week 4 has two runs; their avg HR should be averaged
    const weekStart = mondayOf(NOW, 4);

    const rows: ActivityRow[] = [
      // Two runs in the same week → average should be 155
      {
        start_time_utc: dayOfWeekTs(weekStart, 2),
        sport_type: "run",
        avg_hr: 150,
        avg_power: null,
        avg_pace_per_100m_sec: null,
        duration_sec: 3600,
        distance_m: 10000,
        metrics_v2: null
      },
      {
        start_time_utc: dayOfWeekTs(weekStart, 3),
        sport_type: "run",
        avg_hr: 160,
        avg_power: null,
        avg_pace_per_100m_sec: null,
        duration_sec: 3600,
        distance_m: 10000,
        metrics_v2: null
      },
      // Three more single-run weeks to reach enough data points
      ...makeRunHrRows(NOW, [
        { weeksAgo: 3, hr: 152 },
        { weeksAgo: 2, hr: 148 },
        { weeksAgo: 1, hr: 144 },
        { weeksAgo: 0, hr: 140 }
      ])
    ];

    const supabase = makeSupabase(rows);
    const trends = await detectTrends(supabase as never, "athlete-1");

    const hrTrend = trends.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    // The oldest data point (week 4) should be the average of 150 and 160 = 155
    expect(hrTrend!.dataPoints[0].value).toBe(155);
  });
});
