import { createReviewViewModel, sanitizeFieldNames } from "./session-review";

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
    expect(vm.mainGapLabel).toBe("Key confirmation");
    expect(vm.mainGap).toBe("Session matched intent well. Keep the same execution approach next time.");
    expect(vm.weekAction).toMatch(/Keep the next key session as planned/i);
    expect(vm.whyItMatters).toMatch(/Matching the planned session intent|planned quality stimulus/i);
    expect(vm.nextAction).toMatch(/Good control|Keep the same execution approach/i);
  });

  test("exposes whether a persisted review was AI or fallback generated", () => {
    const aiVm = createReviewViewModel({
      id: "ai-1",
      date: "2026-03-12",
      sport: "bike",
      type: "Bike",
      intent_category: "Tempo ride",
      duration_minutes: 60,
      status: "completed",
      execution_result: {
        version: 2,
        linkedActivityId: "activity-1",
        deterministic: {
          sessionId: "ai-1",
          athleteId: "athlete-1",
          sport: "bike",
          planned: {
            title: "Tempo ride",
            intentCategory: "Tempo ride",
            durationSec: 3600,
            targetBands: null,
            plannedIntervals: null,
            sessionRole: "supporting"
          },
          actual: {
            durationSec: 3600,
            avgHr: 142,
            avgPower: 210,
            avgPaceSPerKm: null,
            timeAboveTargetPct: 0.08,
            intervalCompletionPct: 1,
            variabilityIndex: 1.05,
            splitMetrics: null,
            sportSpecific: {
              bike: {
                avgPower: 210,
                normalizedPower: 220,
                maxPower: 440,
                intensityFactor: 0.8,
                variabilityIndex: 1.05,
                totalWorkKj: 760,
                avgCadence: 88,
                maxCadence: 102,
                avgHr: 142,
                maxHr: 161,
                hrZoneTimeSec: 2100,
                trainingStressScore: 64,
                aerobicTrainingEffect: 3.1,
                anaerobicTrainingEffect: 0.8,
                splitMetrics: null
              }
            }
          },
          detectedIssues: [],
          missingEvidence: [],
          rulesSummary: {
            intentMatch: "on_target",
            executionScore: 88,
            executionScoreBand: "On target",
            confidence: "high",
            provisional: false,
            evidenceCount: 5,
            executionCost: "low"
          }
        },
        verdict: {
          sessionVerdict: {
            headline: "Intent landed",
            summary: "Tempo ride stayed controlled and delivered the intended aerobic load.",
            intentMatch: "on_target",
            executionCost: "low",
            confidence: "high",
            nextCall: "move_on"
          },
          explanation: {
            whatHappened: "Power stayed steady and controlled through the main work.",
            whyItMatters: "Controlled aerobic load supports the rest of the week.",
            whatToDoNextTime: "Repeat the same pacing setup.",
            whatToDoThisWeek: "Move through the rest of the week as planned."
          },
          uncertainty: {
            label: "confident_read",
            detail: "Enough evidence is present for a confident read.",
            missingEvidence: []
          },
          citedEvidence: []
        },
        narrativeSource: "ai",
        weeklyImpact: null,
        createdAt: "2026-03-12T10:00:00.000Z",
        updatedAt: "2026-03-12T10:00:00.000Z",
        status: "matched_intent",
        intentMatchStatus: "matched_intent",
        executionScore: 88,
        executionScoreBand: "On target",
        executionScoreSummary: "Tempo ride stayed controlled and delivered the intended aerobic load.",
        executionSummary: "Power stayed steady and controlled through the main work.",
        summary: "Tempo ride stayed controlled and delivered the intended aerobic load.",
        whyItMatters: "Controlled aerobic load supports the rest of the week.",
        recommendedNextAction: "Repeat the same pacing setup.",
        diagnosisConfidence: "high",
        executionScoreProvisional: false,
        suggestedWeekAdjustment: "Move through the rest of the week as planned.",
        evidence: [],
        durationCompletion: 1,
        intervalCompletionPct: 1,
        timeAboveTargetPct: 0.08,
        avgHr: 142,
        avgPower: 210,
        normalizedPower: 220,
        trainingStressScore: 64,
        intensityFactor: 0.8,
        totalWorkKj: 760,
        avgCadence: 88,
        maxHr: 161,
        maxPower: 440,
        firstHalfAvgHr: null,
        lastHalfAvgHr: null,
        firstHalfPaceSPerKm: null,
        lastHalfPaceSPerKm: null,
        executionCost: "low",
        missingEvidence: []
      }
    });

    const legacyVm = createReviewViewModel({
      id: "legacy-1",
      date: "2026-03-12",
      sport: "run",
      type: "Run",
      intent_category: "Easy run",
      duration_minutes: 45,
      status: "completed",
      execution_result: {
        status: "matched_intent",
        executionScore: 90
      }
    });

    expect(aiVm.narrativeSource).toBe("ai");
    expect(aiVm.actualExecutionSummary).toBe("Power stayed steady and controlled through the main work.");
    expect(aiVm.mainGapLabel).toBe("Key confirmation");
    expect(aiVm.mainGap).toMatch(/Session matched intent well|Keep the same execution approach/i);
    expect(legacyVm.narrativeSource).toBe("legacy_unknown");
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

    expect(vm.reviewModeLabel).toBe("Post-execution review");
    expect(vm.sessionStatusLabel).toBe("Completed");
    expect(vm.intent.label).toBe("Supportive load");
    expect(vm.intent.detail).toMatch(/useful training load|without obvious disruption/i);
    expect(vm.plannedIntent).toBe("No planned target. Treat this as completed load added on top of the week.");
    expect(vm.mainGap).toMatch(/no planned target/i);
    expect(vm.unlockTitle).toBe("Weekly context");
    expect(vm.followUpIntro).toMatch(/extra session/i);
    expect(vm.followUpPrompts[0]).toMatch(/help or hurt the week/i);
  });

  test("does not emit a 'capped' confidence note when intent match was not actually capped", () => {
    // Partial/missed sessions can record a missingDominantMetric without the
    // intent-match score being capped. The confidence note must key on the
    // capped flag, not the raw missingDominantMetric.
    const vm = createReviewViewModel({
      id: "uncapped-partial-1",
      date: "2026-03-14",
      sport: "run",
      type: "Run",
      intent_category: "Threshold intervals",
      duration_minutes: 55,
      status: "completed",
      execution_result: {
        status: "partial_intent",
        executionScore: 62,
        executionScoreBand: "Partial match",
        executionScoreSummary: "Threshold reps drifted late and a few fell short.",
        componentScores: {
          intentMatch: { score: 55, weight: 0.4, detail: "Partial.", capped: false },
          pacingExecution: { score: 60, weight: 0.25, detail: "Drifted." },
          completion: { score: 70, weight: 0.2, detail: "Most reps complete." },
          recoveryCompliance: { score: 80, weight: 0.15, detail: "Fine." },
          composite: 62,
          dataCompletenessPct: 0.7,
          missingCriticalData: [],
          missingDominantMetric: "HR"
        }
      }
    });

    // When intentMatch.capped is false, the "capped" confidence copy must not appear,
    // even if a missingDominantMetric is recorded. A null note is acceptable here.
    if (vm.scoreConfidenceNote !== null) {
      expect(vm.scoreConfidenceNote).not.toMatch(/capped/i);
      expect(vm.scoreConfidenceNote).not.toMatch(/likely on target/i);
    }
  });
});

