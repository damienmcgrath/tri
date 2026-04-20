import { render, screen } from "@testing-library/react";
import { SessionVerdictCard } from "./session-verdict-card";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

type SessionVerdict = NonNullable<Parameters<typeof SessionVerdictCard>[0]["existingVerdict"]>;

function makeVerdict(overrides: Partial<SessionVerdict> = {}): SessionVerdict {
  return {
    purpose_statement: "Threshold intervals to push lactate clearance at race-relevant intensity.",
    training_block_context: "Week 3 of 5 — build block.",
    execution_summary: "Hit the target band on the first 4 reps, then faded: reps 5 and 6 sat 5 s/km below pace.",
    verdict_status: "partial",
    metric_comparisons: [
      { metric: "interval completion", target: "6 of 6", actual: "6 of 6", assessment: "on_target" },
    ],
    key_deviations: null,
    adaptation_signal: "Start Thursday's bike 5% easier so Saturday's long run can absorb the residual cost.",
    adaptation_type: "modify",
    stale_reason: null,
    non_obvious_insight: null,
    teach: null,
    ...overrides,
  };
}

describe("SessionVerdictCard — insight and teach rendering", () => {
  test("renders Coach insight when non_obvious_insight is present", () => {
    render(
      <SessionVerdictCard
        sessionId="sess-1"
        sessionCompleted
        discipline="run"
        existingVerdict={makeVerdict({
          non_obvious_insight:
            "HR drift of 7% between the first and last threshold reps vs. under 3% on prior threshold sessions points at durability, not top-end capacity.",
        })}
      />
    );

    expect(screen.getByText("Coach insight")).toBeInTheDocument();
    expect(screen.getByText(/HR drift of 7%/)).toBeInTheDocument();
  });

  test("renders 'Why this matters' when teach is present", () => {
    render(
      <SessionVerdictCard
        sessionId="sess-2"
        sessionCompleted
        discipline="run"
        existingVerdict={makeVerdict({
          non_obvious_insight: "Pace-at-HR improved 4 s/km vs. your 8-week rolling average.",
          teach:
            "HR drift under 2% at steady output means oxygen delivery is keeping up with demand — the aerobic engine is still building capacity.",
        })}
      />
    );

    expect(screen.getByText("Why this matters")).toBeInTheDocument();
    expect(screen.getByText(/HR drift under 2%/)).toBeInTheDocument();
  });

  test("hides the coach-insight section entirely when both fields are null", () => {
    render(
      <SessionVerdictCard
        sessionId="sess-3"
        sessionCompleted
        discipline="run"
        existingVerdict={makeVerdict()}
      />
    );

    expect(screen.queryByText("Coach insight")).not.toBeInTheDocument();
    expect(screen.queryByText("Why this matters")).not.toBeInTheDocument();
  });

  test("renders only Coach insight when teach is null but insight is present", () => {
    render(
      <SessionVerdictCard
        sessionId="sess-4"
        sessionCompleted
        discipline="run"
        existingVerdict={makeVerdict({
          non_obvious_insight: "This is the third consecutive long ride where HR drift spiked after hour two.",
          teach: null,
        })}
      />
    );

    expect(screen.getByText("Coach insight")).toBeInTheDocument();
    expect(screen.queryByText("Why this matters")).not.toBeInTheDocument();
  });
});
