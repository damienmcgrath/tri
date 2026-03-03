import { fireEvent, render, screen } from "@testing-library/react";
import { WeekProgressCard } from "./week-progress-card";

describe("WeekProgressCard", () => {
  it("filters planned vs unscheduled work", () => {
    render(
      <WeekProgressCard
        plannedTotalMinutes={120}
        completedTotalMinutes={90}
        extraTotalMinutes={30}
        disciplines={[
          { key: "run", label: "Run", plannedMinutes: 120, completedMinutes: 90, extraMinutes: 30, color: "#fff" },
          { key: "bike", label: "Bike", plannedMinutes: 0, completedMinutes: 0, extraMinutes: 15, color: "#000" }
        ]}
      />
    );

    expect(screen.getByText("Extra work: 30m")).toBeInTheDocument();
    expect(screen.getByText("120 / 120 min")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Planned only" }));
    expect(screen.getByText("90 / 120 min")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unscheduled only" }));
    expect(screen.getByText("30 / 0 min")).toBeInTheDocument();
    expect(screen.getByText("15 / 0 min")).toBeInTheDocument();
  });

  it("starts collapsed in compact mode and expands on demand", () => {
    render(
      <WeekProgressCard
        plannedTotalMinutes={120}
        completedTotalMinutes={60}
        disciplines={[
          { key: "run", label: "Run", plannedMinutes: 120, completedMinutes: 60, color: "#fff" }
        ]}
        compact
      />
    );

    const toggle = screen.getByRole("button", { name: "View full breakdown" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Focus: Run")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("By discipline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse summary" })).toHaveAttribute("aria-expanded", "true");
  });
});
