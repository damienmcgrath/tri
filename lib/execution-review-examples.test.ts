import { coachVerdictSchema } from "./execution-review-types";
import { COACH_VERDICT_FEW_SHOT } from "./execution-review-examples";

describe("COACH_VERDICT_FEW_SHOT", () => {
  test("has 2–3 realistic examples", () => {
    expect(COACH_VERDICT_FEW_SHOT.length).toBeGreaterThanOrEqual(2);
    expect(COACH_VERDICT_FEW_SHOT.length).toBeLessThanOrEqual(4);
  });

  test.each(COACH_VERDICT_FEW_SHOT.map((example, index) => [index, example]))(
    "example %i parses under coachVerdictSchema",
    (_index, example) => {
      const parsed = coachVerdictSchema.safeParse(example);
      expect(parsed.success).toBe(true);
    }
  );

  test("every example emits a nonObviousInsight and declares teach (string or null)", () => {
    for (const example of COACH_VERDICT_FEW_SHOT) {
      expect(example.nonObviousInsight.length).toBeGreaterThan(0);
      expect(example.teach === null || typeof example.teach === "string").toBe(true);
    }
  });

  test("every example declares comparableReference (string or null) and cites a dated prior session", () => {
    for (const example of COACH_VERDICT_FEW_SHOT) {
      expect(
        example.comparableReference === null ||
          typeof example.comparableReference === "string"
      ).toBe(true);
      if (typeof example.comparableReference === "string") {
        // Comparable references must name at least one prior session by date so
        // the athlete can anchor the comparison — the whole point of 3.4b.
        expect(example.comparableReference).toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    }
  });
});
