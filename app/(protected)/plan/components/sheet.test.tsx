import { fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "./sheet";

describe("Sheet", () => {
  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={() => {}} ariaLabel="Test sheet">
        <div>content</div>
      </Sheet>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders right-edge by default", () => {
    render(
      <Sheet open onClose={() => {}} ariaLabel="Right sheet">
        <div>content</div>
      </Sheet>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-side", "right");
    expect(dialog.className).toMatch(/right-0/);
    expect(dialog.className).toMatch(/max-w-\[440px\]/);
  });

  it("renders bottom sheet with drag handle when side=bottom", () => {
    render(
      <Sheet open onClose={() => {}} ariaLabel="Bottom sheet" side="bottom">
        <div>content</div>
      </Sheet>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-side", "bottom");
    expect(dialog.className).toMatch(/bottom-0/);
    expect(dialog.className).toMatch(/max-h-\[85vh\]/);
    expect(dialog.className).toMatch(/rounded-t-xl/);
    expect(screen.getByLabelText("Drag handle")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = jest.fn();
    render(
      <Sheet open onClose={onClose} ariaLabel="Bottom sheet" side="bottom">
        <button>focus me</button>
      </Sheet>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on backdrop click", () => {
    const onClose = jest.fn();
    const { container } = render(
      <Sheet open onClose={onClose} ariaLabel="Bottom sheet" side="bottom">
        <div>content</div>
      </Sheet>
    );
    const backdrop = container.ownerDocument.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalled();
  });
});
