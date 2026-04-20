import { render, screen, fireEvent } from "@testing-library/react";
import { ExtrasVerdictCard } from "./extras-verdict-card";
import type { CoachVerdict } from "@/lib/execution-review-types";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

function makeVerdict(overrides: Partial<CoachVerdict> = {}): CoachVerdict {
  return {
    sessionVerdict: {
      headline: "Controlled easy effort",
      summary: "A 35-minute easy run at comfortable intensity. Heart rate stayed low and pacing was steady throughout.",
      intentMatch: "on_target",
      executionCost: "low",
      confidence: "high",
      nextCall: "move_on",
      ...overrides.sessionVerdict,
    },
    explanation: {
      sessionIntent: "Easy endurance to maintain aerobic base without adding meaningful fatigue.",
      whatHappened: "Ran 6.2 km in 35 minutes. Average HR 142 bpm stayed well within easy aerobic range.",
      whyItMatters: "This adds volume to the week without creating recovery debt.",
      whatToDoNextTime: "Keep extra runs at this intensity and duration.",
      whatToDoThisWeek: "No adjustment needed — this sits well alongside the planned sessions.",
      ...overrides.explanation,
    },
    nonObviousInsight: overrides.nonObviousInsight ?? "No comparative history available yet for this intent category.",
    teach: overrides.teach ?? null,
    uncertainty: {
      label: "confident_read",
      detail: "Enough data to assess this session confidently.",
      missingEvidence: [],
      ...overrides.uncertainty,
    },
    citedEvidence: overrides.citedEvidence ?? [
      {
        claim: "Heart rate stayed in easy zone throughout.",
        support: ["Avg HR 142 bpm", "Max HR 156 bpm"],
      },
    ],
  };
}

