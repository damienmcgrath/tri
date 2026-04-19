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
  weighted_average_watts: 265,
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

  it("computes end_time_utc from start + elapsed", () => {
    const result = normalizeStravaActivity(baseActivity, "user-abc");
    expect(result.end_time_utc).toBe("2026-03-01T08:00:00.000Z");
  });

  it("populates elapsed_duration_sec", () => {
    const result = normalizeStravaActivity(baseActivity, "user-abc");
    expect(result.elapsed_duration_sec).toBe(3600);
  });

  it("computes avg_pace_per_100m_sec for runs", () => {
    const result = normalizeStravaActivity(baseActivity, "user-abc");
    // 3500 moving seconds / (10000m / 100) = 35 sec/100m (rounded to integer for DB column)
    expect(result.avg_pace_per_100m_sec).toBe(35);
  });

  it("returns null avg_pace_per_100m_sec for bike", () => {
    const result = normalizeStravaActivity({ ...baseActivity, sport_type: "Ride" }, "user-abc");
    expect(result.avg_pace_per_100m_sec).toBeNull();
  });

  it("stores activity_type_raw", () => {
    const result = normalizeStravaActivity(baseActivity, "user-abc");
    expect(result.activity_type_raw).toBe("Run");
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

  describe("metrics_v2", () => {
    it("includes schemaVersion and sourceFormat", () => {
      const result = normalizeStravaActivity(baseActivity, "user-abc");
      expect(result.metrics_v2.schemaVersion).toBe(1);
      expect(result.metrics_v2.sourceFormat).toBe("strava");
    });

    it("populates power section with normalized power from weighted_average_watts", () => {
      const result = normalizeStravaActivity(baseActivity, "user-abc");
      const power = result.metrics_v2.power as Record<string, unknown>;
      expect(power.avgPower).toBe(250);
      expect(power.normalizedPower).toBe(265);
      expect(power.maxPower).toBe(400);
      // totalWorkKj = avgPower * movingTimeSec / 1000 = 250 * 3500 / 1000 = 875
      expect(power.totalWorkKj).toBe(875);
      // variabilityIndex = normalizedPower / avgPower = 265 / 250 = 1.06
      expect(power.variabilityIndex).toBe(1.06);
    });

    it("populates heart rate section", () => {
      const result = normalizeStravaActivity(baseActivity, "user-abc");
      const hr = result.metrics_v2.heartRate as Record<string, unknown>;
      expect(hr.avgHr).toBe(146);
      expect(hr.maxHr).toBe(172);
    });

    it("populates elevation section", () => {
      const result = normalizeStravaActivity(baseActivity, "user-abc");
      const elev = result.metrics_v2.elevation as Record<string, unknown>;
      expect(elev.gainM).toBe(50);
      expect(elev.lossM).toBeNull(); // not available from Strava
    });

    it("populates pace section for runs", () => {
      const result = normalizeStravaActivity(baseActivity, "user-abc");
      const pace = result.metrics_v2.pace as Record<string, unknown>;
      expect(pace.avgPacePer100mSec).toBe(35);
      expect(pace.avgPaceSecPerKm).toBe(350);
    });

    it("populates environment temperature when available", () => {
      const result = normalizeStravaActivity({ ...baseActivity, average_temp: 22 }, "user-abc");
      const env = result.metrics_v2.environment as Record<string, unknown>;
      expect(env.temperature).toBe(22);
      expect(env.avgTemperature).toBe(22);
    });

    it("populates suffer_score in load section", () => {
      const result = normalizeStravaActivity({ ...baseActivity, suffer_score: 87 }, "user-abc");
      const load = result.metrics_v2.load as Record<string, unknown>;
      expect(load.sufferScore).toBe(87);
    });

    it("populates pause info from elapsed vs moving time", () => {
      const result = normalizeStravaActivity(baseActivity, "user-abc");
      const pauses = result.metrics_v2.pauses as Record<string, unknown>;
      // elapsed 3600 - moving 3500 = 100s paused
      expect(pauses.totalPausedSec).toBe(100);
      expect(pauses.count).toBe(1);
    });

    it("builds lap summaries from detailed activity laps", () => {
      const withLaps: StravaActivitySummary = {
        ...baseActivity,
        laps: [
          { lap_index: 0, elapsed_time: 600, moving_time: 590, distance: 1600, average_heartrate: 140, max_heartrate: 155, average_watts: 240, average_cadence: 86 },
          { lap_index: 1, elapsed_time: 600, moving_time: 595, distance: 1650, average_heartrate: 148, max_heartrate: 165, average_watts: 255, average_cadence: 90 }
        ]
      };
      const result = normalizeStravaActivity(withLaps, "user-abc");
      expect(result.laps_count).toBe(2);

      const laps = result.metrics_v2.laps as Record<string, unknown>[];
      expect(laps).toHaveLength(2);
      expect(laps[0]).toMatchObject({
        index: 0,
        durationSec: 600,
        distanceM: 1600,
        avgHr: 140,
        avgPower: 240
      });
    });

    it("computes HR drift and pace fade from splits", () => {
      const withSplits: StravaActivitySummary = {
        ...baseActivity,
        splits_metric: [
          { split: 1, distance: 1000, elapsed_time: 350, moving_time: 345, average_heartrate: 140, average_speed: 2.9 },
          { split: 2, distance: 1000, elapsed_time: 348, moving_time: 345, average_heartrate: 142, average_speed: 2.88 },
          { split: 3, distance: 1000, elapsed_time: 355, moving_time: 350, average_heartrate: 150, average_speed: 2.85 },
          { split: 4, distance: 1000, elapsed_time: 360, moving_time: 355, average_heartrate: 155, average_speed: 2.8 },
          { split: 5, distance: 1000, elapsed_time: 365, moving_time: 360, average_heartrate: 158, average_speed: 2.75 },
          { split: 6, distance: 1000, elapsed_time: 370, moving_time: 365, average_heartrate: 160, average_speed: 2.7 }
        ]
      };
      const result = normalizeStravaActivity(withSplits, "user-abc");
      const splits = result.metrics_v2.splits as Record<string, unknown>;
      expect(splits).not.toBeNull();
      expect(typeof splits.hrDriftPct).toBe("number");
      expect((splits.hrDriftPct as number)).toBeGreaterThan(0); // HR went up
      expect(typeof splits.paceFadePct).toBe("number");
      expect((splits.paceFadePct as number)).toBeGreaterThan(0); // speed dropped
    });

    it("populates raw first/last half HR and pace from splits (run)", () => {
      // Consumers in lib/workouts/session-execution.ts#extractSplitMetrics and
      // lib/coach/session-diagnosis.ts#hasSplits read the raw halves, not the
      // derived percentages. Without these fields, Strava long-endurance runs
      // falsely report "split metrics missing".
      const withSplits: StravaActivitySummary = {
        ...baseActivity,
        splits_metric: [
          { split: 1, distance: 1000, elapsed_time: 350, moving_time: 345, average_heartrate: 140, average_speed: 2.9 },
          { split: 2, distance: 1000, elapsed_time: 348, moving_time: 345, average_heartrate: 142, average_speed: 2.88 },
          { split: 3, distance: 1000, elapsed_time: 355, moving_time: 350, average_heartrate: 150, average_speed: 2.85 },
          { split: 4, distance: 1000, elapsed_time: 360, moving_time: 355, average_heartrate: 155, average_speed: 2.8 },
          { split: 5, distance: 1000, elapsed_time: 365, moving_time: 360, average_heartrate: 158, average_speed: 2.75 },
          { split: 6, distance: 1000, elapsed_time: 370, moving_time: 365, average_heartrate: 160, average_speed: 2.7 }
        ]
      };
      const result = normalizeStravaActivity(withSplits, "user-abc");
      const splits = result.metrics_v2.splits as Record<string, unknown>;
      const halves = result.metrics_v2.halves as Record<string, unknown>;

      // first half HR avg = (140+142+150)/3 = 144, last half = (155+158+160)/3 = 157.67 → 158
      expect(splits.firstHalfAvgHr).toBe(144);
      expect(splits.lastHalfAvgHr).toBe(158);
      // first half speed avg ≈ 2.8767 → pace 1000/2.8767 ≈ 347.62 s/km
      expect(splits.firstHalfPaceSPerKm).toBeCloseTo(347.62, 1);
      expect(splits.lastHalfPaceSPerKm).toBeCloseTo(363.64, 1);
      // halves mirrors splits for consumer path-search compatibility
      expect(halves.firstHalfAvgHr).toBe(144);
      expect(halves.lastHalfPaceSPerKm).toBeCloseTo(363.64, 1);
    });

    it("omits pace halves for non-run sports but keeps HR halves", () => {
      // Bike splits can carry HR but Strava pace halves aren't meaningful there.
      const bikeWithSplits: StravaActivitySummary = {
        ...baseActivity,
        sport_type: "Ride",
        splits_metric: [
          { split: 1, distance: 1000, elapsed_time: 120, moving_time: 120, average_heartrate: 130, average_speed: 8.3 },
          { split: 2, distance: 1000, elapsed_time: 120, moving_time: 120, average_heartrate: 132, average_speed: 8.3 },
          { split: 3, distance: 1000, elapsed_time: 120, moving_time: 120, average_heartrate: 140, average_speed: 8.3 },
          { split: 4, distance: 1000, elapsed_time: 120, moving_time: 120, average_heartrate: 142, average_speed: 8.3 }
        ]
      };
      const result = normalizeStravaActivity(bikeWithSplits, "user-abc");
      const splits = result.metrics_v2.splits as Record<string, unknown>;
      expect(splits.firstHalfAvgHr).toBe(131);
      expect(splits.lastHalfAvgHr).toBe(141);
      expect(splits.firstHalfPaceSPerKm).toBeNull();
      expect(splits.lastHalfPaceSPerKm).toBeNull();
    });

    it("swim laps include per-lap pace, stroke rate, and rest detection", () => {
      const swimWithLaps: StravaActivitySummary = {
        ...baseActivity,
        sport_type: "Swim",
        distance: 2000,
        moving_time: 2400,
        laps: [
          { lap_index: 0, elapsed_time: 240, moving_time: 235, distance: 400, average_heartrate: 130, max_heartrate: 140, average_cadence: 26 },
          { lap_index: 1, elapsed_time: 30, moving_time: 5, distance: 0, average_heartrate: 110, max_heartrate: 115 },  // rest lap
          { lap_index: 2, elapsed_time: 180, moving_time: 175, distance: 300, average_heartrate: 140, max_heartrate: 150, average_cadence: 28 },
        ]
      };
      const result = normalizeStravaActivity(swimWithLaps, "user-abc");
      const laps = result.metrics_v2.laps as Record<string, unknown>[];
      expect(laps).toHaveLength(3);

      // Work lap: should have avgPacePer100mSec and avgStrokeRateSpm, no avgCadence
      expect(laps[0]).toMatchObject({
        index: 0,
        durationSec: 240,
        distanceM: 400,
        avgPacePer100mSec: 60,  // 240s / (400/100) = 60s per 100m
        avgStrokeRateSpm: 26,
      });
      expect(laps[0]).not.toHaveProperty("avgCadence");

      // Rest lap: distance 0, flagged as rest
      expect(laps[1]).toMatchObject({
        isRest: true,
        restSec: 30,
        distanceM: 0,
      });
      expect(laps[1]).not.toHaveProperty("avgPacePer100mSec");

      // Another work lap
      expect(laps[2]).toMatchObject({
        avgPacePer100mSec: 60,  // 180s / (300/100) = 60s per 100m
        avgStrokeRateSpm: 28,
      });
    });

    it("non-swim laps use avgCadence (not avgStrokeRateSpm)", () => {
      const runWithLaps: StravaActivitySummary = {
        ...baseActivity,
        sport_type: "Run",
        laps: [
          { lap_index: 0, elapsed_time: 600, moving_time: 590, distance: 1600, average_cadence: 86 },
        ]
      };
      const result = normalizeStravaActivity(runWithLaps, "user-abc");
      const laps = result.metrics_v2.laps as Record<string, unknown>[];
      expect(laps[0]).toMatchObject({ avgCadence: 86 });
      expect(laps[0]).not.toHaveProperty("avgStrokeRateSpm");
      expect(laps[0]).not.toHaveProperty("avgPacePer100mSec");
    });

    it("swim activity puts cadence into stroke section", () => {
      const swim: StravaActivitySummary = {
        ...baseActivity,
        sport_type: "Swim",
        average_cadence: 28, // strokes per minute
        distance: 2000,
        moving_time: 2400
      };
      const result = normalizeStravaActivity(swim, "user-abc");
      // Swim cadence goes to stroke, not top-level avg_cadence
      expect(result.avg_cadence).toBeNull();

      const stroke = result.metrics_v2.stroke as Record<string, unknown>;
      expect(stroke).not.toBeNull();
      expect(stroke.avgStrokeRateSpm).toBe(28);
    });

    it("tracks missing fields for quality reporting", () => {
      const minimal: StravaActivitySummary = {
        id: 1,
        name: "Walk",
        sport_type: "Run",
        start_date: "2026-03-01T07:00:00Z",
        elapsed_time: 1800,
        moving_time: 1800,
        distance: 3000
      };
      const result = normalizeStravaActivity(minimal, "user-abc");
      const quality = result.metrics_v2.quality as { missing: string[] };
      expect(quality.missing).toContain("heartRate");
      expect(quality.missing).toContain("power");
      expect(quality.missing).toContain("cadence");
      expect(quality.missing).toContain("elevation");
      expect(quality.missing).toContain("temperature");
      expect(quality.missing).toContain("zones");
    });

    it("returns null metrics_v2 sections when data not available", () => {
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
      const power = result.metrics_v2.power as Record<string, unknown>;
      expect(power.normalizedPower).toBeNull();
      expect(power.totalWorkKj).toBeNull();
      expect(power.variabilityIndex).toBeNull();
      expect(result.metrics_v2.laps).toBeNull();
      expect(result.metrics_v2.splits).toBeNull();
    });
  });
});
