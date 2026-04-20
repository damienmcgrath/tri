import { weeklyFindingsSchema, type WeeklyFindings } from "./analytic-findings";

describe("weeklyFindingsSchema", () => {
  const validFindings: WeeklyFindings = {
    weekCharacter: "Consolidation week — volume held while intensity rose",
    patterns: [
      {
        claim: "Every threshold effort this week was preceded by fatigue ≥4",
        evidence: "Tue threshold run (fatigue 4/5), Thu threshold bike (fatigue 5/5), Sat tempo run (fatigue 4/5)"
      },
      {
        claim: "Z2 pace-at-HR improved 12s/km across two easy runs",
        evidence: "Mon easy 5:24/km @ 142bpm vs. Fri easy 5:12/km @ 141bpm"
      }
    ],
    primaryInsight: {
      insight: "Threshold ceiling is holding while aerobic base expands — easy pace at the same HR improved 12s/km this week.",
      sourceSignals: ["z2-pace-at-hr", "rolling-trend-4wk"],
      confidence: "medium"
    },
    tensions: [
      "Composite score rose but durability fade increased late in the threshold bike"
    ],
    carryForwardCandidates: [
      "Keep the Tue/Thu threshold spacing — it is producing gains without decoupling.",
      "If fatigue reports another 4+ before a hard session, swap the hard day for Z2 rather than pushing through."
    ],
    confidenceNote: null
  };

  test("accepts a well-formed findings payload", () => {
    const parsed = weeklyFindingsSchema.safeParse(validFindings);
    expect(parsed.success).toBe(true);
  });

  test("rejects empty patterns array", () => {
    const parsed = weeklyFindingsSchema.safeParse({ ...validFindings, patterns: [] });
    expect(parsed.success).toBe(false);
  });

  test("rejects more than 4 patterns", () => {
    const parsed = weeklyFindingsSchema.safeParse({
      ...validFindings,
      patterns: Array.from({ length: 5 }, (_, i) => ({
        claim: `claim ${i}`,
        evidence: `evidence ${i}`
      }))
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects fewer than 2 carryForwardCandidates", () => {
    const parsed = weeklyFindingsSchema.safeParse({
      ...validFindings,
      carryForwardCandidates: ["only one"]
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects primaryInsight without any sourceSignals", () => {
    const parsed = weeklyFindingsSchema.safeParse({
      ...validFindings,
      primaryInsight: { ...validFindings.primaryInsight, sourceSignals: [] }
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects invalid confidence value", () => {
    const parsed = weeklyFindingsSchema.safeParse({
      ...validFindings,
      primaryInsight: { ...validFindings.primaryInsight, confidence: "certain" }
    });
    expect(parsed.success).toBe(false);
  });

  test("accepts empty tensions array (upper-bounded, not required)", () => {
    const parsed = weeklyFindingsSchema.safeParse({ ...validFindings, tensions: [] });
    expect(parsed.success).toBe(true);
  });

  test("accepts nullable confidenceNote", () => {
    const withNote = weeklyFindingsSchema.safeParse({
      ...validFindings,
      confidenceNote: "Only 2 threshold sessions this week; pattern is suggestive not conclusive."
    });
    expect(withNote.success).toBe(true);
  });
});
