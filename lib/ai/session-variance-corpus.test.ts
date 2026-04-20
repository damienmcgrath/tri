import {
  extractExecutionReviewPriorHeadlines,
  extractSessionVerdictPriorHeadlines,
} from "./session-variance-corpus";

describe("extractSessionVerdictPriorHeadlines", () => {
  test("maps columns + raw_ai_response (including teach) into the corpus", () => {
    const rows = [
      {
        session_id: "session-a",
        purpose_statement: "Threshold intervals designed to push lactate clearance.",
        execution_summary: "Hit 4 of 6 reps on target, late fade on 5 and 6.",
        raw_ai_response: {
          sessionVerdict: { headline: "Intent partially landed" },
          non_obvious_insight: "HR drifted 7% vs. the last three threshold sessions.",
          teach: "HR climbing while pace drops inside a set flags aerobic inefficiency.",
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

    const corpus = extractSessionVerdictPriorHeadlines(rows);

    expect(corpus).toHaveLength(2);
    expect(corpus[0]).toEqual({
      sessionId: "session-a",
      sessionDate: "2026-04-14",
      coachHeadline: "Intent partially landed",
      purposeHeadline: "Threshold intervals designed to push lactate clearance.",
      executionSummary: "Hit 4 of 6 reps on target, late fade on 5 and 6.",
      nonObviousInsight: "HR drifted 7% vs. the last three threshold sessions.",
      teach: "HR climbing while pace drops inside a set flags aerobic inefficiency.",
    });
    expect(corpus[1].nonObviousInsight).toBe(
      "Pace-at-HR improved 4s/km vs. your 8-week rolling average."
    );
    expect(corpus[1].teach).toBeNull();
  });

  test("tolerates legacy rows without raw_ai_response", () => {
    const [entry] = extractSessionVerdictPriorHeadlines([
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
    expect(entry.teach).toBeNull();
    expect(entry.purposeHeadline).toBe("Easy recovery spin.");
    expect(entry.executionSummary).toBe("Kept power in Z1.");
  });

  test("accepts joined sessions rendered as an array (PostgREST shape)", () => {
    const [entry] = extractSessionVerdictPriorHeadlines([
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
    const corpus = extractSessionVerdictPriorHeadlines([
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
    const corpus = extractSessionVerdictPriorHeadlines([
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
        teach: null,
      },
    ]);
  });
});

describe("extractExecutionReviewPriorHeadlines", () => {
  test("maps verdict blob (sessions or extras) into the corpus", () => {
    const rows = [
      {
        id: "session-1",
        date: "2026-04-15",
        execution_result: {
          verdict: {
            sessionVerdict: {
              headline: "Threshold intervals partially landed",
              summary: "Four of six reps held target band before a late fade on 5 and 6.",
            },
            explanation: {
              sessionIntent: "Threshold intervals to push lactate clearance.",
              whatHappened: "Held band through rep 4, then slowed 10s/km on reps 5-6.",
              whyItMatters: "Stimulus partially landed.",
            },
            nonObviousInsight: "HR drift 7% vs. last three threshold sessions.",
            teach: "Pace drop with HR climb inside a set flags durability, not top-end.",
          },
        },
      },
      {
        id: "extra-2",
        date: "2026-04-13",
        execution_result: {
          verdict: {
            sessionVerdict: {
              headline: "Extra Z2 ride absorbed cleanly",
              summary: "Easy spin stayed in Z2 without drift.",
            },
            nonObviousInsight: "Added volume sits well alongside the planned key work.",
            teach: null,
          },
        },
      },
    ];

    const corpus = extractExecutionReviewPriorHeadlines(rows);

    expect(corpus).toHaveLength(2);
    expect(corpus[0]).toEqual({
      sessionId: "session-1",
      sessionDate: "2026-04-15",
      coachHeadline: "Threshold intervals partially landed",
      purposeHeadline: "Threshold intervals to push lactate clearance.",
      executionSummary: "Held band through rep 4, then slowed 10s/km on reps 5-6.",
      nonObviousInsight: "HR drift 7% vs. last three threshold sessions.",
      teach: "Pace drop with HR climb inside a set flags durability, not top-end.",
    });
    expect(corpus[1].teach).toBeNull();
    expect(corpus[1].executionSummary).toBe("Easy spin stayed in Z2 without drift.");
  });

  test("falls back from whatHappened to sessionVerdict.summary when explanation is missing", () => {
    const [entry] = extractExecutionReviewPriorHeadlines([
      {
        id: "legacy",
        date: "2026-03-28",
        execution_result: {
          verdict: {
            sessionVerdict: {
              headline: "Legacy verdict",
              summary: "Summary-only verdict without full explanation block.",
            },
            nonObviousInsight: "Short comparison history only.",
          },
        },
      },
    ]);

    expect(entry.executionSummary).toBe("Summary-only verdict without full explanation block.");
    expect(entry.teach).toBeNull();
  });

  test("drops rows with no verdict or null execution_result", () => {
    const corpus = extractExecutionReviewPriorHeadlines([
      { id: "no-blob", date: "2026-04-01", execution_result: null },
      { id: "no-verdict", date: "2026-04-02", execution_result: { verdict: null } },
      { id: "", date: "2026-04-03", execution_result: { verdict: { sessionVerdict: { headline: "x" } } } },
    ]);

    expect(corpus).toEqual([]);
  });

  test("drops verdicts that produce no reusable phrasings", () => {
    const corpus = extractExecutionReviewPriorHeadlines([
      {
        id: "empty",
        date: "2026-04-04",
        execution_result: {
          verdict: {
            sessionVerdict: {},
            explanation: {},
          },
        },
      },
    ]);

    expect(corpus).toEqual([]);
  });
});
