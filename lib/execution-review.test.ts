import { coerceCoachVerdictPayloadForTest, normalizeVerdictUnitsForTest } from "./execution-review";

const defaults = {
  intentMatch: "partial" as const,
  executionCost: "moderate" as const,
  nextCall: "proceed_with_caution" as const
};

describe("coerceCoachVerdictPayloadForTest", () => {
  test("accepts the canonical nested schema", () => {
    const result = coerceCoachVerdictPayloadForTest({
      sessionVerdict: {
        headline: "Intent partially landed",
        summary: "The session partly matched the intended stimulus.",
        intentMatch: "partial",
        executionCost: "moderate",
        confidence: "medium",
        nextCall: "proceed_with_caution"
      },
      explanation: {
        whatHappened: "The final work faded late.",
        whyItMatters: "That reduced the precision of the intended session stimulus.",
        whatToDoNextTime: "Start a touch easier.",
        whatToDoThisWeek: "Keep the next key day controlled."
      },
      uncertainty: {
        label: "early_read",
        detail: "Useful read, but some split evidence is missing.",
        missingEvidence: ["split comparison"]
      },
      citedEvidence: [
        {
          claim: "Late fade showed up.",
          support: ["Second-half pace slowed", "Not all planned work was completed"]
        }
      ]
    }, defaults);

    expect(result.parsed.success).toBe(true);
  });

  test("unwraps a wrapped canonical schema", () => {
    const result = coerceCoachVerdictPayloadForTest({
      verdict: {
        sessionVerdict: {
          headline: "Intent landed",
          summary: "The session matched the intended stimulus cleanly.",
          intentMatch: "partial",
          executionCost: "moderate",
          confidence: "high",
          nextCall: "proceed_with_caution"
        },
        explanation: {
          whatHappened: "Control stayed steady throughout the work.",
          whyItMatters: "That preserved the intended training effect.",
          whatToDoNextTime: "Repeat the same pacing approach.",
          whatToDoThisWeek: "Keep the rest of the week as planned."
        },
        uncertainty: {
          label: "confident_read",
          detail: "Enough evidence is present for a strong read.",
          missingEvidence: []
        },
        citedEvidence: []
      }
    }, defaults);

    expect(result.parsed.success).toBe(true);
  });

  test("maps the flatter legacy coaching schema into the canonical shape", () => {
    const result = coerceCoachVerdictPayloadForTest({
      sessionId: "session-1",
      summary: "The session partly matched the intended stimulus.",
      whatHappened: "The last part of the workout faded late.",
      interpretation_for_session: "That reduced how precisely the intended session landed.",
      what_this_means_for_the_week: "Keep the next key session controlled.",
      practical_next_steps: {
        next_session: "Start a touch easier next time.",
        this_week: "Keep the next quality day conservative."
      },
      constraints_and_uncertainties: {
        summary: "Split detail was limited.",
        missingEvidence: ["split comparison"]
      },
      questions_for_you: {
        items: ["Did the final reps feel mechanically strained?"]
      },
      confidence: "medium"
    }, defaults);

    expect(result.parsed.success).toBe(true);
    if (result.parsed.success) {
      expect(result.parsed.data.sessionVerdict.intentMatch).toBe("partial");
      expect(result.parsed.data.sessionVerdict.executionCost).toBe("moderate");
      expect(result.parsed.data.sessionVerdict.nextCall).toBe("proceed_with_caution");
      expect(result.parsed.data.explanation.whatToDoNextTime).toMatch(/Start a touch easier/i);
    }
  });

  test("rejects invalid enum values instead of silently coercing them", () => {
    const result = coerceCoachVerdictPayloadForTest({
      sessionVerdict: {
        headline: "Intent partially landed",
        summary: "The session partly matched the intended stimulus.",
        intentMatch: "mostly",
        executionCost: "moderate",
        confidence: "medium",
        nextCall: "proceed_with_caution"
      },
      explanation: {
        whatHappened: "The final work faded late.",
        whyItMatters: "That reduced the precision of the intended session stimulus.",
        whatToDoNextTime: "Start a touch easier.",
        whatToDoThisWeek: "Keep the next key day controlled."
      },
      uncertainty: {
        label: "early_read",
        detail: "Useful read, but some split evidence is missing.",
        missingEvidence: ["split comparison"]
      },
      citedEvidence: []
    }, defaults);

    expect(result.parsed.success).toBe(false);
  });

  test("normalizes simple nextCall synonyms in otherwise valid payloads", () => {
    const result = coerceCoachVerdictPayloadForTest({
      sessionVerdict: {
        headline: "Intent partially landed",
        summary: "The session partly matched the intended stimulus.",
        intentMatch: "partial",
        executionCost: "moderate",
        confidence: "medium",
        nextCall: "proceed"
      },
      explanation: {
        whatHappened: "The final work faded late.",
        whyItMatters: "That reduced the precision of the intended session stimulus.",
        whatToDoNextTime: "Start a touch easier.",
        whatToDoThisWeek: "Keep the next key day controlled."
      },
      uncertainty: {
        label: "early_read",
        detail: "Useful read, but some split evidence is missing.",
        missingEvidence: ["split comparison"]
      },
      citedEvidence: []
    }, defaults);

    expect(result.parsed.success).toBe(true);
    if (result.parsed.success) {
      expect(result.parsed.data.sessionVerdict.nextCall).toBe("proceed_with_caution");
    }
  });
});

describe("normalizeVerdictUnitsForTest", () => {
  test("converts bare seconds to minutes", () => {
    expect(normalizeVerdictUnitsForTest("You completed 2,239 s of work.")).toBe("You completed 37 min of work.");
  });

  test("converts seconds over one hour to h + min", () => {
    expect(normalizeVerdictUnitsForTest("Duration: 4500 s")).toBe("Duration: 1 h 15 min");
  });

  test("converts s/km pace to min:sec/km", () => {
    expect(normalizeVerdictUnitsForTest("Avg pace was 341.63 s/km.")).toBe("Avg pace was 5:42/km.");
  });

  test("leaves already-formatted values untouched", () => {
    expect(normalizeVerdictUnitsForTest("Duration 37 min at 5:41/km")).toBe("Duration 37 min at 5:41/km");
  });

  test("does not corrupt s/km when converting bare seconds in the same string", () => {
    expect(normalizeVerdictUnitsForTest("2,239 s at 341 s/km")).toBe("37 min at 5:41/km");
  });

  test("converts 'sec' variant to minutes", () => {
    expect(normalizeVerdictUnitsForTest("The session duration matched plan (2700 sec / 45 min)")).toBe("The session duration matched plan (45 min / 45 min)");
  });

  test("converts 'secs' variant to minutes", () => {
    expect(normalizeVerdictUnitsForTest("You ran for 2700 secs total")).toBe("You ran for 45 min total");
  });

  test("converts 'seconds' variant to hours and minutes", () => {
    expect(normalizeVerdictUnitsForTest("Duration was 4500 seconds")).toBe("Duration was 1 h 15 min");
  });

  test("converts sec/km pace to min:sec/km", () => {
    expect(normalizeVerdictUnitsForTest("Pace was 341 sec/km")).toBe("Pace was 5:41/km");
  });

  test("handles mixed sec duration and s/km pace", () => {
    expect(normalizeVerdictUnitsForTest("2700 sec at 341 s/km")).toBe("45 min at 5:41/km");
  });
});
