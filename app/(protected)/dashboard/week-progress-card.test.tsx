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
});
