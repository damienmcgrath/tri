import { render, screen } from "@testing-library/react";
import { TransitionsAnalysisCard, type TransitionsAnalysisPayload } from "./transitions-analysis-card";

function makeAnalysis(overrides: Partial<TransitionsAnalysisPayload> = {}): TransitionsAnalysisPayload {
  return {
    t1: {
      athleteSec: 130,
      populationMedianSec: 150,
      hrAtEnd: 152,
      summary: "T1 2:10 vs typical 2:30 (−0:20), end HR 152 bpm."
    },
    t2: {
      athleteSec: 99,
      populationMedianSec: 90,
      hrAtEnd: 165,
      summary: "T2 1:39 vs typical 1:30 (+0:09), end HR 165 bpm."
    },
    ...overrides
  };
}

describe("TransitionsAnalysisCard", () => {
  it("renders both T1 and T2 summaries", () => {
    render(<TransitionsAnalysisCard analysis={makeAnalysis()} />);
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    expect(screen.getByText(/T1 2:10 vs typical 2:30/)).toBeInTheDocument();
    expect(screen.getByText(/T2 1:39 vs typical 1:30/)).toBeInTheDocument();
  });

  it("returns null when neither transition is present", () => {
    const { container } = render(<TransitionsAnalysisCard analysis={{ t1: null, t2: null }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders without typical median when null", () => {
    render(
      <TransitionsAnalysisCard
        analysis={{
          t1: {
            athleteSec: 130,
            populationMedianSec: null,
            hrAtEnd: 152,
            summary: "T1 2:10, end HR 152 bpm."
          },
          t2: null
        }}
      />
    );
    expect(screen.queryByText(/Typical:/)).not.toBeInTheDocument();
    expect(screen.getByText(/End HR: 152 bpm/)).toBeInTheDocument();
  });
});
