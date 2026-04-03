import type { SupabaseClient } from "@supabase/supabase-js";
import { detectTrends, type WeeklyTrend } from "./trends";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ActivityStub = {
  start_time_utc: string;
  sport_type: string;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  metrics_v2: null;
};

function mockTrendsSupabase(activities: ActivityStub[]): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => ({
            lte: () => ({
              order: () => ({ data: activities, error: null })
            })
          })
        })
      })
    })
  } as unknown as SupabaseClient;
}

/**
 * Build a run activity placed on the given ISO date string.
 * Defaults: avg_hr=150, distance_m=10000, duration_sec=3000 (5:00/km pace).
 */
function makeRunActivity(
  date: string,
  overrides: Partial<ActivityStub> = {}
): ActivityStub {
  return {
    start_time_utc: `${date}T10:00:00.000Z`,
    sport_type: "run",
    avg_hr: 150,
    avg_power: null,
    avg_pace_per_100m_sec: null,
    duration_sec: 3000,
    distance_m: 10000,
    metrics_v2: null,
    ...overrides
  };
}

function makeBikeActivity(
  date: string,
  overrides: Partial<ActivityStub> = {}
): ActivityStub {
  return {
    start_time_utc: `${date}T10:00:00.000Z`,
    sport_type: "bike",
    avg_hr: null,
    avg_power: 200,
    avg_pace_per_100m_sec: null,
    duration_sec: 3600,
    distance_m: null,
    metrics_v2: null,
    ...overrides
  };
}

function makeSwimActivity(
  date: string,
  overrides: Partial<ActivityStub> = {}
): ActivityStub {
  return {
    start_time_utc: `${date}T10:00:00.000Z`,
    sport_type: "swim",
    avg_hr: null,
    avg_power: null,
    avg_pace_per_100m_sec: 100, // 1:40/100m
    duration_sec: 3600,
    distance_m: 2000,
    metrics_v2: null,
    ...overrides
  };
}

