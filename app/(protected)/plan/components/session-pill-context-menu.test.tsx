import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  SessionPillContextMenu,
  buildWeekDays,
  formatMoveToLabel
} from "./session-pill-context-menu";

const weekDays = buildWeekDays("2026-04-27", "wk-1", "2026-04-28");

describe("SessionPillContextMenu", () => {
  it("renders the five top-level actions", () => {
    render(
      <SessionPillContextMenu
        x={10}
        y={10}
        isKey={false}
        weekDays={weekDays}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByRole("menuitem", { name: "Duplicate to next day" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Move to ▸" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Mark as Key" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Convert to Rest" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("flips the Key label when the session is already keyed", () => {
    render(
      <SessionPillContextMenu
        x={10}
        y={10}
        isKey={true}
        weekDays={weekDays}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByRole("menuitem", { name: "Unmark as Key" })).toBeInTheDocument();
  });

  it("emits duplicate-next-day on click", () => {
    const onSelect = jest.fn();
    render(
      <SessionPillContextMenu
        x={10}
        y={10}
        isKey={false}
        weekDays={weekDays}
        onSelect={onSelect}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate to next day" }));
    expect(onSelect).toHaveBeenCalledWith({ type: "duplicate-next-day" });
  });

  it("emits move-to with the chosen day from the submenu", () => {
    const onSelect = jest.fn();
    render(
      <SessionPillContextMenu
        x={10}
        y={10}
        isKey={false}
        weekDays={weekDays}
        onSelect={onSelect}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to ▸" }));
    const submenu = screen.getByRole("menu", { name: "Move to day" });
    const wedLabel = formatMoveToLabel("2026-04-29");
    fireEvent.click(within(submenu).getByRole("menuitem", { name: wedLabel }));
    expect(onSelect).toHaveBeenCalledWith({
      type: "move-to",
      date: "2026-04-29",
      weekId: "wk-1"
    });
  });

  it("disables the current day in the move-to submenu", () => {
    render(
      <SessionPillContextMenu
        x={10}
        y={10}
        isKey={false}
        weekDays={weekDays}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to ▸" }));
    const submenu = screen.getByRole("menu", { name: "Move to day" });
    const currentLabel = `${formatMoveToLabel("2026-04-28")} (current)`;
    expect(within(submenu).getByRole("menuitem", { name: currentLabel })).toBeDisabled();
  });

  it("flips the Move-to submenu to the left when the parent menu is near the right edge", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390, writable: true });
    try {
      render(
        <SessionPillContextMenu
          x={380}
          y={10}
          isKey={false}
          weekDays={weekDays}
          onSelect={jest.fn()}
          onClose={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Move to ▸" }));
      const submenu = screen.getByRole("menu", { name: "Move to day" });
      expect(submenu).toHaveAttribute("data-flipped", "true");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth, writable: true });
    }
  });

  it("keeps the Move-to submenu on the right when there's room", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280, writable: true });
    try {
      render(
        <SessionPillContextMenu
          x={100}
          y={10}
          isKey={false}
          weekDays={weekDays}
          onSelect={jest.fn()}
          onClose={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Move to ▸" }));
      const submenu = screen.getByRole("menu", { name: "Move to day" });
      expect(submenu).toHaveAttribute("data-flipped", "false");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth, writable: true });
    }
  });

  it("emits convert-to-rest and delete actions", () => {
    const onSelect = jest.fn();
    render(
      <SessionPillContextMenu
        x={10}
        y={10}
        isKey={false}
        weekDays={weekDays}
        onSelect={onSelect}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Convert to Rest" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onSelect).toHaveBeenCalledWith({ type: "convert-to-rest" });
    expect(onSelect).toHaveBeenCalledWith({ type: "delete" });
  });

  it("closes on Escape", () => {
    const onClose = jest.fn();
    render(
      <SessionPillContextMenu
        x={10}
        y={10}
        isKey={false}
        weekDays={weekDays}
        onSelect={jest.fn()}
        onClose={onClose}
      />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape collapses the submenu before closing", () => {
    const onClose = jest.fn();
    render(
      <SessionPillContextMenu
        x={10}
        y={10}
        isKey={false}
        weekDays={weekDays}
        onSelect={jest.fn()}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to ▸" }));
    expect(screen.queryByRole("menu", { name: "Move to day" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Move to day" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
