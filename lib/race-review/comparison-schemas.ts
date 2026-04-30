/**
 * Phase 3.1 — Race-to-Race Comparison schemas.
 *
 * Side-by-side view of two races: the "this" race and a prior race of
 * compatible distance. Per-leg deltas, finish-time delta, IF/NP/pace deltas,
 * pre-race state delta. The AI produces a progression narrative on top.
 *
 * Persisted in race_comparisons (one row per (race_bundle_id, prior_bundle_id)).
 */

import { z } from "zod";

export const raceLiteSchema = z.object({
  bundleId: z.string().uuid(),
  raceProfileId: z.string().uuid().nullable(),
  name: z.string().nullable(),
  date: z.string(),
  distanceType: z.string().nullable(),
  finishSec: z.number().nonnegative(),
  goalSec: z.number().nullable()
});

export const legDeltaSchema = z.object({
  /** Negative = improved (faster on 'this' than prior). */
  durationDeltaSec: z.number(),
  /** Bike NP delta (this − prior). */
  npDelta: z.number().nullable(),
  /** Avg pace delta sec/100m for swim, sec/km for run. Negative = faster. */
  paceDelta: z.number().nullable(),
  avgHrDelta: z.number().nullable(),
  /** This race's leg duration (anchor for percent calc on the UI). */
  thisDurationSec: z.number().nonnegative(),
  priorDurationSec: z.number().nonnegative()
});

export const transitionsDeltaSchema = z.object({
  t1Sec: z.number().nullable(),
  t2Sec: z.number().nullable()
});

export const preRaceStateDeltaSchema = z.object({
  ctl: z.number().nullable(),
  atl: z.number().nullable(),
  tsb: z.number().nullable(),
  taperCompliance: z.number().nullable()
});

export const comparisonPayloadSchema = z.object({
  thisRace: raceLiteSchema,
  priorRace: raceLiteSchema,
  finishDeltaSec: z.number(),
  perLeg: z.object({
    swim: legDeltaSchema.nullable(),
    bike: legDeltaSchema.nullable(),
    run: legDeltaSchema.nullable()
  }),
  transitionsDelta: transitionsDeltaSchema,
  preRaceStateDelta: preRaceStateDeltaSchema
});

export const progressionNarrativeSchema = z.object({
  /** ≤140 chars — opening line citing finish delta. */
  headline: z.string().min(1).max(140),
  /** Per-discipline progression sentence — null when no leg data. */
  perDiscipline: z.object({
    swim: z.string().nullable(),
    bike: z.string().nullable(),
    run: z.string().nullable()
  }),
  /** ≤220 chars — single-sentence net summary. */
  netDelta: z.string().min(1).max(280),
  /** Up to 3 cross-leg themes ("bike pacing more disciplined", "swim consistency held"). */
  emergedThemes: z.array(z.string().min(1).max(160)).max(3)
});

export type RaceLite = z.infer<typeof raceLiteSchema>;
export type LegDelta = z.infer<typeof legDeltaSchema>;
export type TransitionsDelta = z.infer<typeof transitionsDeltaSchema>;
export type PreRaceStateDelta = z.infer<typeof preRaceStateDeltaSchema>;
export type ComparisonPayload = z.infer<typeof comparisonPayloadSchema>;
export type ProgressionNarrative = z.infer<typeof progressionNarrativeSchema>;
