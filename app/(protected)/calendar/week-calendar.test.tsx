import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WeekCalendar } from "./week-calendar";
import { confirmSkippedAction, markActivityExtraAction } from "./actions";

jest.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ refresh: jest.fn(), replace: jest.fn() }),
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
    id: "activity-a1",
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
  }
];

const skippedSession = {
  id: "s-skipped",
  date: "2026-03-05",
  sport: "run",
  type: "Easy",
  duration: 30,
  notes: "Easy\n[Skipped 2026-03-05]",
  created_at: "2026-03-01T00:00:00.000Z",
  status: "skipped" as const,
  displayType: "planned_session" as const,
  is_key: false
};

describe("WeekCalendar", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    window.localStorage.clear();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("shows needs-attention queue for uploads needing review and filters by extra state", () => {
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

    expect(screen.getAllByText("Needs attention").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Upload needs review/).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Status filter"), { target: { value: "extra" } });
    expect(screen.queryByText("Tempo")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed activity")).not.toBeInTheDocument();
  });

  it("allows marking unmatched upload as extra so it appears as extra workout item", async () => {
    (markActivityExtraAction as jest.Mock).mockResolvedValue(undefined);

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

    fireEvent.click(screen.getByRole("button", { name: "Mark extra" }));

    expect(markActivityExtraAction).toHaveBeenCalledWith({ activityId: "a1" });
    expect(await screen.findByText("Extra workout logged")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Upload needs review/)).not.toBeInTheDocument());
  });

  it("persists dismissed needs-attention items across refreshes", async () => {
    const { unmount } = render(
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

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Upload needs review")).not.toBeInTheDocument());

    unmount();

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

    await waitFor(() => expect(screen.queryByText("Upload needs review")).not.toBeInTheDocument());
  });

  it("opens the upload review drawer from the unresolved day card", () => {
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

    const assignButtons = screen.getAllByRole("button", { name: "Assign to session" });
    fireEvent.click(assignButtons[assignButtons.length - 1]);

    expect(screen.getAllByText("Upload needs review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Uploaded workout").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Assign to session" }).length).toBeGreaterThan(0);
  });

  it("routes activity-card open details to the session review page", () => {
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

    const actionButtons = screen.getAllByRole("button", { name: "Card actions" });
    fireEvent.click(actionButtons[actionButtons.length - 1]);
    const openDetailsLinks = screen.getAllByRole("link", { name: "Open details" });
    const activityLink = openDetailsLinks[openDetailsLinks.length - 1];

    expect(activityLink).toHaveAttribute("href", "/sessions/activity-a1");
  });

  it("prefers a same-day same-sport session when opening upload assignment from the sidebar", () => {
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
          sessions[1]
        ]}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={2}
        skippedCount={0}
        extraSessionCount={1}
        plannedRemainingCount={2}
        plannedMinutes={100}
        completedMinutes={35}
        remainingMinutes={65}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Assign to session" }));

    const selects = screen.getAllByRole("combobox");
    const assignmentSelect = selects[selects.length - 1] as HTMLSelectElement;
    expect(assignmentSelect.value).toBe("s-target");
  });

  it("keeps the matched planned session visible after assigning an upload from the sidebar", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });

    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[
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
            ...sessions[1],
            source: { uploadId: "upload-1", assignedBy: "upload" as const }
          }
        ]}
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

    fireEvent.click(screen.getByRole("button", { name: "Assign to session" }));

    const assignButtons = screen.getAllByRole("button", { name: "Assign to session" });
    fireEvent.click(assignButtons[assignButtons.length - 1]);

    expect(await screen.findByText("Upload assigned to session")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole("button", { name: "Assign to session" })).toHaveLength(0));
    const tempoCard = screen.getByRole("link", { name: /Tempo/i }).closest("article");
    expect(tempoCard).not.toBeNull();
    expect(within(tempoCard as HTMLElement).getByText("Completed")).toBeInTheDocument();
  });

  it("persists confirm skip so the skipped-session alert clears", async () => {
    (confirmSkippedAction as jest.Mock).mockResolvedValue(undefined);

    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[skippedSession]}
        executionLabel="Execution"
        completedCount={0}
        plannedTotalCount={1}
        skippedCount={1}
        extraSessionCount={0}
        plannedRemainingCount={0}
        plannedMinutes={30}
        completedMinutes={0}
        remainingMinutes={0}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm skip" }));

    expect(confirmSkippedAction).toHaveBeenCalledWith({ sessionId: "s-skipped" });
    expect(await screen.findByText("Skip confirmed")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Skipped session")).not.toBeInTheDocument());
  });

  it("uses discipline fallback for weak generic completed titles and hides inline open review text", () => {
    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[
          {
            id: "s2",
            date: "2026-03-03",
            sport: "bike",
            type: "Session Bike",
            duration: 50,
            notes: null,
            created_at: "2026-03-03T08:00:00.000Z",
            status: "completed" as const,
            displayType: "planned_session" as const,
            is_key: false
          }
        ]}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={1}
        skippedCount={0}
        extraSessionCount={0}
        plannedRemainingCount={0}
        plannedMinutes={50}
        completedMinutes={50}
        remainingMinutes={0}
      />
    );

    expect(screen.getByRole("link", { name: /Bike/i })).toBeInTheDocument();
    expect(screen.queryByText("Session Bike")).not.toBeInTheDocument();
    expect(screen.queryByText("Open review")).not.toBeInTheDocument();
  });

  it("keeps completed footer minimal without showing upload-match copy on card face", () => {
    render(
      <WeekCalendar
        weekDays={weekDays}
        sessions={[
          {
            id: "s3",
            date: "2026-03-03",
            sport: "run",
            type: "Tempo",
            duration: 42,
            notes: null,
            created_at: "2026-03-03T08:00:00.000Z",
            status: "completed" as const,
            linkedActivityCount: 1,
            displayType: "planned_session" as const,
            is_key: false
          }
        ]}
        executionLabel="Execution"
        completedCount={1}
        plannedTotalCount={1}
        skippedCount={0}
        extraSessionCount={0}
        plannedRemainingCount={0}
        plannedMinutes={42}
        completedMinutes={42}
        remainingMinutes={0}
      />
    );

    const reviewCard = screen.getByRole("link", { name: /Tempo/i }).closest("article");
    expect(reviewCard).not.toBeNull();
    const cardScope = within(reviewCard as HTMLElement);
    expect(cardScope.getByText("Completed")).toBeInTheDocument();
    expect(cardScope.queryByText("Upload matched")).not.toBeInTheDocument();
    expect(screen.queryByText("Assigned from upload")).not.toBeInTheDocument();
  });

});
