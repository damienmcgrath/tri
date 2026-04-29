import { render, screen } from "@testing-library/react";
import { RaceVerdictCard, type VerdictPayload } from "./race-verdict-card";

function makeVerdict(overrides: Partial<VerdictPayload> = {}): VerdictPayload {
  return {
    headline: "Finished in 2:31:30; bike held 220→218W across halves.",
    perDiscipline: {
      swim: { status: "on_plan", summary: "Swim came in steady at 1:45 /100m." },
      bike: { status: "strong", summary: "Held 220W across halves with no fade." },
      run: { status: "faded", summary: "Pace eased 4.2% in the second half." }
    },
    coachTake: {
      target: "Hold 220W ±2% across halves",
      scope: "next race-pace ride",
      successCriterion: "Halves move less than 2% between first and last",
      progression: "If steady, extend duration by 10 minutes"
    },
    emotionalFrame: null,
    ...overrides
  };
}

describe("RaceVerdictCard", () => {
  it("renders the headline with at least one number", () => {
    render(
      <RaceVerdictCard
        verdict={makeVerdict()}
        isProvisional={false}
        modelUsed="gpt-5-mini"
        generatedAt={new Date().toISOString()}
      />
    );
    expect(screen.getByText(/Finished in 2:31:30/)).toBeInTheDocument();
  });

  it("renders per-discipline status pills with correct labels", () => {
    render(
      <RaceVerdictCard
        verdict={makeVerdict()}
        isProvisional={false}
        modelUsed="gpt-5-mini"
        generatedAt={new Date().toISOString()}
      />
    );
    expect(screen.getByText("On plan")).toBeInTheDocument();
    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("Faded")).toBeInTheDocument();
  });

  it("renders Coach Take in NEXT format with target, scope, criterion, progression", () => {
    render(
      <RaceVerdictCard
        verdict={makeVerdict()}
        isProvisional={false}
        modelUsed="gpt-5-mini"
        generatedAt={new Date().toISOString()}
      />
    );
    expect(screen.getByText(/NEXT — Hold 220W/)).toBeInTheDocument();
    expect(screen.getByText(/next race-pace ride/)).toBeInTheDocument();
    expect(screen.getByText(/Halves move less than 2%/)).toBeInTheDocument();
    expect(screen.getByText(/extend duration by 10 minutes/)).toBeInTheDocument();
  });

  it("does not render emotional frame when null", () => {
    render(
      <RaceVerdictCard
        verdict={makeVerdict({ emotionalFrame: null })}
        isProvisional={false}
        modelUsed="gpt-5-mini"
        generatedAt={null}
      />
    );
    expect(screen.queryByText(/tough day/i)).not.toBeInTheDocument();
  });

  it("renders the emotional frame banner when set", () => {
    render(
      <RaceVerdictCard
        verdict={makeVerdict({ emotionalFrame: "Conditions made this a tough day." })}
        isProvisional={false}
        modelUsed="gpt-5-mini"
        generatedAt={null}
      />
    );
    expect(screen.getByText(/tough day/i)).toBeInTheDocument();
  });

  it("shows the Provisional pill when isProvisional", () => {
    render(
      <RaceVerdictCard
        verdict={makeVerdict()}
        isProvisional={true}
        modelUsed="fallback"
        generatedAt={null}
      />
    );
    expect(screen.getByText(/Provisional/i)).toBeInTheDocument();
  });

  it("renders the noteIndicator when set", () => {
    render(
      <RaceVerdictCard
        verdict={makeVerdict()}
        isProvisional={false}
        modelUsed="gpt-5-mini"
        generatedAt={null}
        noteIndicator
      />
    );
    expect(screen.getByText(/Updated based on your notes/i)).toBeInTheDocument();
  });
});
