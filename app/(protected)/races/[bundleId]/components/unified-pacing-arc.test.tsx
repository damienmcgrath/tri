import { render } from "@testing-library/react";
import { UnifiedPacingArc } from "./unified-pacing-arc";
import type { PacingArcData } from "@/lib/race-review/pacing-arc";

function makeData(overrides: Partial<PacingArcData> = {}): PacingArcData {
  return {
    totalDurationSec: 9000,
    points: [
      { tSec: 800, role: "swim", hr: 142, power: null, paceSec: 105 },
      { tSec: 3000, role: "bike", hr: 152, power: 220, paceSec: null },
      { tSec: 5500, role: "bike", hr: 154, power: 218, paceSec: null },
      { tSec: 7800, role: "run", hr: 162, power: null, paceSec: 282 },
      { tSec: 8800, role: "run", hr: 168, power: null, paceSec: 295 }
    ],
    transitions: [
      { role: "t1", startSec: 1600, endSec: 1730, inferred: false },
      { role: "t2", startSec: 7600, endSec: 7700, inferred: false }
    ],
    legBoundaries: [
      { role: "swim", startSec: 0, endSec: 1600 },
      { role: "bike", startSec: 1730, endSec: 7600 },
      { role: "run", startSec: 7700, endSec: 9000 }
    ],
    inferredGaps: false,
    thresholdHrBpm: null,
    ...overrides
  };
}

describe("UnifiedPacingArc", () => {
  it("renders an SVG containing leg boundaries and points (Garmin Multisport — continuous)", () => {
    const { container } = render(<UnifiedPacingArc data={makeData()} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // HR path drawn — has points data so a path element should exist.
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThan(0);
  });

  it("annotates stitched bundles with an inferred-gaps caption", () => {
    const { getByText } = render(
      <UnifiedPacingArc
        data={makeData({
          inferredGaps: true,
          transitions: [
            { role: "t1", startSec: 1600, endSec: 1620, inferred: true },
            { role: "t2", startSec: 7700, endSec: 7720, inferred: true }
          ]
        })}
      />
    );
    expect(getByText(/Stitched bundle/i)).toBeInTheDocument();
  });

  it("renders the FTHR reference line when threshold is provided", () => {
    const { getByText, container } = render(
      <UnifiedPacingArc data={makeData({ thresholdHrBpm: 168 })} />
    );
    expect(getByText(/FTHR 168/)).toBeInTheDocument();
    // Dashed reference line as <line stroke-dasharray="4 4">
    const dashedLines = container.querySelectorAll('line[stroke-dasharray="4 4"]');
    expect(dashedLines.length).toBeGreaterThan(0);
  });

  it("hides the FTHR legend entry when threshold is null", () => {
    const { queryByText } = render(<UnifiedPacingArc data={makeData({ thresholdHrBpm: null })} />);
    expect(queryByText(/FTHR/)).toBeNull();
  });
});
