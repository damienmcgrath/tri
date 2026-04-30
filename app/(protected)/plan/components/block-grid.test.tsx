import { render, screen, within } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { BlockGrid } from "./block-grid";
import type { SessionPillSession } from "./session-pill";

function renderGrid(ui: React.ReactElement) {
  return render(<DndContext>{ui}</DndContext>);
}

type GridSession = SessionPillSession & {
  week_id: string;
  date: string;
  day_order?: number | null;
};

const week = {
  id: "wk-1",
  week_index: 1,
  week_start_date: "2026-04-27",
  block_id: "b1"
};

function makeSession(overrides: Partial<GridSession> & { id: string; day_order: number | null }): GridSession {
  return {
    sport: "run",
    type: "Run",
    session_name: `S-${overrides.id}`,
    target: null,
    notes: null,
    duration_minutes: 30,
    week_id: "wk-1",
    date: "2026-04-28",
    ...overrides
  } as GridSession;
}

describe("BlockGrid per-day sort", () => {
  it("renders pills ordered by day_order ascending regardless of input array order", () => {
    const sessions: GridSession[] = [
      makeSession({ id: "s-mid", day_order: 1, session_name: "Bravo" }),
      makeSession({ id: "s-last", day_order: 2, session_name: "Charlie" }),
      makeSession({ id: "s-first", day_order: 0, session_name: "Alpha" })
    ];

    renderGrid(
      <BlockGrid
        weeks={[week]}
        sessions={sessions as never}
        todayIso="2026-04-28"
        adaptationsBySession={{}}
        onSelectSession={() => {}}
      />
    );

    // The day cell holds three buttons. Their accessible names embed the
    // session name so we can assert visual order via the button list.
    const buttons = screen.getAllByRole("button");
    const tuesdayButtons = buttons.filter((b) => /Bravo|Charlie|Alpha/.test(b.getAttribute("aria-label") ?? ""));
    expect(tuesdayButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Bravo"),
      expect.stringContaining("Charlie")
    ]);
  });

  it("places sessions without a day_order at the bottom of the stack", () => {
    const sessions: GridSession[] = [
      makeSession({ id: "s-null", day_order: null, session_name: "Zulu" }),
      makeSession({ id: "s-zero", day_order: 0, session_name: "Alpha" }),
      makeSession({ id: "s-one", day_order: 1, session_name: "Bravo" })
    ];

    renderGrid(
      <BlockGrid
        weeks={[week]}
        sessions={sessions as never}
        todayIso="2026-04-28"
        adaptationsBySession={{}}
        onSelectSession={() => {}}
      />
    );

    const buttons = screen.getAllByRole("button");
    const tuesdayButtons = buttons.filter((b) => /Alpha|Bravo|Zulu/.test(b.getAttribute("aria-label") ?? ""));
    expect(tuesdayButtons.map((b) => b.getAttribute("aria-label"))).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Bravo"),
      expect.stringContaining("Zulu")
    ]);
  });

  it("sorts sessions independently per day", () => {
    const sessions: GridSession[] = [
      makeSession({ id: "tue-2", day_order: 1, date: "2026-04-28", session_name: "TueB" }),
      makeSession({ id: "wed-1", day_order: 0, date: "2026-04-29", session_name: "WedA" }),
      makeSession({ id: "tue-1", day_order: 0, date: "2026-04-28", session_name: "TueA" })
    ];

    const { container } = renderGrid(
      <BlockGrid
        weeks={[week]}
        sessions={sessions as never}
        todayIso="2026-04-28"
        adaptationsBySession={{}}
        onSelectSession={() => {}}
      />
    );

    // Find the two day columns by selecting buttons under each cell.
    const allButtons = within(container).getAllByRole("button");
    const tueOrder = allButtons
      .filter((b) => /TueA|TueB/.test(b.getAttribute("aria-label") ?? ""))
      .map((b) => b.getAttribute("aria-label"));
    expect(tueOrder).toEqual([
      expect.stringContaining("TueA"),
      expect.stringContaining("TueB")
    ]);
  });
});
