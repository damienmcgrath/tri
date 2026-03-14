/**
 * Shared product vocabulary for planning, execution, review, and adaptation.
 *
 * This file is the single source of truth for state names, labels, tones, and
 * icon semantics across Dashboard, Plan, Calendar, Coach, and Session Review.
 */

export type StateTone = "neutral" | "success" | "warning" | "attention" | "info";

export const SESSION_STORED_STATES = ["planned", "completed", "skipped"] as const;

export type SessionStoredState = (typeof SESSION_STORED_STATES)[number];

export const SESSION_LIFECYCLE_STATES = ["planned", "today", "completed", "skipped", "missed", "extra"] as const;

export type SessionLifecycleState = (typeof SESSION_LIFECYCLE_STATES)[number];

export const SESSION_SECONDARY_STATES = ["moved", "assigned_from_upload", "unmatched_upload"] as const;

export type SessionSecondaryState = (typeof SESSION_SECONDARY_STATES)[number];

export const REVIEW_OUTCOME_STATES = ["unreviewed", "on_target", "partial_match", "missed_intent"] as const;

export type ReviewOutcomeState = (typeof REVIEW_OUTCOME_STATES)[number];

export const WEEK_RISK_STATES = ["on_track", "watch", "at_risk"] as const;

export type WeekRiskState = (typeof WEEK_RISK_STATES)[number];

export const ADAPTATION_STATES = ["none", "suggested", "pending_decision", "resolved"] as const;

export type AdaptationState = (typeof ADAPTATION_STATES)[number];

export const EVIDENCE_QUALITY_STATES = ["high", "medium", "low"] as const;

export type EvidenceQualityState = (typeof EVIDENCE_QUALITY_STATES)[number];

export const MISSING_EVIDENCE_REASONS = [
  "no_split_data",
  "no_interval_structure_match",
  "missing_target_zones",
  "summary_only_upload"
] as const;

export type MissingEvidenceReason = (typeof MISSING_EVIDENCE_REASONS)[number];

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

/**
 * Raw persisted execution-result status from legacy review payloads.
 * Keep this for backward compatibility while the UI uses review outcomes.
 */
export const EXECUTION_RESULT_STATES = ["matched_intent", "partial_intent", "missed_intent"] as const;

export type ExecutionResultState = (typeof EXECUTION_RESULT_STATES)[number];

type StateDisplayMeta = {
  label: string;
  tone: StateTone;
  icon: string;
};

export const SESSION_LIFECYCLE_META: Record<SessionLifecycleState, StateDisplayMeta> = {
  planned: { label: "Planned", tone: "neutral", icon: "◌" },
  today: { label: "Today", tone: "info", icon: "◔" },
  completed: { label: "Completed", tone: "success", icon: "✓" },
  skipped: { label: "Skipped", tone: "warning", icon: "—" },
  missed: { label: "Missed", tone: "attention", icon: "!" },
  extra: { label: "Extra", tone: "info", icon: "+" }
};

export const SESSION_SECONDARY_META: Record<SessionSecondaryState, StateDisplayMeta> = {
  moved: { label: "Moved", tone: "info", icon: "↔" },
  assigned_from_upload: { label: "Matched upload", tone: "success", icon: "↳" },
  unmatched_upload: { label: "Needs review", tone: "attention", icon: "?" }
};

export const REVIEW_OUTCOME_META: Record<ReviewOutcomeState, StateDisplayMeta> = {
  unreviewed: { label: "Unreviewed", tone: "neutral", icon: "○" },
  on_target: { label: "On target", tone: "success", icon: "✓" },
  partial_match: { label: "Partial match", tone: "warning", icon: "△" },
  missed_intent: { label: "Missed intent", tone: "attention", icon: "!" }
};

export const WEEK_RISK_META: Record<WeekRiskState, StateDisplayMeta> = {
  on_track: { label: "On track", tone: "success", icon: "●" },
  watch: { label: "Watch", tone: "warning", icon: "◐" },
  at_risk: { label: "At risk", tone: "attention", icon: "▲" }
};

export const ADAPTATION_META: Record<AdaptationState, StateDisplayMeta> = {
  none: { label: "No changes needed", tone: "neutral", icon: "○" },
  suggested: { label: "Adjustment suggested", tone: "warning", icon: "◒" },
  pending_decision: { label: "Decision pending", tone: "info", icon: "◔" },
  resolved: { label: "Decision logged", tone: "success", icon: "✓" }
};

export const EVIDENCE_QUALITY_META: Record<EvidenceQualityState, StateDisplayMeta> = {
  high: { label: "High", tone: "success", icon: "●" },
  medium: { label: "Medium", tone: "warning", icon: "◐" },
  low: { label: "Low", tone: "attention", icon: "○" }
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

export const MISSING_EVIDENCE_LABELS: Record<MissingEvidenceReason, string> = {
  no_split_data: "No split data",
  no_interval_structure_match: "No interval structure match",
  missing_target_zones: "Missing target zones",
  summary_only_upload: "Summary-only upload"
};

export const SESSION_LIFECYCLE_TONES: Record<SessionLifecycleState, StateTone> = Object.fromEntries(
  SESSION_LIFECYCLE_STATES.map((state) => [state, SESSION_LIFECYCLE_META[state].tone])
) as Record<SessionLifecycleState, StateTone>;

export const DAY_STATE_TONES: Record<DayState, StateTone> = {
  today: "info",
  planned: "neutral",
  complete: "success",
  rest_day: "neutral",
  available: "info",
  open_capacity: "warning",
  needs_attention: "attention"
};

export function deriveSessionLifecycleState(params: {
  storedStatus?: SessionStoredState | null;
  date?: string | null;
  todayIso: string;
  isExtra?: boolean;
}): SessionLifecycleState {
  const { storedStatus, date, todayIso, isExtra } = params;

  if (isExtra) return "extra";
  if (storedStatus === "completed") return "completed";
  if (storedStatus === "skipped") return "skipped";
  if (!date) return "planned";
  if (date < todayIso) return "missed";
  if (date === todayIso) return "today";
  return "planned";
}

export function normalizeReviewOutcomeState(value: unknown): ReviewOutcomeState {
  if (value === "on_target" || value === "matched_intent" || value === "matched") return "on_target";
  if (value === "partial_match" || value === "partial_intent" || value === "partial") return "partial_match";
  if (value === "missed_intent" || value === "missed") return "missed_intent";
  return "unreviewed";
}

export function getSessionLifecycleLabel(state: SessionLifecycleState) {
  return SESSION_LIFECYCLE_META[state].label;
}

export function getSessionSecondaryLabel(state: SessionSecondaryState) {
  return SESSION_SECONDARY_META[state].label;
}

export function getReviewOutcomeLabel(state: ReviewOutcomeState) {
  return REVIEW_OUTCOME_META[state].label;
}

export function getWeekRiskLabel(state: WeekRiskState) {
  return WEEK_RISK_META[state].label;
}

export function getAdaptationLabel(state: AdaptationState) {
  return ADAPTATION_META[state].label;
}

export function getEvidenceQualityLabel(state: EvidenceQualityState) {
  return EVIDENCE_QUALITY_META[state].label;
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

export function getMissingEvidenceLabel(state: MissingEvidenceReason) {
  return MISSING_EVIDENCE_LABELS[state];
}
