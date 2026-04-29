import { render, screen } from "@testing-library/react";
import { RaceStoryCard, type RaceStoryPayload } from "./race-story-card";

function makeStory(overrides: Partial<RaceStoryPayload> = {}): RaceStoryPayload {
  return {
    overall: "Race came together — swim controlled, bike steady, run held shape.",
    perLeg: {
      swim: { narrative: "Swim came in at 26:41 even-split.", keyEvidence: ["1:45 /100m avg"] },
      bike: {
        narrative: "Bike held 220→218W with no fade.",
        keyEvidence: ["Halves moved -0.9%", "HR 152 avg"]
      },
      run: { narrative: "Run held within 4% across halves.", keyEvidence: ["Pace 4:42 → 4:55 /km"] }
    },
    transitions: "T1 2:10, T2 1:39 — both efficient.",
    crossDisciplineInsight: null,
    ...overrides
  };
}

describe("RaceStoryCard", () => {
  it("renders the overall narrative", () => {
    render(<RaceStoryCard story={makeStory()} />);
    expect(screen.getByText(/Race came together/)).toBeInTheDocument();
  });

  it("does not render the cross-discipline block when null", () => {
    render(<RaceStoryCard story={makeStory({ crossDisciplineInsight: null })} />);
    expect(screen.queryByText(/Cross-discipline insight/i)).not.toBeInTheDocument();
  });

  it("renders the cross-discipline insight as an emphasized block when set", () => {
    render(
      <RaceStoryCard
        story={makeStory({
          crossDisciplineInsight: "Bike fade carried into the run as cardiac drift at constant pace."
        })}
      />
    );
    expect(screen.getByText(/Cross-discipline insight/i)).toBeInTheDocument();
    expect(screen.getByText(/Bike fade carried/)).toBeInTheDocument();
  });

  it("renders transitions row when present", () => {
    render(<RaceStoryCard story={makeStory()} />);
    expect(screen.getByText(/T1 2:10, T2 1:39/)).toBeInTheDocument();
  });
});
