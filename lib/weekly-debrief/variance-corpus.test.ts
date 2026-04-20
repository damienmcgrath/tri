import { extractPriorHeadlines } from "./variance-corpus";

describe("extractPriorHeadlines", () => {
  test("maps narrative / coach_share / facts fields into the corpus", () => {
    const rows = [
      {
        week_start: "2026-04-13",
        narrative: {
          executiveSummary: "Three threshold sessions held while volume climbed.",
          nonObviousInsight: "Threshold HR dropped 4bpm at the same power across three weeks.",
          highlights: ["a", "b", "c"],
          observations: ["obs"],
          carryForward: ["one", "two"]
        },
        coach_share: {
          headline: "Threshold ceiling is holding",
          summary: "Steady-state gains under rising CTL.",
          wins: ["a"],
          concerns: ["b"],
          carryForward: ["one", "two"]
        },
        facts: {
          primaryTakeawayTitle: "The main work held"
        }
      },
      {
        week_start: "2026-04-06",
        narrative: {
          executiveSummary: "Recovery week, signals quiet.",
          nonObviousInsight: "Resting HR fell 3bpm as training load dropped."
        },
        coach_share: { headline: "Recovery landed cleanly" },
        facts: { primaryTakeawayTitle: "Consistency held" }
      }
    ];

    const corpus = extractPriorHeadlines(rows);

    expect(corpus).toHaveLength(2);
    expect(corpus[0]).toEqual({
      weekStart: "2026-04-13",
      coachHeadline: "Threshold ceiling is holding",
      executiveSummary: "Three threshold sessions held while volume climbed.",
      nonObviousInsight: "Threshold HR dropped 4bpm at the same power across three weeks.",
      takeawayTitle: "The main work held"
    });
    expect(corpus[1].coachHeadline).toBe("Recovery landed cleanly");
  });

  test("tolerates legacy rows that lack nonObviousInsight", () => {
    const [entry] = extractPriorHeadlines([
      {
        week_start: "2026-03-30",
        narrative: {
          executiveSummary: "A mostly intact week.",
          highlights: ["x", "y", "z"],
          observations: ["obs"],
          carryForward: ["one", "two"]
        },
        coach_share: { headline: "Mostly intact" },
        facts: { primaryTakeawayTitle: "The week had one clear strength and one clear wobble" }
      }
    ]);

    expect(entry.nonObviousInsight).toBeNull();
    expect(entry.executiveSummary).toBe("A mostly intact week.");
    expect(entry.takeawayTitle).toBe("The week had one clear strength and one clear wobble");
  });

  test("skips rows where nothing usable is present", () => {
    const corpus = extractPriorHeadlines([
      { week_start: "2026-03-23", narrative: null, coach_share: null, facts: null },
      { week_start: "2026-03-16", narrative: {}, coach_share: {}, facts: {} },
      { week_start: "", narrative: { executiveSummary: "ignored" } }
    ]);

    expect(corpus).toEqual([]);
  });

  test("ignores non-string values without throwing", () => {
    const corpus = extractPriorHeadlines([
      {
        week_start: "2026-03-09",
        narrative: { executiveSummary: 42, nonObviousInsight: null },
        coach_share: { headline: ["not", "a", "string"] },
        facts: { primaryTakeawayTitle: "Valid title" }
      }
    ]);

    expect(corpus).toEqual([
      {
        weekStart: "2026-03-09",
        coachHeadline: null,
        executiveSummary: null,
        nonObviousInsight: null,
        takeawayTitle: "Valid title"
      }
    ]);
  });

  test("trims whitespace-only strings to null", () => {
    const [entry] = extractPriorHeadlines([
      {
        week_start: "2026-03-02",
        narrative: { executiveSummary: "   ", nonObviousInsight: "  real insight  " },
        coach_share: { headline: "" },
        facts: { primaryTakeawayTitle: "Title" }
      }
    ]);

    expect(entry.executiveSummary).toBeNull();
    expect(entry.nonObviousInsight).toBe("real insight");
    expect(entry.coachHeadline).toBeNull();
  });
});
