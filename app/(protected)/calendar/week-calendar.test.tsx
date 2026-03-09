import { fireEvent, render, screen } from "@testing-library/react";
import { WeekCalendar } from "./week-calendar";

jest.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

jest.mock("./actions", () => ({
  clearSkippedAction: jest.fn(),
  markSkippedAction: jest.fn(),
  moveSessionAction: jest.fn(),
  quickAddSessionAction: jest.fn()
}));

const weekDays = [
  { iso: "2026-03-02", weekday: "Mon", label: "Mar 2" },
  { iso: "2026-03-03", weekday: "Tue", label: "Mar 3" },
  { iso: "2026-03-04", weekday: "Wed", label: "Mar 4" },
  { iso: "2026-03-05", weekday: "Thu", label: "Mar 5" },
  { iso: "2026-03-06", weekday: "Fri", label: "Mar 6" },
  { iso: "2026-03-07", weekday: "Sat", label: "Mar 7" },
  { iso: "2026-03-08", weekday: "Sun", label: "Mar 8" }
];

const sessions = [
  {
    id: "s1",
    date: "2026-03-02",
    sport: "run",
    type: "Tempo",
    duration: 45,
    notes: null,
    created_at: "2026-03-01T00:00:00.000Z",
    status: "planned" as const,
    displayType: "planned_session" as const,
    is_key: false
  },
  {
    id: "activity:a1",
    date: "2026-03-02",
    sport: "run",
    type: "Completed activity",
    duration: 35,
    notes: null,
    created_at: "2026-03-02T08:00:00.000Z",
    status: "completed" as const,
    displayType: "completed_activity" as const,
    linkedActivityCount: 1,
    linkedStats: { durationMin: 35, distanceKm: 7, avgHr: 150, avgPower: null },
    is_key: false
  }
];

describe("WeekCalendar", () => {
  it("shows adaptation strip for unmatched uploads and filters by extra state", () => {
    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={sessions}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={1}
        skippedCount={0}
        extraSessionCount={1}
        plannedRemainingCount={1}
        plannedMinutes={45}
        completedMinutes={35}
        remainingMinutes={10}
      />
    );

    expect(screen.getByText("Adaptation tray")).toBeInTheDocument();
    expect(screen.getByText("Unmatched upload")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "extra" } });
    expect(screen.queryByText("Tempo")).not.toBeInTheDocument();
    expect(screen.getByText("Completed activity")).toBeInTheDocument();
  });
});
