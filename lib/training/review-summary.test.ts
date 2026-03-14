import { normalizeReviewSummary } from "./review-summary";

describe("normalizeReviewSummary", () => {
  it("derives a partial-match review from legacy execution fields and builds intent-vs-actual metrics", () => {
    const summary = normalizeReviewSummary({
      sport: "bike",
      type: "Tempo bike",
      intentCategory: "Threshold intervals",
      target: "Tempo power",
      durationMinutes: 60,
      storedStatus: "completed",
      executionResult: {
        status: "partial_intent",
        actualDurationSec: 3060,
        durationCompletion: 0.85,
        intervalCompletionPct: 0.75,
        timeAboveTargetPct: 0.18,
        firstHalfAvgHr: 145,
        lastHalfAvgHr: 153
      }
    });

    expect(summary.outcome).toBe("partial_match");
    expect(summary.outcomeLabel).toBe("Partial match");
    expect(summary.didStimulusLand).toBe("partially");
    expect(summary.evidenceQuality).toBe("high");
    expect(summary.confidenceExplanation).toMatch(/duration, structure, and execution detail/i);
    expect(summary.metrics.map((metric) => metric.label)).toEqual([
      "Duration",
      "Structure",
      "Target control",
      "Late HR drift"
    ]);
    expect(summary.metrics[0]).toMatchObject({
      planned: "1h 0m",
      actual: "51m",
      tone: "warning"
    });
  });

  it("uses explicit review-summary fields and explains low-confidence evidence gaps clearly", () => {
    const summary = normalizeReviewSummary({
      sport: "run",
      type: "Tempo run",
      durationMinutes: 50,
      storedStatus: "completed",
      executionResult: {
        review_summary: {
          headline: "Missed intent",
          summary: "The run ended before the final quality block.",
          outcome: "missed_intent",
          confidence: "low",
          evidenceQuality: "low",
          primaryGap: "The final work block is missing.",
          keyIssues: ["Shortened duration"],
          intendedStimulus: "Sustained tempo control under fatigue",
          actualExecution: "The run stopped before the final intended block.",
          didStimulusLand: "no",
          recommendation: "Protect recovery and move on.",
          weekRecommendation: "Keep the rest of the week unchanged.",
          effectOnWeek: "moderate",
          stimulusImpact: "medium",
          missingEvidenceReasons: ["summary_only_upload", "no_split_data"],
          metrics: []
        }
      }
    });

    expect(summary.outcome).toBe("missed_intent");
    expect(summary.confidence).toBe("low");
    expect(summary.evidenceQuality).toBe("low");
    expect(summary.primaryGap).toBe("The final work block is missing.");
    expect(summary.missingEvidenceLabels).toEqual(["Summary-only upload", "No split data"]);
    expect(summary.confidenceExplanation).toBe("Early read, still missing some data: summary-only upload, no split data.");
    expect(summary.metrics).toMatchObject([
      {
        label: "Duration",
        planned: "50m",
        actual: "—",
        tone: "neutral"
      }
    ]);
  });

  it("treats a skipped session as missed intent even without uploaded execution evidence", () => {
    const summary = normalizeReviewSummary({
      sport: "swim",
      type: "Aerobic swim",
      durationMinutes: 45,
      storedStatus: "skipped",
      executionResult: null
    });

    expect(summary.outcome).toBe("missed_intent");
    expect(summary.headline).toBe("Missed intent");
    expect(summary.didStimulusLand).toBe("no");
    expect(summary.primaryGap).toMatch(/session was skipped/i);
    expect(summary.recommendation).toMatch(/Protect recovery/i);
  });
});
