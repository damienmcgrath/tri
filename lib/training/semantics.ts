/**
 * Shared product vocabulary for planning and execution states.
 *
 * Keep page-level view models aligned by importing these types and helper
 * functions instead of redefining local string unions.
 */

export const SESSION_LIFECYCLE_STATES = [
  "planned",
  "completed",
  "skipped",
  "moved",
  "extra",
  "assigned_from_upload",
  "unmatched_upload"
] as const;

export type SessionLifecycleState = (typeof SESSION_LIFECYCLE_STATES)[number];

export const DAY_STATES = [
  "today",
  "planned",
  "complete",
  "rest_day",
  "available",
  "open_capacity",
  "needs_attention"
] as const;

export type DayState = (typeof DAY_STATES)[number];

export const SESSION_ROLE_STATES = ["key", "supporting", "recovery", "optional"] as const;

export type SessionRoleState = (typeof SESSION_ROLE_STATES)[number];

export const SESSION_INTENT_CATEGORIES = [
  "z2_endurance",
  "recovery",
  "threshold",
  "aerobic_swim",
  "technique_swim",
  "strength_maintenance",
  "long_endurance",
  "tempo",
  "intervals",
  "easy_run",
  "easy_bike",
  "endurance_ride",
  "endurance_swim"
] as const;

export type SessionIntentCategory = (typeof SESSION_INTENT_CATEGORIES)[number];

export const EXECUTION_RESULT_STATES = ["matched_intent", "partial_intent", "missed_intent"] as const;

export type ExecutionResultState = (typeof EXECUTION_RESULT_STATES)[number];

export const SESSION_LIFECYCLE_LABELS: Record<SessionLifecycleState, string> = {
  planned: "Planned",
  completed: "Completed",
  skipped: "Skipped",
  moved: "Moved",
  extra: "Extra",
  assigned_from_upload: "Assigned from upload",
  unmatched_upload: "Unmatched upload"
};

export const DAY_STATE_LABELS: Record<DayState, string> = {
  today: "Today",
  planned: "Planned",
  complete: "Complete",
  rest_day: "Rest day",
  available: "Available",
  open_capacity: "Open capacity",
  needs_attention: "Needs attention"
};

export const SESSION_ROLE_LABELS: Record<SessionRoleState, string> = {
  key: "Key",
  supporting: "Supporting",
  recovery: "Recovery",
  optional: "Optional"
};

export const SESSION_INTENT_LABELS: Record<SessionIntentCategory, string> = {
  z2_endurance: "Z2 endurance",
  recovery: "Recovery",
  threshold: "Threshold",
  aerobic_swim: "Aerobic swim",
  technique_swim: "Technique swim",
  strength_maintenance: "Strength maintenance",
  long_endurance: "Long endurance",
  tempo: "Tempo",
  intervals: "Intervals",
  easy_run: "Easy run",
  easy_bike: "Easy bike",
  endurance_ride: "Endurance ride",
  endurance_swim: "Endurance swim"
};

export const EXECUTION_RESULT_LABELS: Record<ExecutionResultState, string> = {
  matched_intent: "Matched intent",
  partial_intent: "Partial intent",
  missed_intent: "Missed intent"
};

export type StateTone = "neutral" | "success" | "warning" | "attention" | "info";

export const SESSION_LIFECYCLE_TONES: Record<SessionLifecycleState, StateTone> = {
  planned: "neutral",
  completed: "success",
  skipped: "warning",
  moved: "info",
  extra: "info",
  assigned_from_upload: "success",
  unmatched_upload: "attention"
};

export const DAY_STATE_TONES: Record<DayState, StateTone> = {
  today: "info",
  planned: "neutral",
  complete: "success",
  rest_day: "neutral",
  available: "info",
  open_capacity: "warning",
  needs_attention: "attention"
};

export function getSessionLifecycleLabel(state: SessionLifecycleState) {
  return SESSION_LIFECYCLE_LABELS[state];
}

export function getDayStateLabel(state: DayState) {
  return DAY_STATE_LABELS[state];
}

export function getSessionRoleLabel(state: SessionRoleState) {
  return SESSION_ROLE_LABELS[state];
}

export function getSessionIntentLabel(state: SessionIntentCategory) {
  return SESSION_INTENT_LABELS[state];
}

export function getExecutionResultLabel(state: ExecutionResultState) {
  return EXECUTION_RESULT_LABELS[state];
}
