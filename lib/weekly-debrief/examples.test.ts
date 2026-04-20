import { weeklyDebriefNarrativeSchema } from "./types";
import { WEEKLY_NARRATIVE_FEW_SHOT } from "./examples";

describe("WEEKLY_NARRATIVE_FEW_SHOT", () => {
  test("has 2–3 realistic examples", () => {
    expect(WEEKLY_NARRATIVE_FEW_SHOT.length).toBeGreaterThanOrEqual(2);
    expect(WEEKLY_NARRATIVE_FEW_SHOT.length).toBeLessThanOrEqual(4);
  });

  test.each(WEEKLY_NARRATIVE_FEW_SHOT.map((example, index) => [index, example]))(
    "example %i parses under weeklyDebriefNarrativeSchema",
    (_index, example) => {
      const parsed = weeklyDebriefNarrativeSchema.safeParse(example);
      expect(parsed.success).toBe(true);
    }
  );

  test("every example emits a nonObviousInsight and declares teach (string or null)", () => {
    for (const example of WEEKLY_NARRATIVE_FEW_SHOT) {
      expect(example.nonObviousInsight.length).toBeGreaterThan(0);
      expect(example.teach === null || typeof example.teach === "string").toBe(true);
    }
  });
});
