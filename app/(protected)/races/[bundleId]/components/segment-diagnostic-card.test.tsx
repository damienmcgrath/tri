import { render, screen } from "@testing-library/react";
import { SegmentDiagnosticCard, type SegmentDiagnosticPayload } from "./segment-diagnostic-card";

function makeDiag(overrides: Partial<SegmentDiagnosticPayload> = {}): SegmentDiagnosticPayload {
  return {
    discipline: "bike",
    referenceFrames: {
      vsPlan: { label: "on_plan", deltaPct: 0.4, summary: "Bike split 1:14:28 vs plan 1:14:00 (+0.4%)." },
      vsThreshold: {
        thresholdValue: 250,
        thresholdUnit: "watts",
        intensityFactor: 0.88,
        summary: "220W avg vs FTP 250W = IF 0.88 — in the appropriate range for this distance."
      },
      vsBestComparableTraining: {
        sessionId: "best-bike",
        sessionDate: "2026-04-12",
        sessionName: "Race-pace 40km",
        comparison: "Closest training analogue: Race-pace 40km (2026-04-12, 1:15:00). Race leg 1:14:28."
      },
      vsPriorRace: {
        bundleId: "prior-rb",
        raceName: "Spring Olympic 2025",
        raceDate: "2025-09-15",
        comparison: "1:14:28 faster than Spring Olympic 2025 (1:18:00, -4.5%)."
      }
    },
    pacingAnalysis: {
      splitType: "even",
      driftObservation: null,
      decouplingObservation: null
    },
    anomalies: [],
    aiNarrative: "Bike held the line: 220W avg at IF 0.88 sits squarely in olympic-distance race-effort range, and the leg matched a recent race-pace 40km within seconds.",
    ...overrides
  };
}

describe("SegmentDiagnosticCard", () => {
  it("renders the AI narrative paragraph", () => {
    render(<SegmentDiagnosticCard diagnostic={makeDiag()} />);
    expect(screen.getByText(/Bike held the line/)).toBeInTheDocument();
  });

  it("renders the discipline header", () => {
    render(<SegmentDiagnosticCard diagnostic={makeDiag()} />);
    expect(screen.getByText(/Bike diagnostic/i)).toBeInTheDocument();
  });

  it("renders all four reference frame headers", () => {
    render(<SegmentDiagnosticCard diagnostic={makeDiag()} />);
    expect(screen.getByText("vs Plan")).toBeInTheDocument();
    expect(screen.getByText("vs Threshold")).toBeInTheDocument();
    expect(screen.getByText("vs Best Comparable Training")).toBeInTheDocument();
    expect(screen.getByText("vs Prior Race")).toBeInTheDocument();
    expect(screen.getAllByText(/IF 0\.88/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Spring Olympic 2025/).length).toBeGreaterThan(0);
  });

  it("renders 'no data' state for missing reference frames", () => {
    const diag = makeDiag({
      referenceFrames: {
        vsPlan: null,
        vsThreshold: null,
        vsBestComparableTraining: null,
        vsPriorRace: null
      }
    });
    render(<SegmentDiagnosticCard diagnostic={diag} />);
    expect(screen.getByText(/No plan target/i)).toBeInTheDocument();
    expect(screen.getByText(/FTP not set/i)).toBeInTheDocument();
    expect(screen.getByText(/No comparable training/i)).toBeInTheDocument();
    expect(screen.getByText(/No prior race/i)).toBeInTheDocument();
  });

  it("hides anomalies section when empty", () => {
    render(<SegmentDiagnosticCard diagnostic={makeDiag()} />);
    expect(screen.queryByText(/Anomalies/)).not.toBeInTheDocument();
  });

  it("shows anomaly items when present", () => {
    render(
      <SegmentDiagnosticCard
        diagnostic={makeDiag({
          anomalies: [
            { type: "power_dropout", atSec: 1800, observation: "Power dropped to 12W for 30s around 30:00 — possible coast or mechanical." }
          ]
        })}
      />
    );
    expect(screen.getByText(/Anomalies/)).toBeInTheDocument();
    expect(screen.getByText(/Power dropout/)).toBeInTheDocument();
    expect(screen.getByText(/possible coast or mechanical/)).toBeInTheDocument();
  });

  it("shows drift / decoupling lines when fired", () => {
    render(
      <SegmentDiagnosticCard
        diagnostic={makeDiag({
          pacingAnalysis: {
            splitType: "positive",
            driftObservation: "Second half eased 6.2% (220W → 207W).",
            decouplingObservation: "HR rose +9.0% at steady output — cardiovascular decoupling."
          }
        })}
      />
    );
    expect(screen.getByText(/Pacing analysis/)).toBeInTheDocument();
    expect(screen.getByText(/Second half eased 6.2%/)).toBeInTheDocument();
    expect(screen.getByText(/cardiovascular decoupling/)).toBeInTheDocument();
  });
});
