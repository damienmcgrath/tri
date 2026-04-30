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

// ─── Race-scoped tools (Phase 2 — Interrogation Layer) ───────────────────

export const raceDisciplineEnum = z.enum(["swim", "bike", "run"]);

export const getRaceObjectArgsSchema = z.object({}).strict();
export const getRaceSegmentMetricsArgsSchema = z.object({
  role: raceDisciplineEnum
}).strict();
export const getPriorRacesForComparisonArgsSchema = z.object({
  sameDistanceOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(10).default(5)
}).strict();
export const getBestComparableTrainingForSegmentArgsSchema = z.object({
  role: raceDisciplineEnum
}).strict();
export const getAthleteThresholdsArgsSchema = z.object({}).strict();

const paceAtTargetArgsSchema = z.object({
  kind: z.literal("pace_at_target"),
  role: raceDisciplineEnum,
  target: z.object({
    type: z.enum(["hr", "power"]),
    value: z.number().positive()
  })
});
const runOffBikeArgsSchema = z.object({
  kind: z.literal("run_off_bike_at_if"),
  bikeIF: z.number().min(0.4).max(1.2)
});
const sustainableLoadArgsSchema = z.object({
  kind: z.literal("sustainable_load"),
  preRaceTsbState: z.enum(["fresh", "absorbing", "fatigued", "overreaching"]).optional()
});

export const getWhatIfScenarioArgsSchema = z.discriminatedUnion("kind", [
  paceAtTargetArgsSchema,
  runOffBikeArgsSchema,
  sustainableLoadArgsSchema
]);

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
  create_plan_change_proposal: createPlanChangeProposalArgsSchema,
  get_race_object: getRaceObjectArgsSchema,
  get_race_segment_metrics: getRaceSegmentMetricsArgsSchema,
  get_prior_races_for_comparison: getPriorRacesForComparisonArgsSchema,
  get_best_comparable_training_for_segment: getBestComparableTrainingForSegmentArgsSchema,
  get_athlete_thresholds: getAthleteThresholdsArgsSchema,
  get_what_if_scenario: getWhatIfScenarioArgsSchema
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
  },
  {
    type: "function" as const,
    name: "get_race_object",
    description: "RACE MODE ONLY. Return the full race object (verdict, race story, segment diagnostics, transitions, lessons, pre-race state, subjective inputs). The conversation's race scope determines which race is returned — no bundleId argument.",
    strict: false,
    parameters: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    type: "function" as const,
    name: "get_race_segment_metrics",
    description: "RACE MODE ONLY. Return lap-level metrics (HR, power, pace) for one discipline of the scoped race.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["role"],
      properties: { role: { type: "string", enum: ["swim", "bike", "run"] } }
    }
  },
  {
    type: "function" as const,
    name: "get_prior_races_for_comparison",
    description: "RACE MODE ONLY. Return prior race bundles for this athlete (newest first) with verdict + leg status. Defaults to same-distance only.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sameDistanceOnly: { type: "boolean" },
        limit: { type: "number", minimum: 1, maximum: 10 }
      }
    }
  },
  {
    type: "function" as const,
    name: "get_best_comparable_training_for_segment",
    description: "RACE MODE ONLY. Return the deterministic best-comparable training session for a discipline of the scoped race (already pre-computed in segment_diagnostics) plus that activity's metrics.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["role"],
      properties: { role: { type: "string", enum: ["swim", "bike", "run"] } }
    }
  },
  {
    type: "function" as const,
    name: "get_athlete_thresholds",
    description: "Return the athlete's explicit thresholds (FTP, threshold HR, run threshold pace, swim CSS) sourced from athlete context — used for IF / pace math in race-mode answers.",
    strict: false,
    parameters: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    type: "function" as const,
    name: "get_what_if_scenario",
    description: "RACE MODE ONLY. Run a deterministic what-if sketch grounded in the athlete's own training history. Output is a scenario sketch, not a precise prediction; you MUST hedge and cite the basedOn entries. Three kinds: pace_at_target (given role + target HR/power, return historical pace at that intensity), run_off_bike_at_if (given a bike IF, return run-off-bike pace from comparable bricks), sustainable_load (return pre-race CTL from prior races where the athlete arrived fresh and rated the experience 4+).",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["pace_at_target", "run_off_bike_at_if", "sustainable_load"] },
        role: { type: "string", enum: ["swim", "bike", "run"] },
        target: {
          type: "object",
          additionalProperties: false,
          required: ["type", "value"],
          properties: {
            type: { type: "string", enum: ["hr", "power"] },
            value: { type: "number", minimum: 1 }
          }
        },
        bikeIF: { type: "number", minimum: 0.4, maximum: 1.2 },
        preRaceTsbState: { type: "string", enum: ["fresh", "absorbing", "fatigued", "overreaching"] }
      }
    }
  }
];

export type CoachToolName = keyof typeof coachToolSchemas;

/** Tools that only make sense when the conversation is race-scoped. */
export const RACE_SCOPED_TOOLS: ReadonlySet<CoachToolName> = new Set([
  "get_race_object",
  "get_race_segment_metrics",
  "get_prior_races_for_comparison",
  "get_best_comparable_training_for_segment",
  "get_what_if_scenario"
]);
