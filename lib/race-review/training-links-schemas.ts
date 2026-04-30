/**
 * Phase 3.2 — Training-to-Race Linking schemas.
 *
 * For each race leg (swim/bike/run), surface the training sessions in the
 * 8-week build window that most closely mirror the race-day capability —
 * the sessions that *demonstrated* the athlete had it in them — plus a
 * separate list of sessions where the athlete attempted race-pace effort
 * but failed to hold it (warning signs missed).
 *
 * Every session reference is grounded in actual training data; if no session
 * meets the score floor, the per-leg array is empty rather than fabricated.
 *
 * The AI's only contribution is a single narrative paragraph — the picks
 * themselves are deterministic.
 */

import { z } from "zod";

export const matchedAxisEnum = z.enum(["np", "pace", "hr_at_power", "duration"]);
export type MatchedAxis = z.infer<typeof matchedAxisEnum>;

export const trainingLinkSchema = z.object({
  sessionId: z.string().uuid(),
  date: z.string(),
  sessionName: z.string().min(1).max(200),
  durationSec: z.number().nonnegative(),
  /** Why this session matched. */
  matchedAxis: matchedAxisEnum,
  matchScore: z.number().min(0).max(1),
  /** Compressed: only the metric that mirrors the race leg. */
  metricsV2: z.object({
    avgPower: z.number().nullable(),
    normalizedPower: z.number().nullable(),
    avgPace: z.number().nullable(),
    avgHr: z.number().nullable()
  }),
  /** ≤220 chars: "Your race bike NP of 167W matched your best 2hr brick from Vrhnika." */
  narrative: z.string().min(1).max(280)
});

export const warningLinkSchema = z.object({
  sessionId: z.string().uuid(),
  date: z.string(),
  sessionName: z.string().min(1).max(200),
  /** ≤280 chars — what the warning was. */
  observation: z.string().min(1).max(320)
});

export const trainingToRaceLinksSchema = z.object({
  /** The build window we considered. */
  windowWeeks: z.number().int().positive(),
  perLeg: z.object({
    swim: z.array(trainingLinkSchema).max(3),
    bike: z.array(trainingLinkSchema).max(3),
    run: z.array(trainingLinkSchema).max(3)
  }),
  warningsMissed: z.array(warningLinkSchema).max(3),
  /** AI Layer artifact — single paragraph verdict. Null if fallback. */
  aiNarrative: z.string().nullable(),
  /**
   * "fallback" when the AI call failed and we wrote a deterministic
   * single-sentence stub; "ai" otherwise. Persisted for telemetry.
   */
  source: z.enum(["ai", "fallback"]),
  generatedAt: z.string()
});

/** AI-side response shape (only the narrative; rest is deterministic). */
export const trainingLinksAiSchema = z.object({
  narrative: z.string().min(1).max(800)
});

export type TrainingLink = z.infer<typeof trainingLinkSchema>;
export type WarningLink = z.infer<typeof warningLinkSchema>;
export type TrainingToRaceLinks = z.infer<typeof trainingToRaceLinksSchema>;
export type TrainingLinksAi = z.infer<typeof trainingLinksAiSchema>;
