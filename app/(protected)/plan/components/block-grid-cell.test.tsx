import { act, fireEvent, render, screen } from "@testing-library/react";
import { BlockGridCell } from "./block-grid-cell";
import type { SessionPillSession } from "./session-pill";

const sampleSession: SessionPillSession = {
  id: "11111111-1111-4111-8111-111111111111",
  sport: "run",
  type: "Run",
  session_name: "Easy",
  target: null,
  notes: null,
  duration_minutes: 45
};

describe("BlockGridCell empty-cell affordance", () => {
  function dispatchTouchPointerEvent(
    element: HTMLElement,
    type: "pointerdown" | "pointerup",
    coords: { clientX: number; clientY: number }
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
    Object.assign(event, { pointerType: "touch", ...coords });
    fireEvent(element, event);
  }

  it("renders the Add affordance only when emptyAffordance is provided and cell is empty", () => {
    const onClick = jest.fn();
    const onContextMenu = jest.fn();
    render(
      <BlockGridCell
        sessions={[]}
        emptyAffordance={{
          weekId: "wk-1",
          date: "2026-05-04",
          onClick,
          onContextMenu
        }}
      />
    );
    expect(screen.getByRole("button", { name: "Add session" })).toBeInTheDocument();
  });

  it("does not render an Add button when sessions are present", () => {
    render(
      <BlockGridCell
        sessions={[sampleSession]}
        emptyAffordance={{
          weekId: "wk-1",
          date: "2026-05-04",
          onClick: jest.fn(),
          onContextMenu: jest.fn()
        }}
      />
    );
    expect(screen.queryByRole("button", { name: "Add session" })).not.toBeInTheDocument();
  });

  it("does not render an Add button when no emptyAffordance is provided", () => {
    render(<BlockGridCell sessions={[]} />);
    expect(screen.queryByRole("button", { name: "Add session" })).not.toBeInTheDocument();
  });

  it("calls onClick with weekId and date when the Add button is clicked", () => {
    const onClick = jest.fn();
    render(
      <BlockGridCell
        sessions={[]}
        emptyAffordance={{
          weekId: "wk-1",
          date: "2026-05-04",
          onClick,
          onContextMenu: jest.fn()
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Add session" }));
    expect(onClick).toHaveBeenCalledWith("wk-1", "2026-05-04");
  });

  it("calls onContextMenu with coords and prevents the default browser menu", () => {
    const onContextMenu = jest.fn();
    render(
      <BlockGridCell
        sessions={[]}
        emptyAffordance={{
          weekId: "wk-1",
          date: "2026-05-04",
          onClick: jest.fn(),
          onContextMenu
        }}
      />
    );
    const button = screen.getByRole("button", { name: "Add session" });
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 240
    });
    const prevented = !button.dispatchEvent(event);
    expect(prevented).toBe(true);
    expect(onContextMenu).toHaveBeenCalledWith("wk-1", "2026-05-04", 120, 240);
  });

  it("does not swallow the next tap after a long-press opens the context menu", () => {
    jest.useFakeTimers();
    try {
      const onClick = jest.fn();
      const onContextMenu = jest.fn();
      render(
        <BlockGridCell
          sessions={[]}
          emptyAffordance={{
            weekId: "wk-1",
            date: "2026-05-04",
            onClick,
            onContextMenu
          }}
        />
      );

      const button = screen.getByRole("button", { name: "Add session" });
      dispatchTouchPointerEvent(button, "pointerdown", { clientX: 80, clientY: 90 });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      dispatchTouchPointerEvent(button, "pointerup", { clientX: 80, clientY: 90 });

      expect(onContextMenu).toHaveBeenCalledWith("wk-1", "2026-05-04", 80, 90);
      expect(onClick).not.toHaveBeenCalled();

      dispatchTouchPointerEvent(button, "pointerdown", { clientX: 82, clientY: 92 });
      dispatchTouchPointerEvent(button, "pointerup", { clientX: 82, clientY: 92 });
      fireEvent.click(button);

      expect(onClick).toHaveBeenCalledWith("wk-1", "2026-05-04");
    } finally {
      jest.useRealTimers();
    }
  });
});
