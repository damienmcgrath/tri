import { fireEvent, render, screen } from "@testing-library/react";
import { CellContextMenu } from "./cell-context-menu";

describe("CellContextMenu", () => {
  it("renders both menu items", () => {
    render(<CellContextMenu x={10} y={10} onSelect={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole("menuitem", { name: "Add session" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Mark as Rest day" })).toBeInTheDocument();
  });

  it("calls onSelect with the chosen action", () => {
    const onSelect = jest.fn();
    render(<CellContextMenu x={10} y={10} onSelect={onSelect} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as Rest day" }));
    expect(onSelect).toHaveBeenCalledWith("rest");
  });

  it("closes on Escape", () => {
    const onClose = jest.fn();
    render(<CellContextMenu x={10} y={10} onSelect={jest.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on outside click", () => {
    const onClose = jest.fn();
    render(
      <div>
        <div data-testid="outside" />
        <CellContextMenu x={10} y={10} onSelect={jest.fn()} onClose={onClose} />
      </div>
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });
});
