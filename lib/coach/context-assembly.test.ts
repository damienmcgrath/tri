import {
  estimateTokenCount,
  budgetContext,
  makeSlice,
  formatAssembledContext,
  getRequiredSliceLabels,
} from "./context-assembly";

describe("estimateTokenCount", () => {
  it("estimates ~1 token per 4 characters", () => {
    expect(estimateTokenCount("hello world")).toBe(3); // 11 chars / 4 = 2.75 → 3
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });
});

describe("budgetContext", () => {
  it("keeps all slices when under budget", () => {
    const slices = [
      makeSlice("A", "short content", 10),
      makeSlice("B", "more content here", 5),
    ];

    const result = budgetContext(slices, 10000);
    expect(result.slices).toHaveLength(2);
    expect(result.trimmed).toBe(false);
  });

  it("trims low-priority slices when over budget", () => {
    const slices = [
      makeSlice("High", "a".repeat(2000), 10), // ~500 tokens
      makeSlice("Medium", "b".repeat(2000), 5), // ~500 tokens
      makeSlice("Low", "c".repeat(2000), 1), // ~500 tokens
    ];

    const result = budgetContext(slices, 700);
    expect(result.trimmed).toBe(true);
    expect(result.slices.length).toBeLessThan(3);
    // High priority should be kept
    expect(result.slices.some((s) => s.label === "High")).toBe(true);
  });

  it("prioritizes higher priority slices", () => {
    const slices = [
      makeSlice("Low", "x".repeat(400), 1),
      makeSlice("High", "y".repeat(400), 10),
    ];

    const result = budgetContext(slices, 150);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0]?.label).toBe("High");
  });
});

describe("formatAssembledContext", () => {
  it("formats slices with labels", () => {
    const assembled = {
      slices: [
        makeSlice("Recent Verdicts", "Session was great", 10),
        makeSlice("Training Score", "Score: 82", 5),
      ],
      totalTokens: 20,
      trimmed: false,
    };

    const result = formatAssembledContext(assembled);
    expect(result).toContain("--- Recent Verdicts ---");
    expect(result).toContain("Session was great");
    expect(result).toContain("--- Training Score ---");
  });

  it("returns empty string for no slices", () => {
    expect(formatAssembledContext({ slices: [], totalTokens: 0, trimmed: false })).toBe("");
  });
});

describe("getRequiredSliceLabels", () => {
  it("returns labels for enabled slices", () => {
    const labels = getRequiredSliceLabels({
      includeRecentVerdicts: true,
      includeRecentFeels: false,
      includeTrainingScore: true,
      includeUpcomingSessions: false,
      includeWeeklyDebrief: false,
      includeDisciplineBalance: true,
      includeSeasonContext: false,
      includeComparisonTrends: false,
      includeMorningBrief: false,
      includePastConversations: false,
      maxConversationHistory: 10,
    });

    expect(labels).toContain("recent_verdicts");
    expect(labels).toContain("training_score");
    expect(labels).toContain("discipline_balance");
    expect(labels).not.toContain("upcoming_sessions");
  });
});
