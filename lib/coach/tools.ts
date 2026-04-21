import { z } from "zod";

export const getAthleteSnapshotArgsSchema = z.object({}).strict();
export const getRecentSessionsArgsSchema = z.object({ daysBack: z.number().int().min(1).max(60).default(14) }).strict();
export const getUpcomingSessionsArgsSchema = z.object({ daysAhead: z.number().int().min(1).max(30).default(7) }).strict();
export const getWeekProgressArgsSchema = z.object({}).strict();
export const getWeeklyBriefArgsSchema = z.object({}).strict();
export const getActivityDetailsArgsSchema = z.object({ activityId: z.string().uuid() }).strict();
export const getTrainingLoadArgsSchema = z.object({}).strict();
export const getBlockSummaryArgsSchema = z.object({ blockId: z.string().uuid().optional() }).strict();
export const getBlockComparisonArgsSchema = z.object({ blockId: z.string().uuid().optional() }).strict();

export const createPlanChangeProposalArgsSchema = z.object({
  title: z.string().trim().min(3).max(160),
  rationale: z.string().trim().min(5).max(1000),
  targetSessionId: z.string().uuid().optional(),
  proposedDate: z.string().date().optional(),
  proposedDurationMinutes: z.number().int().min(10).max(480).optional(),
  changeSummary: z.string().trim().min(5).max(1000)
}).strict();

export const coachToolSchemas = {
  get_athlete_snapshot: getAthleteSnapshotArgsSchema,
  get_recent_sessions: getRecentSessionsArgsSchema,
  get_upcoming_sessions: getUpcomingSessionsArgsSchema,
  get_week_progress: getWeekProgressArgsSchema,
  get_weekly_brief: getWeeklyBriefArgsSchema,
  get_activity_details: getActivityDetailsArgsSchema,
  get_training_load: getTrainingLoadArgsSchema,
  get_block_summary: getBlockSummaryArgsSchema,
  get_block_comparison: getBlockComparisonArgsSchema,
  create_plan_change_proposal: createPlanChangeProposalArgsSchema
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
    name: "get_block_summary",
    description: "Return planned/completed volume, completion %, key-session progress, and discipline mix for a training block. Defaults to the current block when blockId is omitted.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        blockId: { type: "string", format: "uuid" }
      }
    }
  },
  {
    type: "function" as const,
    name: "get_block_comparison",
    description: "Compare the given training block to the block immediately preceding it (by sort_order) in the same plan. Returns both summaries and per-metric deltas. Defaults to the current block when blockId is omitted.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        blockId: { type: "string", format: "uuid" }
      }
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
  }
];

export type CoachToolName = keyof typeof coachToolSchemas;
