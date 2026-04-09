import { buildExecutionResultForSession, shouldRefreshExecutionResultFromActivity, deriveWorkIntervalAvgPower } from "./session-execution";

describe("buildExecutionResultForSession", () => {
  test("builds a persisted execution result with aliases the session review expects", () => {
    const result = buildExecutionResultForSession(
      {
        id: "session-1",
        user_id: "user-1",
        sport: "run",
        type: "Easy run",
        duration_minutes: 60,
        target: "HR 135-145 bpm",
        intent_category: "Easy aerobic run",
        status: "planned"
      },
      {
        id: "activity-1",
        sport_type: "run",
        duration_sec: 3600,
        distance_m: 10000,
        avg_hr: 154,
        avg_power: null,
        parse_summary: {},
        metrics_v2: {
          timeAboveTargetPct: 0.31,
          firstHalfAvgHr: 145,
          lastHalfAvgHr: 156,
          power: {
            normalizedPower: 205,
            intensityFactor: 0.78,
            totalWorkKj: 910
          },
          load: {
            trainingStressScore: 92.4
          },
          cadence: {
            avgCadence: 86
          }
        }
      }
    );

    expect(result.status).toBe(result.intentMatchStatus);
    expect(result.summary).toBe(result.executionScoreSummary);
    expect(result.linkedActivityId).toBe("activity-1");
    expect(result.normalizedPower).toBe(205);
    expect(result.trainingStressScore).toBe(92.4);
    expect(result.avgCadence).toBe(86);
    expect(result.suggestedWeekAdjustment).toMatch(/protect recovery|keep the week steady/i);
  });

  test("uses linked activity duration to produce a reviewable swim diagnosis", () => {
    const result = buildExecutionResultForSession(
      {
        id: "session-2",
        user_id: "user-1",
        sport: "swim",
        type: "Aerobic swim",
        duration_minutes: 45,
        intent_category: "Aerobic swim",
        status: "planned"
      },
      {
        id: "activity-2",
        sport_type: "swim",
        duration_sec: 2700,
        distance_m: 2200,
        avg_hr: null,
        avg_power: null,
        avg_pace_per_100m_sec: 123,
        laps_count: 10,
        parse_summary: { lapCount: 10 },
        metrics_v2: {}
      }
    );

    expect(result.status).toBe("matched_intent");
    expect(result.executionScoreBand).toBe("On target");
    expect(result.summary).toMatch(/aligned|planned intent/i);
  });

  test("threads session.target into the evidence plannedStructure", () => {
    const result = buildExecutionResultForSession(
      {
        id: "session-3",
        user_id: "user-1",
        sport: "run",
        type: "Interval run",
        duration_minutes: 40,
        target: "3 x 2min on, 2min off",
        status: "planned"
      },
      {
        id: "activity-3",
        sport_type: "run",
        duration_sec: 2400,
        distance_m: 8000,
        avg_hr: 162,
        avg_power: null,
        parse_summary: {},
        metrics_v2: {}
      }
    );

    expect(result.deterministic.planned.plannedStructure).toBe("3 x 2min on, 2min off");
  });

  test("joins target and notes into plannedStructure when both are present", () => {
    const result = buildExecutionResultForSession(
      {
        id: "session-4",
        user_id: "user-1",
        sport: "run",
        type: "Interval run",
        duration_minutes: 40,
        target: "3 x 2min on, 2min off",
        notes: "Focus on effort not pace",
        status: "planned"
      },
      {
        id: "activity-4",
        sport_type: "run",
        duration_sec: 2400,
        distance_m: 8000,
        avg_hr: 162,
        avg_power: null,
        parse_summary: {},
        metrics_v2: {}
      }
    );

    expect(result.deterministic.planned.plannedStructure).toBe("3 x 2min on, 2min off | Focus on effort not pace");
  });

  test("handles activity with no metrics_v2 gracefully", () => {
    const result = buildExecutionResultForSession(
      {
        id: "session-5",
        user_id: "user-1",
        sport: "bike",
        type: "Easy ride",
        duration_minutes: 60,
        status: "planned"
      },
      {
        id: "activity-5",
        sport_type: "bike",
        duration_sec: 3600,
        distance_m: 25000,
        avg_hr: 130,
        avg_power: 150,
        parse_summary: null,
        metrics_v2: null
      }
    );

    expect(result.linkedActivityId).toBe("activity-5");
    expect(result.normalizedPower).toBeNull();
    expect(result.trainingStressScore).toBeNull();
    expect(result.avgCadence).toBeNull();
  });

  test("handles strength session with no distance", () => {
    const result = buildExecutionResultForSession(
      {
        id: "session-6",
        user_id: "user-1",
        sport: "strength",
        type: "Core workout",
        duration_minutes: 30,
        status: "planned"
      },
      {
        id: "activity-6",
        sport_type: "strength",
        duration_sec: 1800,
        distance_m: null,
        avg_hr: 110,
        avg_power: null,
        parse_summary: {},
        metrics_v2: {}
      }
    );

    expect(result.linkedActivityId).toBe("activity-6");
    expect(result.status).toBeDefined();
  });

  test("extracts elevation data from metrics_v2", () => {
    const result = buildExecutionResultForSession(
      {
        id: "session-7",
        user_id: "user-1",
        sport: "run",
        type: "Hill repeats",
        duration_minutes: 50,
        status: "planned"
      },
      {
        id: "activity-7",
        sport_type: "run",
        duration_sec: 3000,
        distance_m: 9000,
        avg_hr: 160,
        avg_power: null,
        parse_summary: {},
        metrics_v2: {
          elevation: { gainM: 250, lossM: 240 },
          cadence: { avgCadence: 90 }
        }
      }
    );

    expect(result.avgCadence).toBe(90);
    expect(result.elevationGainM).toBe(250);
  });
});

