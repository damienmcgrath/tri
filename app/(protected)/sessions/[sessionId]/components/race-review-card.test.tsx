import { render, screen } from "@testing-library/react";
import { RaceReviewCard, RaceReviewPlaceholder, type RaceReviewCardProps } from "./race-review-card";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() })
}));

function makeReview(overrides: Partial<RaceReviewCardProps["review"]> = {}): RaceReviewCardProps["review"] {
  return {
    headline: "Even-split race; bike held within 1.5%.",
    narrative: "Race held together — swim controlled, bike steady, run faded slightly in the final 3 km.",
    coachTake: "Repeat this pacing on the next 70.3 build ride at 220W ±2%. If HR holds, extend by 10 minutes.",
    transitionNotes: "T1 2:10, T2 1:39 — both efficient.",
    pacingNotes: {
      bike: {
        firstHalf: 220,
        lastHalf: 218,
        deltaPct: -0.9,
        unit: "watts",
        note: "Held within 1% across halves."
      }
    },
    disciplineDistributionActual: { swim: 0.18, t1: 0.01, bike: 0.51, t2: 0.01, run: 0.29 },
    disciplineDistributionDelta: { swim: 0.03, bike: -0.04, run: -0.01 },
    modelUsed: "gpt-5-mini",
    isProvisional: false,
    generatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("RaceReviewCard", () => {
  it("renders the headline and coach take prominently", () => {
    render(<RaceReviewCard bundleId="bundle-1" review={makeReview()} />);

    expect(screen.getByText(/Even-split race/)).toBeInTheDocument();
    expect(screen.getByText(/Coach take/i)).toBeInTheDocument();
    expect(screen.getByText(/Repeat this pacing/)).toBeInTheDocument();
  });

  it("does not show the Provisional pill when is_provisional is false", () => {
    render(<RaceReviewCard bundleId="bundle-1" review={makeReview({ isProvisional: false })} />);

    expect(screen.queryByText(/Provisional/i)).not.toBeInTheDocument();
  });

  it("shows the Provisional pill when is_provisional is true", () => {
    render(<RaceReviewCard bundleId="bundle-1" review={makeReview({ isProvisional: true })} />);

    expect(screen.getByText(/Provisional/i)).toBeInTheDocument();
  });

  it("renders the model used in the footer", () => {
    render(<RaceReviewCard bundleId="bundle-1" review={makeReview({ modelUsed: "gpt-5-mini" })} />);

    expect(screen.getByText(/gpt-5-mini/)).toBeInTheDocument();
  });

  it("renders a regenerate review button", () => {
    render(<RaceReviewCard bundleId="bundle-1" review={makeReview()} />);

    expect(screen.getByRole("button", { name: /Regenerate review/i })).toBeInTheDocument();
  });
});

describe("RaceReviewPlaceholder", () => {
  it("invites the athlete to add notes and exposes a regenerate fallback", () => {
    render(<RaceReviewPlaceholder bundleId="bundle-1" />);

    expect(screen.getByText(/Add your race notes/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add race notes/i })).toHaveAttribute(
      "href",
      "/races/bundle-1/notes"
    );
    expect(screen.getByRole("button", { name: /regenerate review/i })).toBeInTheDocument();
  });
});
