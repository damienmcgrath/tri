import { createReviewViewModel } from "./session-review";

describe("createReviewViewModel", () => {
  test("treats a completed session as a post-execution review with a scored summary", () => {
    const vm = createReviewViewModel({
      id: "1",
      date: "2026-03-10",
      sport: "run",
      type: "Run",
      intent_category: "Threshold intervals",
      duration_minutes: 65,
      status: "completed",
      execution_result: {
        status: "partial_intent",
        executionScore: 68,
        executionScoreBand: "Partial match",
        executionScoreSummary: "Threshold work drifted late and a few reps fell short.",
        intervalCompletionPct: 0.67,
        durationCompletion: 0.88,
        recommendedNextAction: "Start the first rep slightly easier so you can complete the full set."
      }
    });

    expect(vm.reviewModeLabel).toBe("Post-execution review");
    expect(vm.sessionStatusLabel).toBe("Completed");
    expect(vm.intent.label).toBe("Partial match");
    expect(vm.scoreHeadline).toBe("68 · Partial match");
    expect(vm.mainGap).toMatch(/Threshold reps were under target|left incomplete/i);
    expect(vm.actualExecutionSummary).toMatch(/Threshold work was only partially completed/i);
  });

  test("avoids misleading completed semantics for planned sessions with no execution evidence", () => {
    const vm = createReviewViewModel({
      id: "2",
      date: "2026-03-11",
      sport: "bike",
      type: "Bike",
      intent_category: "Easy aerobic ride",
      duration_minutes: 75,
      status: "planned",
      execution_result: null
    });

    expect(vm.isReviewable).toBe(false);
    expect(vm.reviewModeLabel).toBe("Not reviewable yet");
    expect(vm.sessionStatusLabel).toBe("Planned");
    expect(vm.intent.label).toBe("Pending review");
    expect(vm.scoreHeadline).toBe("Not yet scored");
    expect(vm.mainGap).toMatch(/has not been completed/i);
    expect(vm.unlockTitle).toBe("What unlocks review");
    expect(vm.unlockDetail).toMatch(/unlock planned vs actual analysis/i);
  });

  test("uses a clean provisional score fallback when evidence is limited", () => {
    const vm = createReviewViewModel({
      id: "3",
      date: "2026-03-12",
      sport: "run",
      type: "Run",
      intent_category: "Easy endurance run",
      duration_minutes: 50,
      status: "completed",
      execution_result: {
        status: "partial_intent",
        executionScore: 74,
        executionScoreBand: "Partial match",
        executionScoreProvisional: true,
        executionScoreSummary: "Easy run drifted a bit too hard.",
        timeAboveTargetPct: 0.24,
        firstHalfAvgHr: 145,
        lastHalfAvgHr: 156
      }
    });

    expect(vm.scoreHeadline).toBe("Provisional · Partial match");
    expect(vm.scoreInterpretation).toMatch(/early read/i);
    expect(vm.scoreConfidenceNote).toMatch(/band looks useful/i);
    expect(vm.mainGap).toMatch(/Easy session drifted too hard/i);
  });

  test("does not ask for a re-upload when a workout is already linked", () => {
    const vm = createReviewViewModel({
      id: "3b",
      date: "2026-03-12",
      sport: "swim",
      type: "Swim",
      intent_category: "Aerobic swim",
      duration_minutes: 60,
      status: "planned",
      execution_result: null,
      has_linked_activity: true
    });

    expect(vm.reviewModeLabel).toBe("Analysis pending");
    expect(vm.sessionStatusLabel).toBe("Activity linked");
    expect(vm.intent.label).toBe("Analysis pending");
    expect(vm.scoreHeadline).toBe("Awaiting score");
    expect(vm.unlockDetail).toMatch(/already attached|already linked/i);
    expect(vm.nextAction).toMatch(/No re-upload is needed/i);
  });

  test("keeps strong positive language when the session matched intent well", () => {
    const vm = createReviewViewModel({
      id: "4",
      date: "2026-03-12",
      sport: "swim",
      type: "Swim",
      intent_category: "Aerobic swim",
      duration_minutes: 45,
      status: "completed",
      execution_result: {
        status: "matched_intent",
        executionScore: 91,
        executionScoreBand: "On target",
        executionScoreSummary: "Execution stayed aligned with the planned intent.",
        intervalCompletionPct: 1
      }
    });

    expect(vm.intent.label).toBe("Matched intent");
    expect(vm.scoreHeadline).toBe("91 · On target");
    expect(vm.actualExecutionSummary).toMatch(/delivered the intended training stimulus|planned quality stimulus/i);
    expect(vm.mainGap).toBe("Session matched intent well. Keep the same execution approach next time.");
    expect(vm.weekAction).toMatch(/Keep the next key session as planned/i);
    expect(vm.whyItMatters).toMatch(/Matching the planned session intent|planned quality stimulus/i);
    expect(vm.nextAction).toMatch(/Good control|Keep the same execution approach/i);
  });

  test("uses extra-session framing instead of planned-intent framing for unplanned work", () => {
    const vm = createReviewViewModel({
      id: "extra-1",
      date: "2026-03-13",
      sport: "bike",
      type: "Extra workout",
      duration_minutes: 30,
      status: "completed",
      is_extra: true,
      execution_result: {
        status: "matched_intent",
        executionScore: 88,
        executionScoreBand: "On target",
        executionScoreSummary: "Steady aerobic ride with controlled effort."
      }
    });

    expect(vm.reviewModeLabel).toBe("Extra session review");
    expect(vm.sessionStatusLabel).toBe("Extra workout");
    expect(vm.plannedIntent).toBe("No planned intent. Review this as additional weekly load.");
    expect(vm.mainGap).toMatch(/no planned target/i);
    expect(vm.unlockTitle).toBe("Weekly context");
    expect(vm.followUpIntro).toMatch(/extra session/i);
    expect(vm.followUpPrompts[0]).toMatch(/help or hurt the week/i);
  });
});
