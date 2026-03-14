import { render, screen } from "@testing-library/react";
import { EvidenceConfidenceNote, IntentVsActualGrid } from "./session-review-cards";

describe("session review cards", () => {
  it("shows the low-evidence fallback when interval or split detail is missing", () => {
    render(
      <>
        <IntentVsActualGrid
          intendedStimulus="Sustained tempo control under fatigue"
          didStimulusLand="partially"
          metrics={[]}
        />
        <EvidenceConfidenceNote
          confidence="low"
          explanation="Early read, still missing some data: no split data, summary-only upload."
          missingEvidence={["No split data", "Summary-only upload"]}
        />
      </>
    );

    expect(screen.getByText("More detailed evidence will appear once the upload includes structure or split data.")).toBeInTheDocument();
    expect(screen.getByText("Early read")).toBeInTheDocument();
    expect(screen.getByText(/Missing evidence: No split data, Summary-only upload\./i)).toBeInTheDocument();
  });
});