describe("sanitizeFieldNames", () => {
  test("maps >= to 'at least'", () => {
    expect(sanitizeFieldNames("intervalCompletionPct >= 0.9")).toBe(
      "at least 90% of planned intervals completed"
    );
  });

  test("maps > to 'more than'", () => {
    expect(sanitizeFieldNames("intervalCompletionPct > 0.9")).toBe(
      "more than 90% of planned intervals completed"
    );
  });

  test("maps < to 'less than'", () => {
    expect(sanitizeFieldNames("intervalCompletionPct < 0.9")).toBe(
      "less than 90% of planned intervals completed"
    );
  });

  test("maps <= to 'at most'", () => {
    expect(sanitizeFieldNames("intervalCompletionPct <= 0.9")).toBe(
      "at most 90% of planned intervals completed"
    );
  });

  test("maps ≥ to 'at least'", () => {
    expect(sanitizeFieldNames("intervalCompletion ≥ 0.66")).toBe(
      "at least 66% of planned intervals completed"
    );
  });

  test("maps ≤ to 'at most'", () => {
    expect(sanitizeFieldNames("intervalCompletion ≤ 0.5")).toBe(
      "at most 50% of planned intervals completed"
    );
  });

  test("maps >= 1.0 to 'all planned intervals completed'", () => {
    expect(sanitizeFieldNames("intervalCompletionPct >= 1.0")).toBe(
      "all planned intervals completed"
    );
  });

  test("maps = with value (no comparator)", () => {
    expect(sanitizeFieldNames("intervalCompletionPct = 0.8")).toBe(
      "80% of planned intervals completed"
    );
  });
});
