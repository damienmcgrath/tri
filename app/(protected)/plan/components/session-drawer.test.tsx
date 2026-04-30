import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const updateMock = jest.fn();
const deleteMock = jest.fn();

jest.mock("../actions", () => ({
  updateSessionDetailsAction: (...args: unknown[]) => updateMock(...args),
  deleteSessionAction: (...args: unknown[]) => deleteMock(...args)
}));

import { SessionDrawer, type DrawerSession } from "./session-drawer";

const baseSession: DrawerSession = {
  id: "11111111-1111-4111-8111-111111111111",
  plan_id: "22222222-2222-4222-8222-222222222222",
  week_id: "33333333-3333-4333-8333-333333333333",
  date: "2026-05-04",
  sport: "run",
  type: "Run",
  session_name: "Easy aerobic",
  intent_category: "Easy Z2",
  duration_minutes: 45,
  target: "HR < 145",
  notes: "Keep it conversational",
  session_role: "Supporting",
  is_key: false
};

describe("SessionDrawer", () => {
  beforeEach(() => {
    updateMock.mockReset();
    deleteMock.mockReset();
    updateMock.mockResolvedValue(undefined);
    deleteMock.mockResolvedValue(undefined);
  });

  function renderDrawer(overrides: Partial<React.ComponentProps<typeof SessionDrawer>> = {}) {
    const props = {
      session: baseSession,
      adaptations: [],
      open: true,
      onClose: jest.fn(),
      onSaved: jest.fn(),
      onDeleted: jest.fn(),
      ...overrides
    };
    const utils = render(<SessionDrawer {...props} />);
    return { ...utils, props };
  }

  it("renders all fields populated from the session prop", () => {
    renderDrawer();
    expect(screen.getByLabelText("Type / Intent")).toHaveValue("Easy Z2");
    expect(screen.getByLabelText("Name")).toHaveValue("Easy aerobic");
    expect(screen.getByLabelText("Duration (minutes)")).toHaveValue(45);
    expect(screen.getByLabelText("Target / Structure")).toHaveValue("HR < 145");
    expect(screen.getByLabelText("Notes")).toHaveValue("Keep it conversational");
    expect(screen.getByRole("radio", { name: "Run" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Supporting" })).toHaveAttribute("aria-checked", "true");
  });

  it("surfaces the custom intent input when a free-form label is set", () => {
    render(
      <SessionDrawer
        session={{ ...baseSession, intent_category: "Custom blast" }}
        adaptations={[]}
        open
        onClose={jest.fn()}
        onSaved={jest.fn()}
        onDeleted={jest.fn()}
      />
    );
    expect(screen.getByLabelText("Custom intent")).toHaveValue("Custom blast");
  });

  it("disables Save until a field is edited", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "60" } });
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  it("calls updateSessionDetailsAction and onSaved on Save", async () => {
    const { props } = renderDrawer();
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: baseSession.id,
        durationMinutes: 60,
        sport: "run",
        sessionRole: "Supporting"
      })
    );
    expect(props.onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: baseSession.id, duration_minutes: 60 })
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it("prompts to discard when closing dirty", () => {
    const { props } = renderDrawer();
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("closes silently when not dirty", () => {
    const { props } = renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("delete shows confirm and only deletes on confirm", async () => {
    const { props } = renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByText(/delete this session\?/i)).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(props.onDeleted).toHaveBeenCalledWith(baseSession.id);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders the adaptation log only when entries are present", () => {
    const { rerender, props } = renderDrawer();
    expect(screen.queryByLabelText(/adaptation log/i)).not.toBeInTheDocument();

    rerender(
      <SessionDrawer
        {...props}
        adaptations={[
          {
            id: "ad1",
            trigger_type: "recovery_signal",
            rationale_text: "Lowered intensity after a poor sleep score.",
            created_at: "2026-04-29T10:00:00Z"
          }
        ]}
      />
    );
    expect(screen.getByLabelText(/adaptation log/i)).toBeInTheDocument();
    expect(screen.getByText(/lowered intensity/i)).toBeInTheDocument();
  });

  it("surfaces an error and stays open if save fails", async () => {
    updateMock.mockRejectedValueOnce(new Error("network down"));
    const { props } = renderDrawer();
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/network down/i));
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
