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
    expect(diagnosis.executionScore).toBeLessThan(55);
    expect(diagnosis.diagnosisConfidence).toBe("high");
    expect(diagnosis.componentScores).not.toBeNull();
    expect(diagnosis.componentScores!.intentMatch.weight).toBe(0.40);
    expect(diagnosis.componentScores!.recoveryCompliance.score).toBeLessThan(60);
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
    expect(diagnosis.componentScores).not.toBeNull();
    expect(diagnosis.componentScores!.recoveryCompliance.score).toBeLessThan(80);
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
    expect(diagnosis.componentScores).not.toBeNull();
    expect(diagnosis.componentScores!.completion.score).toBeLessThan(75);
    expect(diagnosis.componentScores!.intentMatch.score).toBeLessThan(55);
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
    expect(diagnosis.componentScores).not.toBeNull();
    expect(diagnosis.componentScores!.pacingExecution.score).toBeLessThan(70);
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
    expect(diagnosis.whyItMatters).toMatch(/Matching the planned session intent|supports the rest of the week/i);
    expect(diagnosis.recommendedNextAction).toMatch(/Good control|execution approach/i);
    expect(diagnosis.componentScores).not.toBeNull();
    expect(diagnosis.componentScores!.composite).toBeGreaterThanOrEqual(90);
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
    expect(diagnosis.componentScores).toBeNull();
  });

  test("component scores produce correct weights summing to 1.0", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "run",
        intentCategory: "Easy Z2 run",
        plannedDurationSec: 3600
      },
      actual: {
        durationSec: 3600,
        avgHr: 140,
        timeAboveTargetPct: 0.02
      }
    });

    expect(diagnosis.componentScores).not.toBeNull();
    const cs = diagnosis.componentScores!;
    const totalWeight = cs.intentMatch.weight + cs.pacingExecution.weight + cs.completion.weight + cs.recoveryCompliance.weight;
    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  test("composite score equals weighted sum of component scores", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "bike",
        intentCategory: "Threshold intervals",
        plannedDurationSec: 3600,
        plannedIntervals: 5,
        targetBands: { power: { min: 240, max: 260 } }
      },
      actual: {
        durationSec: 3500,
        avgPower: 250,
        completedIntervals: 5,
        variabilityIndex: 1.05
      }
    });

    expect(diagnosis.componentScores).not.toBeNull();
    const cs = diagnosis.componentScores!;
    const expected = Math.round(
      cs.intentMatch.score * cs.intentMatch.weight +
      cs.pacingExecution.score * cs.pacingExecution.weight +
      cs.completion.score * cs.completion.weight +
      cs.recoveryCompliance.score * cs.recoveryCompliance.weight
    );
    expect(cs.composite).toBe(expected);
  });

  test("recovery compliance penalizes high TSS on recovery sessions", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "bike",
        intentCategory: "Recovery spin",
        plannedDurationSec: 2400,
        targetBands: { power: { max: 150 } }
      },
      actual: {
        durationSec: 2400,
        avgPower: 145,
        timeAboveTargetPct: 0.05
      },
      sessionTss: 95
    });

    expect(diagnosis.componentScores).not.toBeNull();
    expect(diagnosis.componentScores!.recoveryCompliance.score).toBeLessThan(85);
    expect(diagnosis.componentScores!.recoveryCompliance.detail).toMatch(/TSS too high/);
  });

  test("threshold evaluation uses avgIntervalPower when available", () => {
    // Session avg is 166W (below target) but interval avg is 210W (on target)
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "bike",
        intentCategory: "Sweet spot intervals",
        plannedDurationSec: 3120,
        plannedIntervals: 2,
        targetBands: { power: { min: 200, max: 220 } }
      },
      actual: {
        durationSec: 3060,
        avgPower: 166,
        avgIntervalPower: 210,
        completedIntervals: 2,
        variabilityIndex: 1.08
      }
    });

    // Should NOT flag under_target because interval power (210W) is within range
    expect(diagnosis.detectedIssues).not.toContain("under_target");
    expect(diagnosis.intentMatchStatus).not.toBe("missed_intent");
  });

  test("threshold evaluation falls back to avgPower when avgIntervalPower is null", () => {
    // No interval power available, session avg 166W is well below 200W target
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "bike",
        intentCategory: "Sweet spot intervals",
        plannedDurationSec: 3120,
        plannedIntervals: 2,
        targetBands: { power: { min: 200, max: 220 } }
      },
      actual: {
        durationSec: 3060,
        avgPower: 166,
        avgIntervalPower: null,
        completedIntervals: 2,
        variabilityIndex: 1.08
      }
    });

    // Should flag under_target because session power (166W) < 200*0.92 = 184W
    expect(diagnosis.detectedIssues).toContain("under_target");
  });

  test("threshold evaluation detects over_target using interval power", () => {
    const diagnosis = diagnoseCompletedSession({
      planned: {
        sport: "bike",
        intentCategory: "Threshold intervals",
        plannedDurationSec: 3600,
        plannedIntervals: 3,
        targetBands: { power: { min: 200, max: 220 } }
      },
      actual: {
        durationSec: 3500,
        avgPower: 200,
        avgIntervalPower: 245,
        completedIntervals: 3,
      }
    });

    // 245 > 220*1.06 = 233.2 → should flag over_target
    expect(diagnosis.detectedIssues).toContain("over_target");
  });
});
