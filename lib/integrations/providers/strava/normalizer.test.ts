import { mapStravaSportType, normalizeStravaActivity, type StravaActivitySummary } from "./normalizer";

const baseActivity: StravaActivitySummary = {
  id: 123456789,
  name: "Morning Run",
  sport_type: "Run",
  start_date: "2026-03-01T07:00:00Z",
  elapsed_time: 3600,
  moving_time: 3500,
  distance: 10000,
  total_elevation_gain: 50,
  average_heartrate: 145.6,
  max_heartrate: 172,
  average_watts: 250.3,
  max_watts: 400,
  average_cadence: 88.2,
  calories: 520
};

describe("mapStravaSportType", () => {
  it.each([
    ["Run", "run"],
    ["TrailRun", "run"],
    ["VirtualRun", "run"],
    ["Ride", "bike"],
    ["VirtualRide", "bike"],
    ["GravelRide", "bike"],
    ["EBikeRide", "bike"],
    ["MountainBikeRide", "bike"],
    ["Swim", "swim"],
    ["OpenWaterSwim", "swim"],
    ["WeightTraining", "strength"],
    ["Yoga", "strength"],
    ["Crossfit", "strength"],
    ["Workout", "strength"],
    ["Elliptical", "strength"],
    ["StairStepper", "strength"],
    ["Kayaking", "other"],
    ["Rowing", "other"],
    ["Soccer", "other"],
    ["", "other"]
  ])("maps %s → %s", (input, expected) => {
    expect(mapStravaSportType(input)).toBe(expected);
  });
});

describe("normalizeStravaActivity", () => {
  it("maps a run activity correctly", () => {
    const result = normalizeStravaActivity(baseActivity, "user-abc");

    expect(result.user_id).toBe("user-abc");
    expect(result.sport_type).toBe("run");
    expect(result.start_time_utc).toBe("2026-03-01T07:00:00Z");
    expect(result.duration_sec).toBe(3600);
    expect(result.moving_duration_sec).toBe(3500);
    expect(result.distance_m).toBe(10000);
    expect(result.elevation_gain_m).toBe(50);
    expect(result.avg_hr).toBe(146); // rounded
    expect(result.max_hr).toBe(172);
    expect(result.avg_power).toBe(250); // rounded
    expect(result.max_power).toBe(400);
    expect(result.avg_cadence).toBe(88); // rounded
    expect(result.calories).toBe(520);
    expect(result.external_provider).toBe("strava");
    expect(result.external_activity_id).toBe("123456789");
    expect(result.external_title).toBe("Morning Run");
    expect(result.source).toBe("strava");
    expect(result.activity_vendor).toBe("strava");
    expect(result.schedule_status).toBe("unscheduled");
    expect(result.is_unplanned).toBe(false);
  });

  it("maps a ride activity correctly", () => {
    const result = normalizeStravaActivity({ ...baseActivity, sport_type: "Ride", name: "Evening Ride" }, "user-abc");
    expect(result.sport_type).toBe("bike");
    expect(result.external_title).toBe("Evening Ride");
  });

  it("maps a swim activity correctly", () => {
    const result = normalizeStravaActivity({ ...baseActivity, sport_type: "Swim" }, "user-abc");
    expect(result.sport_type).toBe("swim");
  });

  it("maps a weight training activity correctly", () => {
    const result = normalizeStravaActivity({ ...baseActivity, sport_type: "WeightTraining" }, "user-abc");
    expect(result.sport_type).toBe("strength");
  });

  it("falls back to legacy type field when sport_type is absent", () => {
    const { sport_type: _, ...withoutSportType } = baseActivity;
    const result = normalizeStravaActivity({ ...withoutSportType, type: "Ride" }, "user-abc");
    expect(result.sport_type).toBe("bike");
  });

  it("returns null for optional fields when not present", () => {
    const minimal: StravaActivitySummary = {
      id: 1,
      name: "Easy Run",
      sport_type: "Run",
      start_date: "2026-03-01T07:00:00Z",
      elapsed_time: 1800,
      moving_time: 1800,
      distance: 5000
    };
    const result = normalizeStravaActivity(minimal, "user-abc");

    expect(result.elevation_gain_m).toBeNull();
    expect(result.avg_hr).toBeNull();
    expect(result.max_hr).toBeNull();
    expect(result.avg_power).toBeNull();
    expect(result.max_power).toBeNull();
    expect(result.avg_cadence).toBeNull();
    expect(result.calories).toBeNull();
  });

  it("returns null for zero-value optional fields", () => {
    const result = normalizeStravaActivity(
      { ...baseActivity, average_heartrate: 0, max_heartrate: 0, total_elevation_gain: 0 },
      "user-abc"
    );
    expect(result.avg_hr).toBeNull();
    expect(result.max_hr).toBeNull();
    expect(result.elevation_gain_m).toBeNull();
  });

  it("converts external_activity_id to string", () => {
    const result = normalizeStravaActivity({ ...baseActivity, id: 987654321 }, "user-abc");
    expect(typeof result.external_activity_id).toBe("string");
    expect(result.external_activity_id).toBe("987654321");
  });
});
