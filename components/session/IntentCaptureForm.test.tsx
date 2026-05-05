import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IntentCaptureForm } from "./IntentCaptureForm";

const HEADING = "Was today structured? Tell me the shape in one sentence.";
const FIRST_CHIP = "3 × 40 min work / 20 min easy plus extra to clear 100 km";
const SECOND_CHIP = "1 hour easy then 4 × 8 min at threshold with 4 min recoveries";
const THIRD_CHIP = "Just Z2, no structure";

function renderForm(overrides: Partial<React.ComponentProps<typeof IntentCaptureForm>> = {}) {
  const onSubmit = jest.fn();
  const onSkip = jest.fn();
  const utils = render(
    <IntentCaptureForm onSubmit={onSubmit} onSkip={onSkip} {...overrides} />
  );
  return { onSubmit, onSkip, ...utils };
}

describe("IntentCaptureForm", () => {
  test("renders the heading, textarea, all three example chips, and both buttons", () => {
    renderForm();

    expect(screen.getByRole("heading", { name: HEADING })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /session intent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: FIRST_CHIP })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SECOND_CHIP })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: THIRD_CHIP })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /skip — leave open/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save & continue/i })).toBeInTheDocument();
  });

  test("Save is disabled when input is empty and no chip has been clicked", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /save & continue/i })).toBeDisabled();
  });

  test("typing into the textarea enables Save and submits the trimmed text", async () => {
    const { onSubmit } = renderForm();

    const textarea = screen.getByRole("textbox", { name: /session intent/i });
    fireEvent.change(textarea, { target: { value: "  3 × 1 km at threshold  " } });

    const saveBtn = screen.getByRole("button", { name: /save & continue/i });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("3 × 1 km at threshold");
  });

  test("clicking an example chip populates the textarea and enables Save", () => {
    renderForm();

    const textarea = screen.getByRole("textbox", { name: /session intent/i }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: SECOND_CHIP }));

    expect(textarea.value).toBe(SECOND_CHIP);
    expect(screen.getByRole("button", { name: /save & continue/i })).not.toBeDisabled();
  });

  test("Skip button calls onSkip and does not call onSubmit", () => {
    const { onSubmit, onSkip } = renderForm();

    fireEvent.click(screen.getByRole("button", { name: /skip — leave open/i }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("loading=true disables both action buttons and shows a saving indicator", () => {
    renderForm({ loading: true });

    expect(screen.getByRole("button", { name: /skip — leave open/i })).toBeDisabled();
    const saveBtn = screen.getByRole("button", { name: /saving/i });
    expect(saveBtn).toBeDisabled();
    expect(saveBtn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("intent-save-spinner")).toBeInTheDocument();
  });

  test("defaultValue prefills the textarea and enables Save immediately", () => {
    renderForm({ defaultValue: "easy 60 min spin" });

    const textarea = screen.getByRole("textbox", { name: /session intent/i }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("easy 60 min spin");
    expect(screen.getByRole("button", { name: /save & continue/i })).not.toBeDisabled();
  });

  test("clicking a chip then clearing the textarea keeps Save enabled (chip click counts as intent)", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: THIRD_CHIP }));
    const textarea = screen.getByRole("textbox", { name: /session intent/i }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "" } });

    expect(screen.getByRole("button", { name: /save & continue/i })).not.toBeDisabled();
  });
});
