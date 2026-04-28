const parseMock = jest.fn();

jest.mock("fit-file-parser", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    parse: parseMock
  }))
}));

import type { ParsedActivity } from "./activity-parser";
import { isMultisportParseResult, parseFitFile } from "./activity-parser";

async function parseSingleFit(buffer: Buffer): Promise<ParsedActivity> {
  const result = await parseFitFile(buffer);
  if (isMultisportParseResult(result)) {
    throw new Error("Expected single-session FIT, received multisport result");
  }
  return result;
}

describe("parseFitFile", () => {
  beforeEach(() => {
    parseMock.mockReset();
  });

  test("captures rich bike metrics into metrics_v2 and parse summary", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:29:41.000Z",
            sport: "cycling",
            sub_sport: "indoor_cycling",
            sport_profile_name: "INDOOR",
            total_timer_time: 5400,
            total_elapsed_time: 5460,
            total_distance: 40000,
            avg_heart_rate: 145,
            max_heart_rate: 171,
            avg_power: 180,
            normalized_power: 195,
            max_power: 310,
            avg_cadence: 84,
            max_cadence: 96,
            threshold_power: 250,
            total_work: 972000,
            training_stress_score: 92.4,
            intensity_factor: 0.78,
            total_training_effect: 3.4,
            total_anaerobic_training_effect: 0.5,
            total_calories: 1200,
            avg_temperature: 18,
            min_temperature: 17,
            max_temperature: 20,
            enhanced_avg_respiration_rate: 28.2,
            enhanced_min_respiration_rate: 18.1,
            enhanced_max_respiration_rate: 36.4,
            num_laps: 2
          }
        ],
        laps: [
          {
            start_time: "2026-03-14T11:29:41.000Z",
            total_timer_time: 2700,
            total_elapsed_time: 2730,
            total_distance: 20000,
            avg_heart_rate: 140,
            max_heart_rate: 161,
            avg_power: 172,
            normalized_power: 185,
            max_power: 250,
            avg_cadence: 82,
            max_cadence: 90,
            total_calories: 550,
            total_work: 464000,
            lap_trigger: "distance"
          },
          {
            start_time: "2026-03-14T12:14:41.000Z",
            total_timer_time: 2700,
            total_elapsed_time: 2730,
            total_distance: 20000,
            avg_heart_rate: 150,
            max_heart_rate: 171,
            avg_power: 188,
            normalized_power: 205,
            max_power: 310,
            avg_cadence: 86,
            max_cadence: 96,
            total_calories: 650,
            total_work: 508000,
            lap_trigger: "session_end"
          }
        ],
        time_in_zone: [
          {
            reference_mesg: 18,
            reference_index: 0,
            functional_threshold_power: 250,
            threshold_heart_rate: 171,
            pwr_calc_type: "percent_ftp",
            time_in_power_zone: [0, 600, 2400, 1800, 600],
            power_zone_high_boundary: [100, 150, 200, 250, 400],
            time_in_hr_zone: [120, 900, 3300, 1080],
            hr_zone_high_boundary: [120, 140, 160, 180]
          }
        ],
        activity_metrics: [
          {
            recovery_time: 3600,
            vo2_max: 52.1
          }
        ],
        events: [
          { timestamp: "2026-03-14T12:30:00.000Z", event: "timer", event_type: "stop_all", data: 1 },
          { timestamp: "2026-03-14T12:31:00.000Z", event: "timer", event_type: "start", data: 1 }
        ],
        records: [{ power: 180 }, { power: 200 }]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result).toMatchObject({
      sportType: "bike",
      movingDurationSec: 5400,
      elapsedDurationSec: 5460,
      avgPower: 180,
      maxPower: 310,
      avgCadence: 84,
      maxHr: 171
    });
    expect(result.metricsV2).toMatchObject({
      power: {
        normalizedPower: 195,
        variabilityIndex: 1.083,
        intensityFactor: 0.78,
        totalWorkKj: 972
      },
      load: {
        trainingStressScore: 92.4,
        recoveryTimeSec: 3600
      },
      pauses: {
        count: 1,
        totalPausedSec: 60
      },
      halves: {
        firstHalfAvgPower: 172,
        lastHalfAvgPower: 188
      }
    });
    expect(result.metricsV2?.zones).toMatchObject({
      functionalThresholdPower: 250
    });
    expect(result.metricsV2?.zones).toEqual(expect.objectContaining({
      power: expect.arrayContaining([
        expect.objectContaining({ zone: 2, durationSec: 600 })
      ])
    }));
    expect(result.metricsV2?.laps).toHaveLength(2);
    expect(result.parseSummary).toMatchObject({
      pauseCount: 1,
      laps: [
        { avg_power: 172 },
        { normalized_power: 205 }
      ]
    });
  });

  test("falls back to record timestamp span when session and laps lack duration", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            sport: "running"
          }
        ],
        records: [
          { timestamp: "2026-03-14T11:00:00.000Z" },
          { timestamp: "2026-03-14T11:30:00.000Z" },
          { timestamp: "2026-03-14T12:00:00.000Z" }
        ]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(3600);
    expect(result.elapsedDurationSec).toBe(3600);
    expect(result.movingDurationSec).toBeUndefined();
  });

  test("falls back to summed lap durations when session lacks duration fields", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            sport: "running"
          }
        ],
        laps: [
          { total_elapsed_time: 600 },
          { total_elapsed_time: 600 },
          { total_elapsed_time: 600 }
        ]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(1800);
    expect(result.elapsedDurationSec).toBe(1800);
  });

  test("prefers lap-sum over record span when both fallbacks are available", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            sport: "running"
          }
        ],
        laps: [
          { total_elapsed_time: 900 },
          { total_elapsed_time: 900 }
        ],
        records: [
          { timestamp: "2026-03-14T11:00:00.000Z" },
          { timestamp: "2026-03-14T12:00:00.000Z" }
        ]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(1800);
  });

  test("skips lap-sum and uses record span when any lap lacks duration metadata", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            sport: "running"
          }
        ],
        laps: [
          { total_elapsed_time: 600 },
          { total_distance: 1000 },
          { total_elapsed_time: 600 }
        ],
        records: [
          { timestamp: "2026-03-14T11:00:00.000Z" },
          { timestamp: "2026-03-14T12:00:00.000Z" }
        ]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(3600);
    expect(result.elapsedDurationSec).toBe(3600);
  });

  test("falls back to session.timestamp span for manual entries with no laps or records", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            timestamp: "2026-03-14T11:45:00.000Z",
            sport: "running"
          }
        ]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(2700);
    expect(result.elapsedDurationSec).toBe(2700);
  });

  test("falls back to fit.activity.total_timer_time when session and laps omit duration", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            sport: "running"
          }
        ],
        activity: { total_timer_time: 1500 }
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(1500);
    expect(result.elapsedDurationSec).toBe(1500);
  });

  test("accepts 0-duration when all fallbacks are exhausted (manual-entry FIT)", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-04-17T07:00:00.000Z",
            timestamp: "2026-04-17T07:00:00.000Z",
            sport: "training",
            sub_sport: "strength_training",
            total_elapsed_time: 0,
            total_timer_time: 0,
            total_moving_time: 0,
            total_distance: 0,
            avg_speed: 0
          }
        ],
        laps: [
          {
            start_time: "2026-04-17T07:00:00.000Z",
            timestamp: "2026-04-17T07:00:00.000Z",
            total_elapsed_time: 0,
            total_timer_time: 0
          }
        ]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(0);
    expect(result.movingDurationSec).toBeUndefined();
    expect(result.elapsedDurationSec).toBeUndefined();
    expect(result.sportType).toBe("strength");
  });

  test("derives duration from distance/avg_speed when time fields are missing", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            timestamp: "2026-03-14T11:00:00.000Z",
            sport: "running",
            total_distance: 10000,
            avg_speed: 2.778
          }
        ]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(3600);
    expect(result.elapsedDurationSec).toBe(3600);
  });

  test("throws for endurance sports when all duration fallbacks are exhausted", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            sport: "running"
          }
        ],
        records: [{ timestamp: "2026-03-14T11:00:00.000Z" }]
      });
    });

    await expect(parseFitFile(Buffer.from("fit"))).rejects.toThrow("FIT file missing usable duration.");
  });

  test("uses session duration even when laps and records disagree", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        sessions: [
          {
            start_time: "2026-03-14T11:00:00.000Z",
            sport: "running",
            total_timer_time: 2700,
            total_elapsed_time: 2700
          }
        ],
        laps: [{ total_elapsed_time: 99 }],
        records: [
          { timestamp: "2026-03-14T11:00:00.000Z" },
          { timestamp: "2026-03-14T11:00:01.000Z" }
        ]
      });
    });

    const result = await parseSingleFit(Buffer.from("fit"));

    expect(result.durationSec).toBe(2700);
    expect(result.movingDurationSec).toBe(2700);
    expect(result.elapsedDurationSec).toBe(2700);
  });

  test("returns a multisport result for an auto_multi_sport FIT (Olympic triathlon shape)", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        activity: { type: "auto_multi_sport", num_sessions: 5 },
        sessions: [
          {
            start_time: "2026-04-26T08:03:08.000Z",
            sport: "swimming",
            sub_sport: "lap_swimming",
            total_elapsed_time: 1601,
            total_timer_time: 1601,
            total_distance: 600,
            avg_heart_rate: 118,
            max_heart_rate: 131
          },
          {
            start_time: "2026-04-26T08:29:51.000Z",
            sport: "transition",
            sub_sport: "generic",
            total_elapsed_time: 130,
            total_timer_time: 130,
            total_distance: 213,
            avg_heart_rate: 164,
            max_heart_rate: 180
          },
          {
            start_time: "2026-04-26T08:32:01.000Z",
            sport: "cycling",
            sub_sport: "generic",
            total_elapsed_time: 4619,
            total_timer_time: 4619,
            total_distance: 39966,
            avg_heart_rate: 165,
            max_heart_rate: 176
          },
          {
            start_time: "2026-04-26T09:49:00.000Z",
            sport: "transition",
            sub_sport: "generic",
            total_elapsed_time: 99,
            total_timer_time: 99,
            total_distance: 160,
            avg_heart_rate: 160,
            max_heart_rate: 169
          },
          {
            start_time: "2026-04-26T09:50:39.000Z",
            sport: "running",
            sub_sport: "generic",
            total_elapsed_time: 2641,
            total_timer_time: 2641,
            total_distance: 9368,
            avg_heart_rate: 166,
            max_heart_rate: 194
          }
        ],
        laps: [],
        events: [],
        records: [],
        time_in_zone: []
      });
    });

    const result = await parseFitFile(Buffer.from("fit"));

    if (!isMultisportParseResult(result)) throw new Error("expected multisport result");

    expect(result.kind).toBe("multisport");
    expect(result.bundle.source).toBe("garmin_multisport");
    expect(result.bundle.startedAt).toBe("2026-04-26T08:03:08.000Z");
    expect(result.bundle.totalDurationSec).toBe(1601 + 130 + 4619 + 99 + 2641);
    expect(result.bundle.totalDistanceM).toBe(600 + 213 + 39966 + 160 + 9368);

    expect(result.segments).toHaveLength(5);
    expect(result.segments.map((s) => s.role)).toEqual(["swim", "t1", "bike", "t2", "run"]);
    expect(result.segments.map((s) => s.segmentIndex)).toEqual([0, 1, 2, 3, 4]);

    const [swim, t1, bike, t2, run] = result.segments;
    expect(swim.sportType).toBe("swim");
    expect(swim.durationSec).toBe(1601);
    expect(swim.distanceM).toBe(600);
    expect(t1.durationSec).toBe(130);
    expect(bike.sportType).toBe("bike");
    expect(bike.durationSec).toBe(4619);
    expect(bike.distanceM).toBe(39966);
    expect(t2.durationSec).toBe(99);
    expect(run.sportType).toBe("run");
    expect(run.durationSec).toBe(2641);
  });

  test("treats a sessions.length > 1 FIT (no auto_multi_sport flag) as multisport", async () => {
    parseMock.mockImplementation((_buffer: Buffer, callback: (error: unknown, data: unknown) => void) => {
      callback(null, {
        activity: { type: "manual" },
        sessions: [
          {
            start_time: "2026-04-26T08:00:00.000Z",
            sport: "swimming",
            total_elapsed_time: 1000,
            total_timer_time: 1000,
            total_distance: 500
          },
          {
            start_time: "2026-04-26T08:20:00.000Z",
            sport: "running",
            total_elapsed_time: 2000,
            total_timer_time: 2000,
            total_distance: 6000
          }
        ],
        laps: [],
        events: [],
        records: []
      });
    });

    const result = await parseFitFile(Buffer.from("fit"));
    expect(isMultisportParseResult(result)).toBe(true);
  });
});
