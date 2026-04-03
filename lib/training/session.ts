import { getDisciplineMeta } from "@/lib/ui/discipline";
import { getSessionRoleLabel, type ExecutionResultState, type SessionRoleState } from "@/lib/training/semantics";

export type SessionSourceMetadata = {
  uploadId?: string | null;
  assignmentId?: string | null;
  assignedBy?: "planner" | "upload" | "coach" | null;
};

export type SessionExecutionResult = {
  status?: ExecutionResultState | null;
  summary?: string | null;
};

export type SessionModelInput = {
  sessionName?: string | null;
  discipline?: string | null;
  sport?: string | null;
  subtype?: string | null;
  workoutType?: string | null;
  type?: string | null;
  durationMinutes?: number | null;
  duration_minutes?: number | null;
  intentCategory?: string | null;
  intent_category?: string | null;
  role?: SessionRoleState | "Key" | "Supporting" | "Recovery" | "Optional" | null;
  session_role?: SessionRoleState | "Key" | "Supporting" | "Recovery" | "Optional" | null;
  is_key?: boolean | null;
  source?: SessionSourceMetadata | null;
  sourceMetadata?: SessionSourceMetadata | null;
  executionResult?: SessionExecutionResult | null;
  execution_result?: SessionExecutionResult | null;
};

export type EnrichedSessionModel = {
  sessionName: string | null;
  discipline: string;
  subtype: string | null;
  workoutType: string | null;
  durationMinutes: number;
  intentCategory: string | null;
  role: SessionRoleState | null;
  source: SessionSourceMetadata | null;
  executionResult: SessionExecutionResult | null;
};

const GENERIC_SESSION_NAMES = new Set(["session", "workout", "training", "training session"]);

function isWeakFallbackName(name: string, disciplineLabel: string) {
  const normalized = name.trim().toLowerCase();
  if (GENERIC_SESSION_NAMES.has(normalized)) return true;

  const normalizedDiscipline = disciplineLabel.toLowerCase();
  if (normalized === `session ${normalizedDiscipline}` || normalized === `${normalizedDiscipline} session`) {
    return true;
  }

  return /^(session|workout|training)\s+(run|bike|swim|strength)$/.test(normalized);
}

function normalizeSessionRole(role: SessionModelInput["role"]): SessionRoleState | null {
  if (!role) return null;
  const normalized = role.toString().trim().toLowerCase();
  if (normalized === "key" || normalized === "supporting" || normalized === "recovery" || normalized === "optional") {
    return normalized;
  }
  return null;
}

function cleanValue(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeSessionModel(input: SessionModelInput): EnrichedSessionModel {
  return {
    sessionName: cleanValue(input.sessionName),
    discipline: cleanValue(input.discipline) ?? cleanValue(input.sport) ?? "other",
    subtype: cleanValue(input.subtype) ?? cleanValue(input.workoutType) ?? cleanValue(input.type),
    workoutType: cleanValue(input.workoutType) ?? cleanValue(input.subtype) ?? cleanValue(input.type),
    durationMinutes: Math.max(0, input.durationMinutes ?? input.duration_minutes ?? 0),
    intentCategory: cleanValue(input.intentCategory) ?? cleanValue(input.intent_category),
    role: normalizeSessionRole(input.role ?? input.session_role ?? (input.is_key ? "key" : null)),
    source: input.source ?? input.sourceMetadata ?? null,
    executionResult: input.executionResult ?? input.execution_result ?? null
  };
}

export function getSessionDisplayName(input: SessionModelInput) {
  const session = normalizeSessionModel(input);
  const disciplineLabel = getDisciplineMeta(session.discipline).label;

  const explicit = cleanValue(session.sessionName);
  if (explicit && !isWeakFallbackName(explicit, disciplineLabel)) {
    return explicit;
  }

  const subtype = cleanValue(session.subtype);
  if (subtype && !isWeakFallbackName(subtype, disciplineLabel)) {
    const subtypeLower = subtype.toLowerCase();
    if (subtypeLower.includes(disciplineLabel.toLowerCase())) {
      return subtype;
    }
    return `${subtype} ${disciplineLabel}`;
  }

  if (disciplineLabel === "Bike") return "Bike";
  if (disciplineLabel === "Run") return "Run";
  if (disciplineLabel === "Swim") return "Swim";
  if (disciplineLabel === "Strength") return "Strength";
  return disciplineLabel;
}

export function getOptionalSessionRoleLabel(input: SessionModelInput) {
  const role = normalizeSessionModel(input).role;
  return role ? getSessionRoleLabel(role) : null;
}
