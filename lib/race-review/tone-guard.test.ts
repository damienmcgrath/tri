import { scanForToneViolations, buildReinforcementSystemMessage } from "./tone-guard";

describe("scanForToneViolations", () => {
  it("returns empty when payload is tone-compliant", () => {
    expect(
      scanForToneViolations({
        verdict: { headline: "Finished in 2:34:12, came in at +0:42 over goal." }
      })
    ).toEqual([]);
  });

  it("flags 'should have'", () => {
    const violations = scanForToneViolations({
      verdict: { headline: "Should have held the bike steadier." }
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("should_have");
    expect(violations[0].path).toBe("verdict.headline");
  });

  it("flags 'failed'", () => {
    const violations = scanForToneViolations({
      raceStory: { overall: "The pacing failed in the second half." }
    });
    expect(violations.some((v) => v.rule === "failed")).toBe(true);
  });

  it("flags 'missed'", () => {
    const violations = scanForToneViolations({
      verdict: { coachTake: { target: "You missed the goal — try again." } }
    });
    expect(violations.some((v) => v.rule === "missed")).toBe(true);
  });

  it("flags 'must'", () => {
    const violations = scanForToneViolations({
      verdict: { coachTake: { progression: "You must hold steadier next time." } }
    });
    expect(violations.some((v) => v.rule === "must")).toBe(true);
  });

  it("walks nested arrays", () => {
    const violations = scanForToneViolations({
      raceStory: {
        perLeg: { run: { keyEvidence: ["Pace held", "You should have negative-split"] } }
      }
    });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].path).toContain("keyEvidence");
  });

  it("handles null and missing fields", () => {
    expect(scanForToneViolations(null)).toEqual([]);
    expect(scanForToneViolations({})).toEqual([]);
  });
});

describe("buildReinforcementSystemMessage", () => {
  it("includes the matched phrases verbatim", () => {
    const message = buildReinforcementSystemMessage([
      { path: "verdict.headline", match: "should have", rule: "should_have" }
    ]);
    expect(message).toContain('"should have"');
    expect(message).toMatch(/never use/i);
  });
});