describe("ExtrasVerdictCard", () => {
  test("renders all three sections for an on-target verdict", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    // Header
    expect(screen.getByText("Extra session verdict")).toBeInTheDocument();
    expect(screen.getByText("AI review")).toBeInTheDocument();

    // Part 1: Intent
    expect(screen.getByText("Easy Endurance")).toBeInTheDocument();

    // Part 2: Status
    expect(screen.getByText("Supportive load")).toBeInTheDocument();
    expect(screen.getByText("Controlled easy effort")).toBeInTheDocument();

    // Part 3: Plan impact
    expect(screen.getByText("What this means for your plan")).toBeInTheDocument();
  });

  test("shows 'Directional' badge for fallback narrative source", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="fallback"
      />
    );

    expect(screen.getByText("Directional")).toBeInTheDocument();
    expect(screen.queryByText("AI review")).not.toBeInTheDocument();
  });

  test("renders 'Mixed signals' for partial intent match", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict({
          sessionVerdict: {
            headline: "Effort drifted higher than easy",
            summary: "Heart rate crept above easy range in the second half.",
            intentMatch: "partial",
            executionCost: "moderate",
            confidence: "medium",
            nextCall: "proceed_with_caution",
          },
        })}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(screen.getByText("Mixed signals")).toBeInTheDocument();
    expect(screen.getByText("Proceed with caution")).toBeInTheDocument();
  });

  test("renders 'Risky load' for missed intent match", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict({
          sessionVerdict: {
            headline: "Too hard for an easy day",
            summary: "Significant time in zone 4+ turned this into a quality session.",
            intentMatch: "missed",
            executionCost: "high",
            confidence: "high",
            nextCall: "protect_recovery",
          },
        })}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(screen.getByText("Risky load")).toBeInTheDocument();
    expect(screen.getByText("Protect recovery")).toBeInTheDocument();
  });

  test("hides next-call chip when verdict is move_on", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(screen.queryByText("No adjustment needed")).not.toBeInTheDocument();
  });

  test("toggles evidence section on click", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    // Evidence hidden by default
    expect(screen.queryByText("Avg HR 142 bpm")).not.toBeInTheDocument();

    // Click to show
    fireEvent.click(screen.getByText("Show evidence"));
    expect(screen.getByText("Avg HR 142 bpm")).toBeInTheDocument();

    // Click to hide
    fireEvent.click(screen.getByText("Hide evidence"));
    expect(screen.queryByText("Avg HR 142 bpm")).not.toBeInTheDocument();
  });

  test("hides evidence button when no cited evidence", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict({ citedEvidence: [] })}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(screen.queryByText("Show evidence")).not.toBeInTheDocument();
  });

  test("falls back to 'Extra workout' when intentCategory is null", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory={null}
        narrativeSource="ai"
      />
    );

    expect(screen.getByText("Extra workout")).toBeInTheDocument();
  });

  test("renders sessionIntent when present", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(
      screen.getByText("Easy endurance to maintain aerobic base without adding meaningful fatigue.")
    ).toBeInTheDocument();
  });

  test("omits sessionIntent section when null", () => {
    const verdict = makeVerdict();
    verdict.explanation.sessionIntent = null;
    render(
      <ExtrasVerdictCard
        verdict={verdict}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(
      screen.queryByText(/maintain aerobic base/)
    ).not.toBeInTheDocument();
  });

  test("renders reclassify button when sessionId and sport are provided", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="ai"
        sessionId="activity-abc123"
        sport="run"
      />
    );

    expect(screen.getByText("Reclassify")).toBeInTheDocument();
  });

  test("does not render reclassify button when sessionId is missing", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(screen.queryByText("Reclassify")).not.toBeInTheDocument();
  });

  test("shows reclassify dropdown with sport-filtered options on click", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="ai"
        sessionId="activity-abc123"
        sport="run"
      />
    );

    fireEvent.click(screen.getByText("Reclassify"));

    // Run+bike options should be visible for a run sport
    expect(screen.getByText("Recovery")).toBeInTheDocument();
    expect(screen.getByText("Easy endurance")).toBeInTheDocument();
    expect(screen.getByText("Threshold / intervals")).toBeInTheDocument();

    // Run-specific option should be visible
    expect(screen.getByText("Long endurance run")).toBeInTheDocument();

    // Bike/swim/strength-specific options should NOT be visible
    expect(screen.queryByText("Long endurance ride")).not.toBeInTheDocument();
    expect(screen.queryByText("Swim session")).not.toBeInTheDocument();
    expect(screen.queryByText("Strength session")).not.toBeInTheDocument();
  });

  test("renders Coach insight with nonObviousInsight", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict({
          nonObviousInsight: "HR drift 7% vs. your last three threshold sessions points at durability."
        })}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(screen.getByText("Coach insight")).toBeInTheDocument();
    expect(
      screen.getByText("HR drift 7% vs. your last three threshold sessions points at durability.")
    ).toBeInTheDocument();
  });

  test("renders 'Why this matters' block when teach is present", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict({
          teach: "HR climbing while pace drops inside a set flags aerobic inefficiency."
        })}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(screen.getByText("Why this matters")).toBeInTheDocument();
    expect(
      screen.getByText("HR climbing while pace drops inside a set flags aerobic inefficiency.")
    ).toBeInTheDocument();
  });

  test("hides 'Why this matters' block when teach is null", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict({ teach: null })}
        intentCategory="easy endurance"
        narrativeSource="ai"
      />
    );

    expect(screen.queryByText("Why this matters")).not.toBeInTheDocument();
  });

  test("marks current intent as disabled in dropdown", () => {
    render(
      <ExtrasVerdictCard
        verdict={makeVerdict()}
        intentCategory="easy endurance"
        narrativeSource="ai"
        sessionId="activity-abc123"
        sport="run"
      />
    );

    fireEvent.click(screen.getByText("Reclassify"));

    // The "Easy endurance" option should show "(current)" and be disabled
    expect(screen.getByText("(current)")).toBeInTheDocument();
    const easyEnduranceButton = screen.getByText("Easy endurance").closest("button");
    expect(easyEnduranceButton).toBeDisabled();
  });
});
