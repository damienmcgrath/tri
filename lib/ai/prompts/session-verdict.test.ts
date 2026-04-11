import {
  buildFallbackVerdict,
  buildVerdictInstructions,
  humanizeExecutionResult,
  humanizeFeel,
  sanitizeRawFieldNames,
  type SessionVerdictContext
} from "./session-verdict";

/**
 * Minimal context factory for fallback tests. Callers override `feel` and
 * `activity` as needed. Kept inline (not a shared fixture) so tests are
 * readable without cross-referencing helpers.
 */
function makeCtx(overrides: Partial<SessionVerdictContext> = {}): SessionVerdictContext {
  return {
    session: {
      id: "sess-1",
      sport: "run",
      type: "Z2 run",
      sessionName: "Aerobic run",
      intentCategory: "easy endurance",
      target: "45 min Z2",
      notes: null,
      durationMinutes: 45,
      isKey: false,
      date: "2026-04-10"
    },
    activity: {
      durationSec: 2700,
      distanceM: 9000,
      avgHr: 142,
      avgPower: null,
      avgIntervalPower: null,
      avgPacePer100mSec: null,
      metrics: null
    },
    executionResult: { intentMatchStatus: "matched_intent" },
    feel: null,
    trainingBlock: {
      currentBlock: "Build",
      blockWeek: 2,
      blockTotalWeeks: 4,
      raceName: null,
      daysToRace: null
    },
    upcomingSessions: [],
    recentLoadTrend: null,
    ...overrides
  };
}

describe("humanizeExecutionResult", () => {
  test("omits execution_score and execution_score_band from output", () => {
    const result = humanizeExecutionResult({
      executionScore: 78,
      executionScoreBand: "On target",
      diagnosisConfidence: "high",
      intentMatchStatus: "matched_intent",
    });

    expect(result).not.toHaveProperty("execution_score");
    expect(result).not.toHaveProperty("execution_score_band");
    expect(result).toHaveProperty("confidence", "high");
    expect(result).toHaveProperty("intent_match", "matched");
  });

  test("returns null for null input", () => {
    expect(humanizeExecutionResult(null)).toBeNull();
  });
});

describe("sanitizeRawFieldNames", () => {
  describe("interval completion comparators", () => {
    test("maps >= to 'at least'", () => {
      expect(sanitizeRawFieldNames("interval completion >= 0.9")).toBe(
        "at least 90% of planned intervals completed"
      );
    });

    test("maps > to 'more than'", () => {
      expect(sanitizeRawFieldNames("interval completion > 0.9")).toBe(
        "more than 90% of planned intervals completed"
      );
    });

    test("maps < to 'less than'", () => {
      expect(sanitizeRawFieldNames("interval completion < 0.9")).toBe(
        "less than 90% of planned intervals completed"
      );
    });

    test("maps <= to 'at most'", () => {
      expect(sanitizeRawFieldNames("interval completion <= 0.9")).toBe(
        "at most 90% of planned intervals completed"
      );
    });

    test("maps ≥ 1.0 to 'all planned intervals completed'", () => {
      expect(sanitizeRawFieldNames("interval completion ≥ 1.0")).toBe(
        "all planned intervals completed"
      );
    });
  });

  describe("execution score stripping", () => {
    test("strips camelCase executionScore", () => {
      const result = sanitizeRawFieldNames("The executionScore was 78.");
      expect(result).not.toMatch(/execution.?score/i);
    });

    test("strips snake_case execution_score", () => {
      const result = sanitizeRawFieldNames("The execution_score is 78.");
      expect(result).not.toMatch(/execution.?score/i);
    });

    test("strips execution_score_band", () => {
      const result = sanitizeRawFieldNames("execution_score_band: high");
      expect(result).not.toMatch(/score.?band/i);
    });

    test("strips plain English 'execution score'", () => {
      const result = sanitizeRawFieldNames("The execution score of 78 looks good.");
      expect(result).not.toMatch(/execution score/i);
    });
  });
});

