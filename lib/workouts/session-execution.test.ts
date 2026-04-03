import { buildExecutionResultForSession, shouldRefreshExecutionResultFromActivity } from "./session-execution";

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
