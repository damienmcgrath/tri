import { fireEvent, render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SessionPill, type SessionPillSession } from "./session-pill";

const session: SessionPillSession = {
  id: "11111111-1111-4111-8111-111111111111",
  sport: "run",
  type: "Run",
  session_name: "Easy",
  target: null,
  notes: null,
  duration_minutes: 45
};

function renderWithDnd(ui: React.ReactElement) {
  return render(<DndContext>{ui}</DndContext>);
}

describe("SessionPill", () => {
  it("calls onSelect when clicked (no drag config)", () => {
    const onSelect = jest.fn();
    render(<SessionPill session={session} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(session.id);
  });

  it("calls onSelect on click when drag config is enabled", () => {
    const onSelect = jest.fn();
    renderWithDnd(
      <SessionPill
        session={session}
        onSelect={onSelect}
        draggable={{ blockId: "b1", sourceWeekId: "wk-1", sourceDate: "2026-04-28" }}
      />
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(session.id);
  });

  it("invokes onContextMenu with coordinates and prevents the browser menu", () => {
    const onContextMenu = jest.fn();
    renderWithDnd(
      <SessionPill
        session={session}
        onSelect={jest.fn()}
        onContextMenu={onContextMenu}
        draggable={{ blockId: "b1", sourceWeekId: "wk-1", sourceDate: "2026-04-28" }}
      />
    );
    const button = screen.getByRole("button");
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 60
    });
    const prevented = !button.dispatchEvent(event);
    expect(prevented).toBe(true);
    expect(onContextMenu).toHaveBeenCalledWith(session.id, 50, 60);
  });

  it("renders a non-interactive variant when no onSelect is provided", () => {
    render(<SessionPill session={session} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