describe("humanizeFeel", () => {
  test("returns null for null input", () => {
    expect(humanizeFeel(null)).toBeNull();
  });

  test("returns null when every field is null", () => {
    expect(
      humanizeFeel({
        overallFeel: null,
        energyLevel: null,
        legsFeel: null,
        motivation: null,
        sleepQuality: null,
        lifeStress: null,
        note: null
      })
    ).toBeNull();
  });

  test("labels overall feel with both name and score", () => {
    const result = humanizeFeel({
      overallFeel: 1,
      energyLevel: null,
      legsFeel: null,
      motivation: null,
      sleepQuality: null,
      lifeStress: null,
      note: null
    });
    expect(result).toEqual({ overall: "Terrible (1/5)" });
  });

  test("labels all five overall-feel values", () => {
    const labels = [
      [1, "Terrible (1/5)"],
      [2, "Hard (2/5)"],
      [3, "OK (3/5)"],
      [4, "Good (4/5)"],
      [5, "Amazing (5/5)"]
    ] as const;
    for (const [score, expected] of labels) {
      expect(
        humanizeFeel({
          overallFeel: score,
          energyLevel: null,
          legsFeel: null,
          motivation: null,
          sleepQuality: null,
          lifeStress: null,
          note: null
        })
      ).toEqual({ overall: expected });
    }
  });

  test("includes all populated secondary fields", () => {
    const result = humanizeFeel({
      overallFeel: 3,
      energyLevel: "low",
      legsFeel: "heavy",
      motivation: "struggled",
      sleepQuality: "poor",
      lifeStress: "high",
      note: "Slept badly"
    });
    expect(result).toEqual({
      overall: "OK (3/5)",
      energy: "low",
      legs: "heavy",
      motivation: "struggled",
      sleep: "poor",
      lifeStress: "high",
      note: "Slept badly"
    });
  });

  test("truncates note to 280 characters", () => {
    const longNote = "a".repeat(400);
    const result = humanizeFeel({
      overallFeel: 4,
      energyLevel: null,
      legsFeel: null,
      motivation: null,
      sleepQuality: null,
      lifeStress: null,
      note: longNote
    });
    expect(result?.note).toHaveLength(280);
  });

  test("omits secondary fields that are null or empty", () => {
    const result = humanizeFeel({
      overallFeel: 4,
      energyLevel: null,
      legsFeel: "fresh",
      motivation: null,
      sleepQuality: null,
      lifeStress: null,
      note: null
    });
    expect(result).toEqual({ overall: "Good (4/5)", legs: "fresh" });
  });
});

describe("buildFallbackVerdict", () => {
  test("returns 'achieved' when metrics match intent and no feel is present", () => {
    const verdict = buildFallbackVerdict(makeCtx());
    expect(verdict.verdict_status).toBe("achieved");
    expect(verdict.adaptation_type).toBe("proceed");
    expect(verdict.execution_summary).not.toMatch(/athlete rated/i);
  });

  test("downgrades achieved to partial when overall feel is Terrible (1/5)", () => {
    const verdict = buildFallbackVerdict(
      makeCtx({
        feel: {
          overallFeel: 1,
          energyLevel: "low",
          legsFeel: "heavy",
          motivation: null,
          sleepQuality: null,
          lifeStress: null,
          note: null
        }
      })
    );
    expect(verdict.verdict_status).not.toBe("achieved");
    expect(verdict.verdict_status).toBe("partial");
    expect(verdict.adaptation_type).toBe("flag_review");
    expect(verdict.execution_summary).toMatch(/Terrible \(1\/5\)/);
    expect(verdict.adaptation_signal).toMatch(/conservatively|recovery/i);
  });

  test("downgrades achieved to partial when overall feel is Hard (2/5)", () => {
    const verdict = buildFallbackVerdict(
      makeCtx({
        feel: {
          overallFeel: 2,
          energyLevel: null,
          legsFeel: null,
          motivation: null,
          sleepQuality: null,
          lifeStress: null,
          note: null
        }
      })
    );
    expect(verdict.adaptation_type).toBe("flag_review");
    expect(verdict.execution_summary).toMatch(/Hard \(2\/5\)/);
  });

  test("preserves achieved when overall feel is Good (4/5)", () => {
    const verdict = buildFallbackVerdict(
      makeCtx({
        feel: {
          overallFeel: 4,
          energyLevel: "high",
          legsFeel: "fresh",
          motivation: null,
          sleepQuality: null,
          lifeStress: null,
          note: null
        }
      })
    );
    expect(verdict.verdict_status).toBe("achieved");
    expect(verdict.adaptation_type).toBe("proceed");
    expect(verdict.execution_summary).not.toMatch(/athlete rated/i);
  });

  test("includes the note in the summary when feel is poor and note is present", () => {
    const verdict = buildFallbackVerdict(
      makeCtx({
        feel: {
          overallFeel: 1,
          energyLevel: null,
          legsFeel: null,
          motivation: null,
          sleepQuality: null,
          lifeStress: null,
          note: "Woke up with a cold"
        }
      })
    );
    expect(verdict.execution_summary).toMatch(/Woke up with a cold/);
  });

  test("leaves status 'missed' untouched when there is no linked activity, even with poor feel", () => {
    const verdict = buildFallbackVerdict(
      makeCtx({
        activity: null,
        executionResult: null,
        feel: {
          overallFeel: 1,
          energyLevel: null,
          legsFeel: null,
          motivation: null,
          sleepQuality: null,
          lifeStress: null,
          note: null
        }
      })
    );
    // No activity → feel override does not fire; existing "missed" path wins.
    expect(verdict.verdict_status).toBe("missed");
  });
});

describe("buildVerdictInstructions", () => {
  test("contains the FEEL DATA critical block", () => {
    const text = buildVerdictInstructions();
    expect(text).toMatch(/FEEL DATA — CRITICAL/);
    expect(text).toMatch(/Contradiction rule/);
    expect(text).toMatch(/Inverse rule/);
  });

  test("no longer uses the soft 'acknowledge the mismatch' phrasing", () => {
    const text = buildVerdictInstructions();
    expect(text).not.toMatch(/acknowledge the mismatch explicitly/);
  });

  test("keeps existing swim metric rules", () => {
    const text = buildVerdictInstructions();
    expect(text).toMatch(/Swim metric rules/);
  });
});
