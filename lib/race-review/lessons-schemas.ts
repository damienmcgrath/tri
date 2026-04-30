/**
 * Schemas for AI Layer 4 — Lessons.
 *
 * Three artifacts persisted in race_lessons:
 *
 *   athleteProfileTakeaways — 1–3 generalisable patterns about the athlete
 *     as a racer. Confidence reflects how many prior races back the claim:
 *     low (this race only), medium (1 prior), high (2+ priors).
 *
 *   trainingImplications — 1–3 concrete numbered changes for the next
 *     training block, each tied back to a finding via `rationale`.
 *
 *   carryForward — single portable insight surfaced during next race-week
 *     prep. Must contain a number + success criterion. Written as if
 *     speaking to the athlete on race morning.
 */

import { z } from "zod";

export const TAKEAWAY_CONFIDENCE_LABELS = ["low", "medium", "high"] as const;
export const IMPLICATION_PRIORITY_LABELS = ["high", "medium", "low"] as const;

export const takeawayConfidenceEnum = z.enum(TAKEAWAY_CONFIDENCE_LABELS);
export const implicationPriorityEnum = z.enum(IMPLICATION_PRIORITY_LABELS);

export const athleteProfileTakeawaySchema = z.object({
  /** ≤140 chars — the pattern, not the finding. */
  headline: z.string().min(1).max(140),
  /** ≤500 chars — supporting body, must cite numbers. */
  body: z.string().min(1).max(500),
  confidence: takeawayConfidenceEnum,
  /** Number of prior races the takeaway references (0 = this race only). */
  referencesCount: z.number().int().nonnegative()
});

export const trainingImplicationSchema = z.object({
  /** ≤140 chars — the change, written as a directive. */
  headline: z.string().min(1).max(140),
  /** ≤500 chars — what to do. Must contain a specific number. */
  change: z.string().min(1).max(500),
  priority: implicationPriorityEnum,
  /** ≤220 chars — link back to a finding from this race. */
  rationale: z.string().min(1).max(220)
});

export const carryForwardSchema = z.object({
  /** ≤120 chars — one-liner the athlete sees first. */
  headline: z.string().min(1).max(120),
  /** ≤320 chars — actionable on race morning. Must contain a digit. */
  instruction: z.string().min(1).max(320),
  /** ≤220 chars — what success looks like. */
  successCriterion: z.string().min(1).max(220),
  /**
   * The race bundle that produced this insight; surfaced as
   * "Carry-forward from {{race}}" until consumed by the next race.
   */
  expiresAfterRaceId: z.string()
});

export const raceLessonsSchema = z.object({
  athleteProfileTakeaways: z.array(athleteProfileTakeawaySchema).min(1).max(3),
  trainingImplications: z.array(trainingImplicationSchema).min(1).max(3),
  carryForward: carryForwardSchema.nullable()
});

/**
 * AI-side response shape. The AI does NOT pick `confidence`,
 * `referencesCount`, or `expiresAfterRaceId` — the orchestrator overrides
 * them deterministically before persistence. The model is prompted with
 * permissible tokens for `confidence` and `priority` so we can validate
 * shape, but the values are clobbered upstream.
 */
export const raceLessonsAiSchema = raceLessonsSchema;

export type AthleteProfileTakeaway = z.infer<typeof athleteProfileTakeawaySchema>;
export type TrainingImplication = z.infer<typeof trainingImplicationSchema>;
export type CarryForward = z.infer<typeof carryForwardSchema>;
export type RaceLessons = z.infer<typeof raceLessonsSchema>;
