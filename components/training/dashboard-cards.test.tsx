import { render, screen } from "@testing-library/react";
import { WeeklyInterventionCard } from "./dashboard-cards";

describe("WeeklyInterventionCard", () => {
  it("renders the current week intervention in coach-grade language", () => {
    render(
      <WeeklyInterventionCard
        title="Weekly risk: At risk"
        statusLine="At risk"
        why="150 min of bike load remains and the key weekend session is still open."
        recommendedAction="Keep Saturday long bike fixed and do not backfill missed easy volume."
        impactIfIgnored="The week may lose its intended bike stimulus."
        href="/calendar"
      />
    );

    expect(screen.getByText("Weekly risk: At risk")).toBeInTheDocument();
    expect(screen.getByText("Why this matters")).toBeInTheDocument();
    expect(screen.getByText(/Keep Saturday long bike fixed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Calendar" })).toHaveAttribute("href", "/calendar");
  });
});
