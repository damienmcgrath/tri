import {
  DAY_STATE_LABELS,
  EXECUTION_RESULT_LABELS,
  getExecutionResultLabel,
  getSessionIntentLabel,
  getSessionLifecycleLabel,
  getSessionRoleLabel,
  SESSION_INTENT_CATEGORIES,
  SESSION_LIFECYCLE_LABELS,
  SESSION_LIFECYCLE_TONES
} from "./semantics";

describe("training semantics", () => {
  it("exposes labels for all session lifecycle states", () => {
    expect(SESSION_LIFECYCLE_LABELS.assigned_from_upload).toBe("Assigned from upload");
    expect(SESSION_LIFECYCLE_LABELS.unmatched_upload).toBe("Unmatched upload");
    expect(getSessionLifecycleLabel("moved")).toBe("Moved");
  });

  it("exposes day, role, and intent labels", () => {
    expect(DAY_STATE_LABELS.needs_attention).toBe("Needs attention");
    expect(getSessionRoleLabel("supporting")).toBe("Supporting");
    expect(getSessionIntentLabel("z2_endurance")).toBe("Z2 endurance");
    expect(SESSION_INTENT_CATEGORIES).toContain("technique_swim");
  });

  it("exposes execution labels and shared tone mapping", () => {
    expect(getExecutionResultLabel("partial_intent")).toBe("Partial intent");
    expect(EXECUTION_RESULT_LABELS.missed_intent).toBe("Missed intent");
    expect(SESSION_LIFECYCLE_TONES.unmatched_upload).toBe("attention");
  });
});