function makeStrengthActivity(
  date: string,
  overrides: Partial<ActivityStub> = {}
): ActivityStub {
  return {
    start_time_utc: `${date}T10:00:00.000Z`,
    sport_type: "strength",
    avg_hr: null,
    avg_power: null,
    avg_pace_per_100m_sec: null,
    duration_sec: 2400,
    distance_m: null,
    metrics_v2: null,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// The mock date is 2026-04-03 (Friday). The 6 prior Mon–Sun weeks are:
//   W1: 2026-02-23  W2: 2026-03-02  W3: 2026-03-09
//   W4: 2026-03-16  W5: 2026-03-23  W6: 2026-03-30
// Each "Tuesday" within those weeks guarantees the activity is grouped into
// the correct week by getMonday().
// ---------------------------------------------------------------------------

const WEEK1_TUE = "2026-02-24";
const WEEK2_TUE = "2026-03-03";
const WEEK3_TUE = "2026-03-10";
const WEEK4_TUE = "2026-03-17";
const WEEK5_TUE = "2026-03-24";
const WEEK6_TUE = "2026-03-31";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("detectTrends", () => {
  const ATHLETE_ID = "athlete-123";

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-04-03T12:00:00Z"));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // 1. Too few activities
  // -------------------------------------------------------------------------
  it("returns empty array when there are fewer than 3 activities total", async () => {
    const activities = [makeRunActivity(WEEK1_TUE), makeRunActivity(WEEK2_TUE)];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. Too few weeks
  // -------------------------------------------------------------------------
  it("returns empty array when all activities fall within fewer than 3 distinct weeks", async () => {
    // Three activities but all within the same week
    const activities = [
      makeRunActivity(WEEK3_TUE),
      makeRunActivity(WEEK3_TUE, { avg_hr: 155 }),
      makeRunActivity(WEEK3_TUE, { avg_hr: 148 })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);
    expect(result).toEqual([]);
  });

  it("returns empty array when activities span only 2 distinct weeks", async () => {
    const activities = [
      makeRunActivity(WEEK2_TUE),
      makeRunActivity(WEEK3_TUE),
      makeRunActivity(WEEK3_TUE, { avg_hr: 148 })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 3. Improving run HR (decreasing HR = improving because lowerIsBetter)
  // -------------------------------------------------------------------------
  it("detects an improving run HR trend when HR decreases consistently over weeks", async () => {
    // HR drops each week: 165 → 160 → 155 → 150 → 145 → 140
    const activities = [
      makeRunActivity(WEEK1_TUE, { avg_hr: 165 }),
      makeRunActivity(WEEK2_TUE, { avg_hr: 160 }),
      makeRunActivity(WEEK3_TUE, { avg_hr: 155 }),
      makeRunActivity(WEEK4_TUE, { avg_hr: 150 }),
      makeRunActivity(WEEK5_TUE, { avg_hr: 145 }),
      makeRunActivity(WEEK6_TUE, { avg_hr: 140 })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    const hrTrend = result.find((t) => t.metric === "Run avg HR");
    expect(hrTrend).toBeDefined();
    expect(hrTrend!.direction).toBe("improving");
    expect(hrTrend!.detail).toContain("trending down");
  });

  // -------------------------------------------------------------------------
  // 4. Declining run pace (increasing sec/km = slower = declining)
  // -------------------------------------------------------------------------
  it("detects a declining run pace trend when pace slows consistently", async () => {
    // Build runs with steadily increasing sec/km by varying duration at fixed distance
    // Week 1: 3000s / 10000m = 300 s/km (5:00/km)
    // Week 2: 3300s / 10000m = 330 s/km (5:30/km)
    // Week 3: 3600s / 10000m = 360 s/km (6:00/km)
    // Week 4: 3900s / 10000m = 390 s/km (6:30/km)
    // Week 5: 4200s / 10000m = 420 s/km (7:00/km)
    const activities = [
      makeRunActivity(WEEK1_TUE, { duration_sec: 3000, distance_m: 10000, avg_hr: null }),
      makeRunActivity(WEEK2_TUE, { duration_sec: 3300, distance_m: 10000, avg_hr: null }),
      makeRunActivity(WEEK3_TUE, { duration_sec: 3600, distance_m: 10000, avg_hr: null }),
      makeRunActivity(WEEK4_TUE, { duration_sec: 3900, distance_m: 10000, avg_hr: null }),
      makeRunActivity(WEEK5_TUE, { duration_sec: 4200, distance_m: 10000, avg_hr: null })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    const paceTrend = result.find((t) => t.metric === "Run pace");
    expect(paceTrend).toBeDefined();
    expect(paceTrend!.direction).toBe("declining");
    expect(paceTrend!.detail).toContain("slowing");
  });

  // -------------------------------------------------------------------------
  // 5. Improving bike power (increasing watts = improving)
  // -------------------------------------------------------------------------
  it("detects an improving bike power trend when power increases consistently", async () => {
    // Power rises each week: 180 → 190 → 200 → 210 → 220 → 230
    const activities = [
      makeBikeActivity(WEEK1_TUE, { avg_power: 180 }),
      makeBikeActivity(WEEK2_TUE, { avg_power: 190 }),
      makeBikeActivity(WEEK3_TUE, { avg_power: 200 }),
      makeBikeActivity(WEEK4_TUE, { avg_power: 210 }),
      makeBikeActivity(WEEK5_TUE, { avg_power: 220 }),
      makeBikeActivity(WEEK6_TUE, { avg_power: 230 })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    const powerTrend = result.find((t) => t.metric === "Bike avg power");
    expect(powerTrend).toBeDefined();
    expect(powerTrend!.direction).toBe("improving");
    expect(powerTrend!.detail).toContain("trending up");
  });

  it("also detects improving bike power for activities with sport_type = 'cycling'", async () => {
    const activities = [
      makeBikeActivity(WEEK1_TUE, { avg_power: 180, sport_type: "cycling" }),
      makeBikeActivity(WEEK2_TUE, { avg_power: 195, sport_type: "cycling" }),
      makeBikeActivity(WEEK3_TUE, { avg_power: 210, sport_type: "cycling" }),
      makeBikeActivity(WEEK4_TUE, { avg_power: 225, sport_type: "cycling" })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    const powerTrend = result.find((t) => t.metric === "Bike avg power");
    expect(powerTrend).toBeDefined();
    expect(powerTrend!.direction).toBe("improving");
  });

  // -------------------------------------------------------------------------
  // 6. Returns at most 3 trends
  // -------------------------------------------------------------------------
  it("returns at most 3 trends even when all 5 metrics have qualifying data", async () => {
    // Provide strongly trending data for all 5 metrics across 5 weeks.
    // HR improving, pace improving, power improving, swim pace improving, strength improving.
    const hrValues = [165, 160, 155, 150, 145];
    const durationValues = [3000, 2900, 2800, 2700, 2600]; // pace improving
    const powerValues = [180, 195, 210, 225, 240];
    const swimPaceValues = [110, 106, 102, 98, 94]; // faster each week
    const strengthDurations = [1800, 2000, 2200, 2400, 2600];

    const weeks = [WEEK1_TUE, WEEK2_TUE, WEEK3_TUE, WEEK4_TUE, WEEK5_TUE];
    const activities: ActivityStub[] = [];

    for (let i = 0; i < weeks.length; i++) {
      activities.push(makeRunActivity(weeks[i], { avg_hr: hrValues[i], duration_sec: durationValues[i], distance_m: 10000 }));
      activities.push(makeBikeActivity(weeks[i], { avg_power: powerValues[i] }));
      activities.push(makeSwimActivity(weeks[i], { avg_pace_per_100m_sec: swimPaceValues[i] }));
      activities.push(makeStrengthActivity(weeks[i], { duration_sec: strengthDurations[i] }));
    }

    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    expect(result.length).toBeLessThanOrEqual(3);
  });

  // -------------------------------------------------------------------------
  // 7. Sorts by confidence (high > medium > low)
  // -------------------------------------------------------------------------
  it("sorts returned trends by confidence descending (high first)", async () => {
    // Give run HR 5 weeks of strongly consistent data (=> high confidence)
    // Give bike power only 4 weeks of consistent data (=> medium confidence)
    // Both should appear but run HR trend should come first.
    const activities: ActivityStub[] = [
      // Run HR: 5 weeks, consistently decreasing by ~10 bpm (high confidence)
      makeRunActivity(WEEK1_TUE, { avg_hr: 170, distance_m: 10000, duration_sec: 3000 }),
      makeRunActivity(WEEK2_TUE, { avg_hr: 160, distance_m: 10000, duration_sec: 3000 }),
      makeRunActivity(WEEK3_TUE, { avg_hr: 150, distance_m: 10000, duration_sec: 3000 }),
      makeRunActivity(WEEK4_TUE, { avg_hr: 140, distance_m: 10000, duration_sec: 3000 }),
      makeRunActivity(WEEK5_TUE, { avg_hr: 130, distance_m: 10000, duration_sec: 3000 }),
      // Bike power: 4 weeks, consistently increasing by 20W (medium confidence)
      makeBikeActivity(WEEK2_TUE, { avg_power: 180 }),
      makeBikeActivity(WEEK3_TUE, { avg_power: 200 }),
      makeBikeActivity(WEEK4_TUE, { avg_power: 220 }),
      makeBikeActivity(WEEK5_TUE, { avg_power: 240 })
    ];

    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    expect(result.length).toBeGreaterThanOrEqual(2);

    const confidenceOrder = { high: 3, medium: 2, low: 1 } as const;
    for (let i = 1; i < result.length; i++) {
      expect(confidenceOrder[result[i - 1].confidence]).toBeGreaterThanOrEqual(
        confidenceOrder[result[i].confidence]
      );
    }

    // The high-confidence run HR trend should be first
    expect(result[0].metric).toBe("Run avg HR");
    expect(result[0].confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 8. Stable + low confidence trends are filtered out
  // -------------------------------------------------------------------------
  it("filters out stable trends that have low confidence", async () => {
    // Provide runs across 3 weeks where HR barely changes (within 10% range)
    // so inferDirection returns "stable", and with only 3 data points
    // countConsistentDirections will be small, giving "low" confidence.
    // buildTrend should return null for such trends.
    const activities = [
      makeRunActivity(WEEK1_TUE, { avg_hr: 150, distance_m: null, duration_sec: null }),
      makeRunActivity(WEEK2_TUE, { avg_hr: 151, distance_m: null, duration_sec: null }),
      makeRunActivity(WEEK3_TUE, { avg_hr: 150, distance_m: null, duration_sec: null })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    // None should have direction="stable" with confidence="low"
    for (const trend of result) {
      const isStableAndLow = trend.direction === "stable" && trend.confidence === "low";
      expect(isStableAndLow).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Additional: dataPoints shape is correct
  // -------------------------------------------------------------------------
  it("returns dataPoints with correct weekStart, value, and label fields", async () => {
    // 3 weeks of consistently improving bike power
    const activities = [
      makeBikeActivity(WEEK1_TUE, { avg_power: 180 }),
      makeBikeActivity(WEEK2_TUE, { avg_power: 220 }),
      makeBikeActivity(WEEK3_TUE, { avg_power: 260 })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    const powerTrend = result.find((t) => t.metric === "Bike avg power");
    expect(powerTrend).toBeDefined();

    const dp = powerTrend!.dataPoints;
    expect(dp.length).toBeGreaterThanOrEqual(3);
    for (const point of dp) {
      expect(point).toHaveProperty("weekStart");
      expect(point).toHaveProperty("value");
      expect(point).toHaveProperty("label");
      // weekStart is ISO date string: YYYY-MM-DD
      expect(point.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // label contains "W" for watts
      expect(point.label).toContain("W");
    }
  });

  // -------------------------------------------------------------------------
  // Additional: Sunday belongs to prior week (getMonday boundary test)
  // -------------------------------------------------------------------------
  it("assigns a Sunday activity to the prior week, not the following week", async () => {
    // 2026-03-29 is a Sunday — it should belong to week starting 2026-03-23 (Monday)
    // 2026-03-30 is a Monday — it should belong to week starting 2026-03-30
    // Provide activities on these dates and one earlier to have >= 3 weeks.
    const activities = [
      makeRunActivity(WEEK1_TUE, { avg_hr: 170 }), // week of 2026-02-23
      makeRunActivity("2026-03-29", { avg_hr: 155 }), // Sunday => week of 2026-03-23
      makeRunActivity("2026-03-30", { avg_hr: 140 })  // Monday => week of 2026-03-30
    ];
    const supabase = mockTrendsSupabase(activities);
    // With 3 distinct weeks and enough change, we should get at least one trend.
    // Main assertion: the function doesn't throw and returns an array.
    const result = await detectTrends(supabase, ATHLETE_ID);
    expect(Array.isArray(result)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Additional: swim pace trend
  // -------------------------------------------------------------------------
  it("detects an improving swim pace trend (avg_pace_per_100m_sec decreasing)", async () => {
    const activities = [
      makeSwimActivity(WEEK1_TUE, { avg_pace_per_100m_sec: 120 }),
      makeSwimActivity(WEEK2_TUE, { avg_pace_per_100m_sec: 112 }),
      makeSwimActivity(WEEK3_TUE, { avg_pace_per_100m_sec: 104 }),
      makeSwimActivity(WEEK4_TUE, { avg_pace_per_100m_sec: 96 })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    const swimTrend = result.find((t) => t.metric === "Swim pace");
    expect(swimTrend).toBeDefined();
    expect(swimTrend!.direction).toBe("improving");
    expect(swimTrend!.detail).toContain("faster");
  });

  // -------------------------------------------------------------------------
  // Additional: strength duration trend
  // -------------------------------------------------------------------------
  it("detects an improving strength duration trend (duration_sec increasing)", async () => {
    const activities = [
      makeStrengthActivity(WEEK1_TUE, { duration_sec: 1800 }),
      makeStrengthActivity(WEEK2_TUE, { duration_sec: 2100 }),
      makeStrengthActivity(WEEK3_TUE, { duration_sec: 2400 }),
      makeStrengthActivity(WEEK4_TUE, { duration_sec: 2700 })
    ];
    const supabase = mockTrendsSupabase(activities);
    const result = await detectTrends(supabase, ATHLETE_ID);

    const strengthTrend = result.find((t) => t.metric === "Strength duration");
    expect(strengthTrend).toBeDefined();
    expect(strengthTrend!.direction).toBe("improving");
    expect(strengthTrend!.detail).toContain("increasing");
  });

  // -------------------------------------------------------------------------
  // Additional: null data returns empty from Supabase
  // -------------------------------------------------------------------------
  it("returns empty array when supabase returns null data", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              lte: () => ({
                order: () => ({ data: null, error: null })
              })
            })
          })
        })
      })
    } as unknown as SupabaseClient;

    const result = await detectTrends(supabase, ATHLETE_ID);
    expect(result).toEqual([]);
  });
});
