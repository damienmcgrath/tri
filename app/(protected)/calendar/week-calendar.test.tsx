import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WeekCalendar } from "./week-calendar";
import { markActivityExtraAction } from "./actions";

jest.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

jest.mock("./actions", () => ({
  clearSkippedAction: jest.fn(),
  confirmSkippedAction: jest.fn(),
  markActivityExtraAction: jest.fn(),
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

const plannedSession = {
  id: "s1",
  date: "2026-03-02",
  sport: "run",
  type: "Tempo",
  duration: 45,
  notes: null,
  created_at: "2026-03-01T00:00:00.000Z",
  status: "planned" as const,
  displayType: "planned_session" as const,
  is_key: true
};

const uploadActivity = {
  id: "activity:a1",
  date: "2026-03-02",
  sport: "run",
  type: "Completed activity",
  duration: 35,
  notes: null,
  created_at: "2026-03-02T08:00:00.000Z",
  status: "completed" as const,
  displayType: "completed_activity" as const,
  source: { uploadId: "upload-1", assignedBy: "upload" as const },
  linkedActivityCount: 1,
  linkedStats: { durationMin: 35, distanceKm: 7, avgHr: 150, avgPower: null },
  is_key: false
};

describe("WeekCalendar", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("shows the adaptation strip and keeps upload assignment secondary", () => {
    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[plannedSession, uploadActivity]}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={1}
        skippedCount={0}
        extraSessionCount={0}
        plannedRemainingCount={1}
        plannedMinutes={45}
        completedMinutes={35}
        remainingMinutes={10}
      />
    );

    expect(screen.getByText("Week adaptation")).toBeInTheDocument();
    expect(screen.getByText("Uploads needing assignment")).toBeInTheDocument();
    expect(screen.getAllByText("Uploaded workout").length).toBeGreaterThan(0);
  });

  it("allows marking an unmatched upload as extra and filtering to extra work", async () => {
    (markActivityExtraAction as jest.Mock).mockResolvedValue(undefined);

    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[plannedSession, uploadActivity]}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={1}
        skippedCount={0}
        extraSessionCount={0}
        plannedRemainingCount={1}
        plannedMinutes={45}
        completedMinutes={35}
        remainingMinutes={10}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark extra" }));

    expect(markActivityExtraAction).toHaveBeenCalledWith({ activityId: "a1" });
    expect(await screen.findByText("Marked as extra workout")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "extra" } });
    expect(screen.queryByText("Tempo")).not.toBeInTheDocument();
  });

  it("opens the upload assignment workspace and prefers a same-day same-sport session", () => {
    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[
          {
            id: "s-early",
            date: "2026-03-02",
            sport: "bike",
            type: "Bike endurance",
            duration: 60,
            notes: null,
            created_at: "2026-03-01T00:00:00.000Z",
            status: "planned" as const,
            displayType: "planned_session" as const,
            is_key: false
          },
          {
            id: "s-target",
            date: "2026-03-02",
            sport: "run",
            type: "Tempo",
            duration: 40,
            notes: null,
            created_at: "2026-03-01T01:00:00.000Z",
            status: "planned" as const,
            displayType: "planned_session" as const,
            is_key: false
          },
          uploadActivity
        ]}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={2}
        skippedCount={0}
        extraSessionCount={0}
        plannedRemainingCount={2}
        plannedMinutes={100}
        completedMinutes={35}
        remainingMinutes={65}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Assign to session" }));

    expect(screen.getByText("Upload needs review")).toBeInTheDocument();
    const selects = screen.getAllByRole("combobox");
    const assignmentSelect = selects[selects.length - 1] as HTMLSelectElement;
    expect(assignmentSelect.value).toBe("s-target");
  });

  it("routes completed-activity card details to the activity session review page", () => {
    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[plannedSession, uploadActivity]}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={1}
        skippedCount={0}
        extraSessionCount={0}
        plannedRemainingCount={1}
        plannedMinutes={45}
        completedMinutes={35}
        remainingMinutes={10}
      />
    );

    const actionButtons = screen.getAllByRole("button", { name: "Card actions" });
    fireEvent.click(actionButtons[actionButtons.length - 1]);
    const openDetailsLinks = screen.getAllByRole("link", { name: "Open details" });
    expect(openDetailsLinks[openDetailsLinks.length - 1]).toHaveAttribute("href", "/sessions/activity/a1");
  });

  it("applies upload assignment and keeps the planned session visible as completed", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[
          plannedSession,
          {
            ...uploadActivity,
            source: { uploadId: "upload-1", assignedBy: "upload" as const }
          }
        ]}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={1}
        skippedCount={0}
        extraSessionCount={0}
        plannedRemainingCount={1}
        plannedMinutes={45}
        completedMinutes={35}
        remainingMinutes={10}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Assign to session" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Assign to session" }).at(-1) as HTMLElement);

    expect(await screen.findByText("Upload assigned to session")).toBeInTheDocument();

    const tempoCard = screen.getByRole("link", { name: /Tempo/i }).closest("article");
    expect(tempoCard).not.toBeNull();
    expect(within(tempoCard as HTMLElement).getByText("Completed")).toBeInTheDocument();
  });

  it("shows the adaptation decision panel for a drifting week", () => {
    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[plannedSession]}
        executionLabel="Execution"
        completedCount={0}
        plannedTotalCount={1}
        skippedCount={0}
        extraSessionCount={0}
        plannedRemainingCount={1}
        plannedMinutes={45}
        completedMinutes={0}
        remainingMinutes={45}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Review options" }));

    expect(screen.getByText("Repair the week")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep as planned" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decide later" })).toBeInTheDocument();
  });
});