describe("shouldRefreshExecutionResultFromActivity", () => {
  test("returns true when execution result is null", () => {
    expect(shouldRefreshExecutionResultFromActivity(null, {
      id: "a1",
      sport_type: "run",
      duration_sec: 3600,
      distance_m: 10000,
      avg_hr: 150,
      avg_power: null,
      parse_summary: {},
      metrics_v2: {}
    })).toBe(true);
  });

  test("returns true when execution result is undefined", () => {
    expect(shouldRefreshExecutionResultFromActivity(undefined, {
      id: "a1",
      sport_type: "run",
      duration_sec: 3600,
      distance_m: 10000,
      avg_hr: 150,
      avg_power: null,
      parse_summary: {},
      metrics_v2: {}
    })).toBe(true);
  });

  test("returns false when execution result already has all metrics", () => {
    expect(shouldRefreshExecutionResultFromActivity(
      {
        normalizedPower: 200,
        trainingStressScore: 80,
        avgCadence: 85,
        firstHalfAvgHr: 140,
        lastHalfAvgHr: 150
      },
      {
        id: "a1",
        sport_type: "run",
        duration_sec: 3600,
        distance_m: 10000,
        avg_hr: 150,
        avg_power: 200,
        parse_summary: {},
        metrics_v2: {
          power: { normalizedPower: 200 },
          load: { trainingStressScore: 80 },
          cadence: { avgCadence: 85 },
          halves: { firstHalfAvgHr: 140, lastHalfAvgHr: 150 }
        }
      }
    )).toBe(false);
  });

  test("returns true when activity has normalizedPower but result does not", () => {
    expect(shouldRefreshExecutionResultFromActivity(
      { someOtherField: "value" },
      {
        id: "a1",
        sport_type: "bike",
        duration_sec: 3600,
        distance_m: 30000,
        avg_hr: 145,
        avg_power: 200,
        parse_summary: {},
        metrics_v2: {
          power: { normalizedPower: 210 }
        }
      }
    )).toBe(true);
  });

  test("returns true when activity has TSS but result does not", () => {
    expect(shouldRefreshExecutionResultFromActivity(
      { normalizedPower: 200 },
      {
        id: "a1",
        sport_type: "bike",
        duration_sec: 3600,
        distance_m: 30000,
        avg_hr: 145,
        avg_power: 200,
        parse_summary: {},
        metrics_v2: {
          power: { normalizedPower: 200 },
          load: { trainingStressScore: 95 }
        }
      }
    )).toBe(true);
  });

  test("returns true when activity has split metrics but result does not", () => {
    expect(shouldRefreshExecutionResultFromActivity(
      { normalizedPower: 200 },
      {
        id: "a1",
        sport_type: "run",
        duration_sec: 3600,
        distance_m: 10000,
        avg_hr: 150,
        avg_power: null,
        parse_summary: {},
        metrics_v2: {
          halves: { firstHalfAvgHr: 140, lastHalfAvgHr: 155 }
        }
      }
    )).toBe(true);
  });

  test("returns false when activity has no new metrics beyond what result already has", () => {
    expect(shouldRefreshExecutionResultFromActivity(
      { linkedActivityId: "a1" },
      {
        id: "a1",
        sport_type: "run",
        duration_sec: 3600,
        distance_m: 10000,
        avg_hr: 150,
        avg_power: null,
        parse_summary: {},
        metrics_v2: {}
      }
    )).toBe(false);
  });

  test("returns true for swim activity with lap structure but missing lengthCount", () => {
    expect(shouldRefreshExecutionResultFromActivity(
      { someField: 1 },
      {
        id: "a1",
        sport_type: "swim",
        duration_sec: 2700,
        distance_m: 2000,
        avg_hr: 140,
        avg_power: null,
        parse_summary: {},
        metrics_v2: {
          laps: [{ index: 0, distanceM: 100, durationSec: 120 }]
        }
      }
    )).toBe(true);
  });
});

