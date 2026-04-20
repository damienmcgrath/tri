import { sessionVerdictOutputSchema } from "./session-verdict";
import { SESSION_VERDICT_FEW_SHOT } from "./session-verdict-examples";

describe("SESSION_VERDICT_FEW_SHOT", () => {
  test("has 2–3 realistic examples", () => {
    expect(SESSION_VERDICT_FEW_SHOT.length).toBeGreaterThanOrEqual(2);
    expect(SESSION_VERDICT_FEW_SHOT.length).toBeLessThanOrEqual(4);
  });

  test.each(SESSION_VERDICT_FEW_SHOT.map((example, index) => [index, example]))(
    "example %i parses under sessionVerdictOutputSchema",
    (_index, example) => {
      const parsed = sessionVerdictOutputSchema.safeParse(example);
      expect(parsed.success).toBe(true);
    }
  );

  test("every example emits a non_obvious_insight and declares teach (string or null)", () => {
    for (const example of SESSION_VERDICT_FEW_SHOT) {
      expect(example.non_obvious_insight.length).toBeGreaterThan(0);
      expect(example.teach === null || typeof example.teach === "string").toBe(true);
    }
  });
});
