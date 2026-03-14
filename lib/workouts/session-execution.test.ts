import { buildExecutionResultForSession } from "./session-execution";

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
});