describe("deriveWorkIntervalAvgPower", () => {
  const baseActivity = {
    id: "a1",
    sport_type: "bike",
    duration_sec: 3120,
    distance_m: 25000,
    avg_hr: 145,
    avg_power: 166,
  };

  test("returns duration-weighted average of work laps when target power is set", () => {
    // 2x10min at ~210W, with warm-up and recovery laps at ~120W
    const result = deriveWorkIntervalAvgPower({
      activity: {
        ...baseActivity,
        metrics_v2: {
          laps: [
            { index: 0, durationSec: 600, distanceM: 5000, avgPower: 120, avgHr: 125 },   // warm-up
            { index: 1, durationSec: 600, distanceM: 6000, avgPower: 210, avgHr: 165 },   // interval 1
            { index: 2, durationSec: 300, distanceM: 2500, avgPower: 100, avgHr: 130 },   // recovery
            { index: 3, durationSec: 600, distanceM: 6000, avgPower: 215, avgHr: 168 },   // interval 2
            { index: 4, durationSec: 600, distanceM: 5000, avgPower: 110, avgHr: 120 },   // cool-down
          ]
        }
      },
      targetBands: { power: { min: 200, max: 220 } },
      plannedIntervals: 2,
    });
    // Work laps: 600s@210W + 600s@215W → (126000+129000)/1200 = 212.5 → 213
    expect(result).toBe(213);
  });

  test("returns null when no laps available", () => {
    const result = deriveWorkIntervalAvgPower({
      activity: { ...baseActivity, metrics_v2: {} },
      targetBands: { power: { min: 200, max: 220 } },
      plannedIntervals: 2,
    });
    expect(result).toBeNull();
  });

  test("returns null when laps have no power data", () => {
    const result = deriveWorkIntervalAvgPower({
      activity: {
        ...baseActivity,
        metrics_v2: {
          laps: [
            { index: 0, durationSec: 600, distanceM: 5000, avgPower: null },
            { index: 1, durationSec: 600, distanceM: 6000, avgPower: null },
          ]
        }
      },
      targetBands: { power: { min: 200, max: 220 } },
      plannedIntervals: 2,
    });
    expect(result).toBeNull();
  });

  test("returns null when all laps have similar power (steady ride)", () => {
    // All laps at ~170W — no clear work/recovery split
    const result = deriveWorkIntervalAvgPower({
      activity: {
        ...baseActivity,
        metrics_v2: {
          laps: [
            { index: 0, durationSec: 600, distanceM: 5000, avgPower: 168 },
            { index: 1, durationSec: 600, distanceM: 5000, avgPower: 172 },
            { index: 2, durationSec: 600, distanceM: 5000, avgPower: 170 },
            { index: 3, durationSec: 600, distanceM: 5000, avgPower: 165 },
          ]
        }
      },
      targetBands: { power: { min: 160, max: 180 } },
      plannedIntervals: 2,
    });
    // All laps are above min*0.80 = 128W, so all qualify → workLaps === lapsWithPower → null
    expect(result).toBeNull();
  });

  test("uses relative clustering when no target bands are set", () => {
    // 2 high-power laps + 3 low-power laps, no target
    const result = deriveWorkIntervalAvgPower({
      activity: {
        ...baseActivity,
        metrics_v2: {
          laps: [
            { index: 0, durationSec: 600, distanceM: 5000, avgPower: 120 },
            { index: 1, durationSec: 600, distanceM: 6000, avgPower: 210 },
            { index: 2, durationSec: 300, distanceM: 2000, avgPower: 100 },
            { index: 3, durationSec: 600, distanceM: 6000, avgPower: 205 },
            { index: 4, durationSec: 600, distanceM: 5000, avgPower: 110 },
          ]
        }
      },
      targetBands: null,
      plannedIntervals: 2,
    });
    // Max lap power = 210, threshold = 210*0.70 = 147
    // Work laps: 600s@210W + 600s@205W → (126000+123000)/1200 = 207.5 → 208
    expect(result).toBe(208);
  });

  test("returns null when fewer than 2 work laps found", () => {
    const result = deriveWorkIntervalAvgPower({
      activity: {
        ...baseActivity,
        metrics_v2: {
          laps: [
            { index: 0, durationSec: 600, distanceM: 5000, avgPower: 120 },
            { index: 1, durationSec: 600, distanceM: 6000, avgPower: 210 },
            { index: 2, durationSec: 600, distanceM: 5000, avgPower: 110 },
          ]
        }
      },
      targetBands: { power: { min: 200, max: 220 } },
      plannedIntervals: 2,
    });
    // Only 1 lap at >=160W (200*0.80) → fewer than 2 work laps → null
    expect(result).toBeNull();
  });

  test("buildExecutionResultForSession includes avgIntervalPower in result", () => {
    const result = buildExecutionResultForSession(
      {
        id: "session-1",
        user_id: "user-1",
        sport: "bike",
        type: "Sweet spot intervals",
        duration_minutes: 52,
        target: "2x10min at 200-220 W",
        intent_category: "Sweet spot intervals",
        status: "planned"
      },
      {
        id: "activity-1",
        sport_type: "bike",
        duration_sec: 3120,
        distance_m: 25000,
        avg_hr: 145,
        avg_power: 166,
        parse_summary: {},
        metrics_v2: {
          power: { normalizedPower: 177 },
          laps: [
            { index: 0, durationSec: 600, distanceM: 5000, avgPower: 120, avgHr: 125 },
            { index: 1, durationSec: 600, distanceM: 6000, avgPower: 210, avgHr: 165 },
            { index: 2, durationSec: 300, distanceM: 2500, avgPower: 100, avgHr: 130 },
            { index: 3, durationSec: 600, distanceM: 6000, avgPower: 215, avgHr: 168 },
            { index: 4, durationSec: 600, distanceM: 5000, avgPower: 110, avgHr: 120 },
          ]
        }
      }
    );
    expect(result.avgIntervalPower).toBe(213);
  });
});
