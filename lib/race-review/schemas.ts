import { z } from "zod";

export const LEG_STATUS_LABELS = [
  "on_plan",
  "strong",
  "under",
  "over",
  "faded",
  "cooked"
] as const;

export const legStatusEnum = z.enum(LEG_STATUS_LABELS);

const perDisciplineEntrySchema = z
  .object({
    status: legStatusEnum,
    summary: z.string().min(1).max(220)
  })
  .nullable();

export const verdictSchema = z.object({
  /** ≤160 chars, must reference at least one specific number — enforced by sanity check. */
  headline: z.string().min(1).max(160),
  perDiscipline: z.object({
    swim: perDisciplineEntrySchema,
    bike: perDisciplineEntrySchema,
    run: perDisciplineEntrySchema
  }),
  coachTake: z.object({
    target: z.string().min(1).max(140),
    scope: z.string().min(1).max(80),
    successCriterion: z.string().min(1).max(180),
    progression: z.string().min(1).max(180)
  }),
  /** Only present when emotional-frame trigger fired upstream. */
  emotionalFrame: z.string().min(1).max(280).nullable()
});

const perLegStorySchema = z
  .object({
    narrative: z.string().min(1).max(420),
    keyEvidence: z.array(z.string().min(1).max(180)).min(1).max(4)
  })
  .nullable();

export const raceStorySchema = z.object({
  overall: z.string().min(1).max(900),
  perLeg: z.object({
    swim: perLegStorySchema,
    bike: perLegStorySchema,
    run: perLegStorySchema
  }),
  transitions: z.string().min(1).max(280).nullable(),
  /** Null when legs are independent. The orchestrator forces null upstream. */
  crossDisciplineInsight: z.string().min(1).max(360).nullable()
});

/**
 * Combined Layer 1 + Layer 2 output. One round-trip keeps the p95 under the
 * 15s acceptance budget and avoids consistency drift between layers.
 */
export const raceReviewLayersSchema = z.object({
  verdict: verdictSchema,
  raceStory: raceStorySchema
});

export type Verdict = z.infer<typeof verdictSchema>;
export type RaceStory = z.infer<typeof raceStorySchema>;
export type RaceReviewLayers = z.infer<typeof raceReviewLayersSchema>;
