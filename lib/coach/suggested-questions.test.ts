import { generateSuggestedQuestions, type AthleteState } from "./suggested-questions";

function makeState(overrides: Partial<AthleteState> = {}): AthleteState {
  return {
    raceName: "Hamburg 70.3",
    daysToRace: 56,
    readiness: "absorbing",
    recentMissedSession: null,
    fatigueTrend: "stable",
    hasActiveRebalancingRec: false,
    todaysSession: null,
    currentBlock: "Build",
    weeklyCompletion: 0.8,
    ...overrides,
  };
}

describe("generateSuggestedQuestions", () => {
  it("returns 3-4 questions", () => {
    const questions = generateSuggestedQuestions(makeState());
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions.length).toBeLessThanOrEqual(4);
  });

  it("includes missed session question when present", () => {
    const questions = generateSuggestedQuestions(makeState({ recentMissedSession: "threshold run" }));
    expect(questions.some((q) => q.includes("threshold run"))).toBe(true);
  });

  it("includes fatigue question when overreaching", () => {
    const questions = generateSuggestedQuestions(makeState({ readiness: "overreaching" }));
    expect(questions.some((q) => q.includes("reduce"))).toBe(true);
  });

  it("includes limiter question when rebalancing rec active", () => {
    const questions = generateSuggestedQuestions(makeState({ hasActiveRebalancingRec: true }));
    expect(questions.some((q) => q.includes("limiter"))).toBe(true);
  });

  it("includes race tracking when race is near", () => {
    const questions = generateSuggestedQuestions(makeState({ daysToRace: 30 }));
    expect(questions.some((q) => q.includes("Hamburg 70.3"))).toBe(true);
  });

  it("includes today's session question", () => {
    const questions = generateSuggestedQuestions(makeState({ todaysSession: "tempo swim" }));
    expect(questions.some((q) => q.includes("tempo swim"))).toBe(true);
  });

  it("includes salvage question when low completion", () => {
    const questions = generateSuggestedQuestions(makeState({ weeklyCompletion: 0.4 }));
    expect(questions.some((q) => q.includes("salvage"))).toBe(true);
  });

  it("always includes fallback questions", () => {
    const questions = generateSuggestedQuestions(makeState({
      raceName: null,
      daysToRace: null,
      todaysSession: null,
      currentBlock: null,
    }));
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.some((q) => q.includes("Training Score") || q.includes("focus"))).toBe(true);
  });
});
