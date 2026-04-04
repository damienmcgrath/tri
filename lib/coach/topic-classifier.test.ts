import { classifyTopic, selectContextSlices } from "./topic-classifier";

describe("classifyTopic", () => {
  it("classifies session-specific questions", () => {
    const result = classifyTopic("How did my long run go yesterday?");
    expect(result.primary).toBe("session_review");
  });

  it("classifies fatigue concerns", () => {
    const result = classifyTopic("I'm feeling really tired and sore after this week");
    expect(result.primary).toBe("fatigue_concern");
  });

  it("classifies adaptation requests", () => {
    const result = classifyTopic("Can you move my Thursday session to Friday?");
    expect(result.primary).toBe("adaptation_request");
  });

  it("classifies race prep questions", () => {
    const result = classifyTopic("How should I taper for my race in 3 weeks?");
    expect(result.primary).toBe("race_prep");
  });

  it("classifies discipline balance questions", () => {
    const result = classifyTopic("What's my biggest limiter right now?");
    expect(result.primary).toBe("discipline_balance");
  });

  it("classifies performance analysis questions", () => {
    const result = classifyTopic("Am I improving or declining on my run pace?");
    expect(result.primary).toBe("performance_analysis");
  });

  it("classifies plan questions", () => {
    const result = classifyTopic("What's planned for this week?");
    expect(result.primary).toBe("plan_question");
  });

  it("defaults to general_question for unrecognized messages", () => {
    const result = classifyTopic("Hello coach!");
    expect(result.primary).toBe("general_question");
    expect(result.confidence).toBe("low");
  });

  it("detects secondary topics", () => {
    const result = classifyTopic("I'm tired after my threshold run yesterday. Should I adjust this week?");
    expect(["fatigue_concern", "session_review", "adaptation_request"]).toContain(result.primary);
    expect(result.secondary).not.toBeNull();
  });
});

describe("selectContextSlices", () => {
  it("includes verdicts and feels for session review", () => {
    const config = selectContextSlices({ primary: "session_review", secondary: null, confidence: "high" });
    expect(config.includeRecentVerdicts).toBe(true);
    expect(config.includeRecentFeels).toBe(true);
    expect(config.includeDisciplineBalance).toBe(false);
  });

  it("includes balance for discipline_balance topic", () => {
    const config = selectContextSlices({ primary: "discipline_balance", secondary: null, confidence: "high" });
    expect(config.includeDisciplineBalance).toBe(true);
    expect(config.includeComparisonTrends).toBe(true);
  });

  it("includes season context for race prep", () => {
    const config = selectContextSlices({ primary: "race_prep", secondary: null, confidence: "high" });
    expect(config.includeSeasonContext).toBe(true);
    expect(config.includeTrainingScore).toBe(true);
  });

  it("includes broader context for general questions", () => {
    const config = selectContextSlices({ primary: "general_question", secondary: null, confidence: "low" });
    expect(config.includeTrainingScore).toBe(true);
    expect(config.includeRecentVerdicts).toBe(true);
    expect(config.includePastConversations).toBe(true);
  });
});
