import { z } from "zod";

export const getAthleteSnapshotArgsSchema = z.object({}).strict();
export const getRecentSessionsArgsSchema = z.object({ daysBack: z.number().int().min(1).max(60).default(14) }).strict();
export const getUpcomingSessionsArgsSchema = z.object({ daysAhead: z.number().int().min(1).max(30).default(7) }).strict();
export const getWeekProgressArgsSchema = z.object({}).strict();
export const getWeeklyBriefArgsSchema = z.object({}).strict();
export const getActivityDetailsArgsSchema = z.object({ activityId: z.string().uuid() }).strict();
export const getTrainingLoadArgsSchema = z.object({}).strict();

export const createPlanChangeProposalArgsSchema = z.object({
  title: z.string().trim().min(3).max(160),
  rationale: z.string().trim().min(5).max(1000),
  targetSessionId: z.string().uuid().optional(),
  proposedDate: z.string().date().optional(),
  proposedDurationMinutes: z.number().int().min(10).max(480).optional(),
  changeSummary: z.string().trim().min(5).max(1000)
}).strict();

export const suggestAlternativeWorkoutArgsSchema = z.object({
  targetSessionId: z.string().uuid().describe("The session to suggest an alternative for"),
  availableMinutes: z.number().int().min(10).max(480).optional().describe("Minutes available"),
  reason: z.string().trim().min(3).max(200).optional().describe("Why the alternative is needed"),
}).strict();

export const saveCoachNoteArgsSchema = z.object({
  patternKey: z.string().trim().min(3).max(80).describe("A short unique key for this observation, e.g. 'prefers-morning-runs'"),
  label: z.string().trim().min(3).max(120).describe("Short human-readable label"),
  detail: z.string().trim().min(5).max(500).describe("Full observation detail"),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  sourceSessionId: z.string().uuid().optional().describe("Session that prompted this observation"),
}).strict();

export const coachToolSchemas = {
  get_athlete_snapshot: getAthleteSnapshotArgsSchema,
  get_recent_sessions: getRecentSessionsArgsSchema,
  get_upcoming_sessions: getUpcomingSessionsArgsSchema,
  get_week_progress: getWeekProgressArgsSchema,
  get_weekly_brief: getWeeklyBriefArgsSchema,
  get_activity_details: getActivityDetailsArgsSchema,
  get_training_load: getTrainingLoadArgsSchema,
  create_plan_change_proposal: createPlanChangeProposalArgsSchema,
  suggest_alternative_workout: suggestAlternativeWorkoutArgsSchema,
  save_coach_note: saveCoachNoteArgsSchema
} as const;

export const coachTools = [
  {
    type: "function" as const,
    name: "get_athlete_snapshot",
    description: "Return high-level athlete profile and current training-plan snapshot.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: "function" as const,
    name: "get_recent_sessions",
    description: "Return recent completed sessions and recently planned sessions for coaching context.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        daysBack: { type: "number", minimum: 1, maximum: 60 }
      }
    }
  },
  {
    type: "function" as const,
    name: "get_upcoming_sessions",
    description: "Return upcoming planned sessions.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        daysAhead: { type: "number", minimum: 1, maximum: 30 }
      }
    }
  },
  {
    type: "function" as const,
    name: "get_week_progress",
    description: "Return this week's planned vs completed volume summary.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: "function" as const,
    name: "get_weekly_brief",
    description: "Return the persisted weekly execution briefing and athlete-context cue for the current week.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: "function" as const,
    name: "get_activity_details",
    description: "Return explicit source-backed metrics for one uploaded activity.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["activityId"],
      properties: {
        activityId: { type: "string", format: "uuid" }
      }
    }
  },
  {
    type: "function" as const,
    name: "get_training_load",
    description: "Return the athlete's current fitness state: CTL/ATL/TSB (total + per-discipline), readiness state, discipline balance, ramp rate, and fatigue signals.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  },
  {
    type: "function" as const,
    name: "create_plan_change_proposal",
    description: "Create a proposal record for plan changes. Never edits sessions directly.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "rationale", "changeSummary"],
      properties: {
        title: { type: "string", minLength: 3, maxLength: 160 },
        rationale: { type: "string", minLength: 5, maxLength: 1000 },
        targetSessionId: { type: "string", format: "uuid" },
        proposedDate: { type: "string", format: "date" },
        proposedDurationMinutes: { type: "number", minimum: 10, maximum: 480 },
        changeSummary: { type: "string", minLength: 5, maxLength: 1000 }
      }
    }
  },
  {
    type: "function" as const,
    name: "suggest_alternative_workout",
    description: "Look up a planned session and generate a context-aware alternative workout suggestion. Use when the athlete cannot do the planned workout as written.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["targetSessionId"],
      properties: {
        targetSessionId: { type: "string", format: "uuid" },
        availableMinutes: { type: "number", minimum: 10, maximum: 480 },
        reason: { type: "string", minLength: 3, maxLength: 200 }
      }
    }
  },
  {
    type: "function" as const,
    name: "save_coach_note",
    description: "Persist a coaching observation about the athlete's patterns, preferences, or tendencies. Notes are accumulated over time and influence future coaching context. Use when you notice a recurring pattern worth remembering.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["patternKey", "label", "detail"],
      properties: {
        patternKey: { type: "string", minLength: 3, maxLength: 80 },
        label: { type: "string", minLength: 3, maxLength: 120 },
        detail: { type: "string", minLength: 5, maxLength: 500 },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        sourceSessionId: { type: "string", format: "uuid" }
      }
    }
  }
];

export type CoachToolName = keyof typeof coachToolSchemas;
