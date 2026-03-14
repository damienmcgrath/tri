import { fireEvent, render, screen } from "@testing-library/react";
import { CoachIssueWorkspace } from "./coach-issue-workspace";

describe("CoachIssueWorkspace", () => {
  it("switches the detail panel when a different flagged issue is selected", () => {
    render(
      <CoachIssueWorkspace
        defaultPromptPrefix="This week: "
        issues={[
          {
            id: "issue:1",
            sessionId: "s1",
            sessionTitle: "Wed power bike",
            issueType: "Interval target missed",
            reviewOutcome: "partial_match",
            whyItMatters: "The key bike stimulus only partially landed.",
            recommendation: "Keep the next key bike session, but start a touch easier.",
            summary: "Power faded in the final interval."
          },
          {
            id: "issue:2",
            sessionId: "s2",
            sessionTitle: "Thu easy run",
            issueType: "Session skipped",
            reviewOutcome: "missed_intent",
            whyItMatters: "Skipping this run changes how much load is still sitting in the weekend.",
            recommendation: "Drop it and keep the long bike unchanged.",
            summary: "The run was skipped before the weekend block."
          }
        ]}
      />
    );

    expect(screen.getByRole("heading", { name: "Wed power bike" })).toBeInTheDocument();
    expect(screen.getByText("Power faded in the final interval.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Thu easy run/i }));

    expect(screen.getByRole("heading", { name: "Thu easy run" })).toBeInTheDocument();
    expect(screen.getByText("The run was skipped before the weekend block.")).toBeInTheDocument();
    expect(screen.getByText("Drop it and keep the long bike unchanged.")).toBeInTheDocument();
  });
});
