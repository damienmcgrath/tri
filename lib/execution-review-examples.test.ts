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
});
