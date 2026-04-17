const parseMock = jest.fn();

jest.mock("fit-file-parser", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    parse: parseMock
  }))
}));

import { parseFitFile } from "./activity-parser";

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

    const result = await parseFitFile(Buffer.from("fit"));

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

    const result = await parseFitFile(Buffer.from("fit"));

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

    const result = await parseFitFile(Buffer.from("fit"));

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

    const result = await parseFitFile(Buffer.from("fit"));

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

    const result = await parseFitFile(Buffer.from("fit"));

    expect(result.durationSec).toBe(3600);
    expect(result.elapsedDurationSec).toBe(3600);
  });

  test("throws when session, laps, and records all lack usable duration", async () => {
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

    const result = await parseFitFile(Buffer.from("fit"));

    expect(result.durationSec).toBe(2700);
    expect(result.movingDurationSec).toBe(2700);
    expect(result.elapsedDurationSec).toBe(2700);
  });
});
