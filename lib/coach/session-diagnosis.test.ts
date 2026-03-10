import { diagnoseCompletedSession } from "./session-diagnosis";

describe("diagnoseCompletedSession", () => {
  test("flags easy endurance session as missed when too hard, drifted, and variable", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "run",
        intentCategory: "Easy Z2 run",
        plannedDurationSec: 3600,
        targetBands: { hr: { max: 145 } }
      },
      actual: {
        durationSec: 3600,
        avgHr: 158,
        timeAboveTargetPct: 0.32,
        variabilityIndex: 1.15,
        splitMetrics: { firstHalfAvgHr: 150, lastHalfAvgHr: 162 }
      }
    });

    expect(diagnosis.intentMatchStatus).toBe("missed_intent");
    expect(diagnosis.executionScoreBand).toBe("Missed intent");
    expect(diagnosis.executionScore).toBeLessThan(65);
    expect(diagnosis.diagnosisConfidence).toBe("high");
  });

  test("flags recovery session compliance issues", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "bike",
        intentCategory: "Recovery spin",
        targetBands: { power: { max: 170 } }
      },
      actual: {
        avgPower: 190,
        variabilityIndex: 1.14
      }
    });

    expect(diagnosis.intentMatchStatus).toBe("missed_intent");
    expect(diagnosis.executionSummary).toMatch(/Recovery intent/);
  });

  test("detects threshold under-target and incomplete reps", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "run",
        intentCategory: "Threshold intervals",
        plannedDurationSec: 4200,
        plannedIntervals: 6,
        targetBands: { hr: { min: 165, max: 175 } }
      },
      actual: {
        durationSec: 3500,
        avgHr: 152,
        completedIntervals: 4,
        variabilityIndex: 1.21
      }
    });

    expect(diagnosis.intentMatchStatus).toBe("missed_intent");
    expect(diagnosis.recommendedNextAction).toMatch(/recoveries|structure/i);
  });

  test("detects long endurance started too hard and faded", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "run",
        intentCategory: "Long endurance run",
        plannedDurationSec: 9000
      },
      actual: {
        durationSec: 7600,
        timeAboveTargetPct: 0.25,
        splitMetrics: {
          firstHalfAvgHr: 160,
          lastHalfAvgHr: 148,
          firstHalfPaceSPerKm: 300,
          lastHalfPaceSPerKm: 345
        }
      }
    });

    expect(diagnosis.intentMatchStatus).toBe("missed_intent");
    expect(diagnosis.whyItMatters).toMatch(/Pacing errors/);
  });

  test("handles swim sessions with sparse metrics using duration and completion", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "swim",
        intentCategory: "Aerobic swim",
        plannedDurationSec: 3000,
        plannedIntervals: 10
      },
      actual: {
        durationSec: 2900,
        completedIntervals: 10
      }
    });

    expect(diagnosis.intentMatchStatus).toBe("matched_intent");
    expect(diagnosis.executionScoreBand).toBe("On target");
    expect(diagnosis.diagnosisConfidence).toBe("medium");
  });

  test("degrades gracefully with unknown intent and sparse data", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "other",
        intentCategory: null
      },
      actual: {}
    });

    expect(diagnosis.intentMatchStatus).toBe("partial_intent");
    expect(diagnosis.executionScore).toBeNull();
    expect(diagnosis.executionScoreProvisional).toBe(true);
    expect(diagnosis.diagnosisConfidence).toBe("low");
    expect(diagnosis.whyItMatters).toMatch(/Low data quality/);
  });
});
