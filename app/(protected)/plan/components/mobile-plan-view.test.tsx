import { fireEvent, render, screen } from "@testing-library/react";
import { MobilePlanView } from "./mobile-plan-view";
import type { SessionPillSession } from "./session-pill";

type GridSession = SessionPillSession & {
  week_id: string;
  date: string;
  day_order?: number | null;
};

const weeks = [
  { id: "wk-1", week_index: 1, week_start_date: "2026-04-27", block_id: "b1" },
  { id: "wk-2", week_index: 2, week_start_date: "2026-05-04", block_id: "b1" },
  { id: "wk-3", week_index: 3, week_start_date: "2026-05-11", block_id: "b1" }
];

function makeSession(overrides: Partial<GridSession> & { id: string }): GridSession {
  return {
    sport: "run",
    type: "Run",
    session_name: `S-${overrides.id}`,
    target: null,
    notes: null,
    duration_minutes: 30,
    week_id: "wk-1",
    date: "2026-04-28",
    day_order: 0,
    ...overrides
  } as GridSession;
}

describe("MobilePlanView", () => {
  it("opens on the current week and shows its pills", () => {
    const sessions: GridSession[] = [
      makeSession({ id: "s1", week_id: "wk-2", date: "2026-05-05", session_name: "WeekTwo" }),
      makeSession({ id: "s2", week_id: "wk-1", date: "2026-04-28", session_name: "WeekOne" })
    ];

    render(
      <MobilePlanView
        weeks={weeks}
        sessions={sessions}
        todayIso="2026-05-05"
        adaptationsBySession={{}}
        onSelectSession={() => {}}
      />
    );

    expect(screen.getByText(/Wk 2 of 3/)).toBeInTheDocument();
    expect(screen.getByText(/★ NOW/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /WeekTwo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /WeekOne/ })).not.toBeInTheDocument();
  });

  it("navigates between weeks with prev/next buttons", () => {
    const sessions: GridSession[] = [
      makeSession({ id: "s1", week_id: "wk-1", date: "2026-04-28", session_name: "Alpha" }),
      makeSession({ id: "s2", week_id: "wk-2", date: "2026-05-05", session_name: "Bravo" })
    ];

    render(
      <MobilePlanView
        weeks={weeks}
        sessions={sessions}
        todayIso="2026-04-28"
        adaptationsBySession={{}}
        onSelectSession={() => {}}
      />
    );

    expect(screen.getByText(/Wk 1 of 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Next week"));
    expect(screen.getByText(/Wk 2 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bravo/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Previous week"));
    expect(screen.getByText(/Wk 1 of 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alpha/ })).toBeInTheDocument();
  });

  it("disables prev/next at the boundaries", () => {
    render(
      <MobilePlanView
        weeks={weeks}
        sessions={[]}
        todayIso="2026-04-28"
        adaptationsBySession={{}}
      />
    );

    expect(screen.getByLabelText("Previous week")).toBeDisabled();
    expect(screen.getByLabelText("Next week")).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText("Next week"));
    fireEvent.click(screen.getByLabelText("Next week"));
    expect(screen.getByLabelText("Next week")).toBeDisabled();
  });

  it("invokes onSelectSession when a pill is tapped", () => {
    const onSelect = jest.fn();
    const sessions: GridSession[] = [
      makeSession({ id: "s1", week_id: "wk-1", date: "2026-04-28", session_name: "Tap me" })
    ];

    render(
      <MobilePlanView
        weeks={weeks}
        sessions={sessions}
        todayIso="2026-04-28"
        adaptationsBySession={{}}
        onSelectSession={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Tap me/ }));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("renders empty placeholder when no weeks", () => {
    render(
      <MobilePlanView
        weeks={[]}
        sessions={[]}
        todayIso="2026-04-28"
        adaptationsBySession={{}}
      />
    );

    expect(screen.getByText(/No weeks in this block yet/)).toBeInTheDocument();
  });
});
