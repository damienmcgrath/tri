import { extractSessionPriorHeadlines } from "./session-variance-corpus";

describe("extractSessionPriorHeadlines", () => {
  test("maps columns + raw_ai_response into the corpus", () => {
    const rows = [
      {
        session_id: "session-a",
        purpose_statement: "Threshold intervals designed to push lactate clearance.",
        execution_summary: "Hit 4 of 6 reps on target, late fade on 5 and 6.",
        raw_ai_response: {
          sessionVerdict: { headline: "Intent partially landed" },
          non_obvious_insight: "HR drifted 7% vs. the last three threshold sessions.",
        },
        sessions: { date: "2026-04-14" },
      },
      {
        session_id: "session-b",
        purpose_statement: "Z2 aerobic capillary development.",
        execution_summary: "Held target band through the full 60 min.",
        raw_ai_response: {
          sessionVerdict: { headline: "Steady Z2 held" },
          nonObviousInsight: "Pace-at-HR improved 4s/km vs. your 8-week rolling average.",
        },
        sessions: { date: "2026-04-12" },
      },
    ];

    const corpus = extractSessionPriorHeadlines(rows);

    expect(corpus).toHaveLength(2);
    expect(corpus[0]).toEqual({
      sessionId: "session-a",
      sessionDate: "2026-04-14",
      coachHeadline: "Intent partially landed",
      purposeHeadline: "Threshold intervals designed to push lactate clearance.",
      executionSummary: "Hit 4 of 6 reps on target, late fade on 5 and 6.",
      nonObviousInsight: "HR drifted 7% vs. the last three threshold sessions.",
    });
    expect(corpus[1].nonObviousInsight).toBe(
      "Pace-at-HR improved 4s/km vs. your 8-week rolling average."
    );
  });

  test("tolerates legacy rows without raw_ai_response", () => {
    const [entry] = extractSessionPriorHeadlines([
      {
        session_id: "legacy",
        purpose_statement: "Easy recovery spin.",
        execution_summary: "Kept power in Z1.",
        raw_ai_response: null,
        sessions: { date: "2026-03-30" },
      },
    ]);

    expect(entry.coachHeadline).toBeNull();
    expect(entry.nonObviousInsight).toBeNull();
    expect(entry.purposeHeadline).toBe("Easy recovery spin.");
    expect(entry.executionSummary).toBe("Kept power in Z1.");
  });

  test("accepts joined sessions rendered as an array (PostgREST shape)", () => {
    const [entry] = extractSessionPriorHeadlines([
      {
        session_id: "session-c",
        purpose_statement: "Progression run.",
        execution_summary: "Closed the last 15 min at marathon pace.",
        raw_ai_response: { sessionVerdict: { headline: "Closed strong" } },
        sessions: [{ date: "2026-04-10" }],
      },
    ]);

    expect(entry.sessionDate).toBe("2026-04-10");
    expect(entry.coachHeadline).toBe("Closed strong");
  });

  test("drops rows with no session date or no reusable phrasings", () => {
    const corpus = extractSessionPriorHeadlines([
      {
        session_id: "no-date",
        purpose_statement: "Valid purpose",
        execution_summary: "Valid summary",
        raw_ai_response: null,
        sessions: null,
      },
      {
        session_id: "empty",
        purpose_statement: "",
        execution_summary: "",
        raw_ai_response: null,
        sessions: { date: "2026-04-01" },
      },
    ]);

    expect(corpus).toEqual([]);
  });

  test("ignores non-string values without throwing", () => {
    const corpus = extractSessionPriorHeadlines([
      {
        session_id: "mixed",
        purpose_statement: 42 as unknown as string,
        execution_summary: "  real summary  ",
        raw_ai_response: { sessionVerdict: { headline: ["not", "a", "string"] } },
        sessions: { date: "2026-04-05" },
      },
    ]);

    expect(corpus).toEqual([
      {
        sessionId: "mixed",
        sessionDate: "2026-04-05",
        coachHeadline: null,
        purposeHeadline: null,
        executionSummary: "real summary",
        nonObviousInsight: null,
      },
    ]);
  });
});
