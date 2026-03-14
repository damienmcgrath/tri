import {
  ADAPTATION_META,
  DAY_STATE_LABELS,
  EVIDENCE_QUALITY_META,
  EXECUTION_RESULT_LABELS,
  REVIEW_OUTCOME_META,
  SESSION_INTENT_CATEGORIES,
  SESSION_LIFECYCLE_META,
  SESSION_LIFECYCLE_TONES,
  SESSION_SECONDARY_META,
  deriveSessionLifecycleState,
  getExecutionResultLabel,
  getSessionIntentLabel,
  getSessionLifecycleLabel,
  getSessionRoleLabel,
  normalizeReviewOutcomeState
} from "./semantics";

describe("training semantics", () => {
  it("exposes labels for canonical lifecycle and secondary states", () => {
    expect(getSessionLifecycleLabel("today")).toBe("Today");
    expect(SESSION_LIFECYCLE_META.missed.label).toBe("Missed");
    expect(SESSION_SECONDARY_META.unmatched_upload.label).toBe("Needs review");
  });

  it("derives lifecycle state from stored status, date, and extra-work flags", () => {
    expect(deriveSessionLifecycleState({ storedStatus: "completed", date: "2026-03-10", todayIso: "2026-03-11" })).toBe("completed");
    expect(deriveSessionLifecycleState({ storedStatus: "planned", date: "2026-03-11", todayIso: "2026-03-11" })).toBe("today");
    expect(deriveSessionLifecycleState({ storedStatus: "planned", date: "2026-03-10", todayIso: "2026-03-11" })).toBe("missed");
    expect(deriveSessionLifecycleState({ storedStatus: "planned", date: "2026-03-12", todayIso: "2026-03-11", isExtra: true })).toBe("extra");
  });

  it("normalizes review outcomes and exposes athlete-facing labels", () => {
    expect(normalizeReviewOutcomeState("matched_intent")).toBe("on_target");
    expect(normalizeReviewOutcomeState("partial")).toBe("partial_match");
    expect(REVIEW_OUTCOME_META.missed_intent.label).toBe("Missed intent");
    expect(EVIDENCE_QUALITY_META.low.label).toBe("Low");
    expect(ADAPTATION_META.pending_decision.label).toBe("Decision pending");
  });

  it("exposes day, role, and intent labels", () => {
    expect(DAY_STATE_LABELS.needs_attention).toBe("Needs attention");
    expect(getSessionRoleLabel("supporting")).toBe("Supporting");
    expect(getSessionIntentLabel("z2_endurance")).toBe("Z2 endurance");
    expect(SESSION_INTENT_CATEGORIES).toContain("technique_swim");
  });

  it("keeps execution labels and lifecycle tones available", () => {
    expect(getExecutionResultLabel("partial_intent")).toBe("Partial intent");
    expect(EXECUTION_RESULT_LABELS.missed_intent).toBe("Missed intent");
    expect(SESSION_LIFECYCLE_TONES.extra).toBe("info");
  });
});
