import { humanizeExecutionResult, sanitizeRawFieldNames } from "./session-verdict";

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
