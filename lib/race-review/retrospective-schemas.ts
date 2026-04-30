/**
 * Phase 3.3 — Pre-race Retrospective schemas.
 *
 * After a race, look back at the build cycle and assess: did the
 * periodisation actually work? CTL trajectory vs target, taper compliance,
 * key-session execution rate. Feed back into the next periodisation pass.
 *
 * Persisted on race_reviews.pre_race_retrospective.
 */

import { z } from "zod";

export const ctlTrajectoryPointSchema = z.object({
  date: z.string(),
  ctl: z.number(),
  atl: z.number(),
  tsb: z.number()
});

export const ctlTrajectorySchema = z.object({
  /** "total" — cross-discipline. We default to total; per-sport can come later. */
  sport: z.literal("total"),
  series: z.array(ctlTrajectoryPointSchema),
  peakCtl: z.number(),
  peakCtlDate: z.string(),
  /** From race_profiles if set, otherwise null. Future-only column. */
  targetPeakCtl: z.number().nullable(),
  daysFromPeakToRace: z.number().int(),
  /** CTL on race morning (mirrors bundle.pre_race_ctl). */
  raceMorningCtl: z.number().nullable()
});

export const taperReadOutSchema = z.object({
  /** mirrors bundle.taper_compliance_score (0..1). */
  complianceScore: z.number().nullable(),
  /** mirrors bundle.taper_compliance_summary. */
  summary: z.string().nullable()
});

export const keySessionExecutionEntrySchema = z.object({
  sessionId: z.string().uuid(),
  date: z.string(),
  name: z.string().min(1).max(200),
  executed: z.boolean(),
  /** intentMatch.score equivalent: 1 = on_target, 0.5 = partial, 0 = missed. */
  executionScore: z.number().nullable()
});

export const keySessionExecutionRateSchema = z.object({
  totalKeySessions: z.number().int().nonnegative(),
  completedKeySessions: z.number().int().nonnegative(),
  rate: z.number().min(0).max(1),
  keySessionsList: z.array(keySessionExecutionEntrySchema).max(20)
});

export const retrospectiveVerdictSchema = z.object({
  /** ≤120 chars. */
  headline: z.string().min(1).max(140),
  /** ≤500 chars. */
  body: z.string().min(1).max(600),
  /** ≤220 chars. Must be actionable on the NEXT build, not this race. */
  actionableAdjustment: z.string().min(1).max(280)
});

export const preRaceRetrospectiveSchema = z.object({
  buildWindowDays: z.number().int().positive(),
  ctlTrajectory: ctlTrajectorySchema,
  taperReadOut: taperReadOutSchema,
  keySessionExecutionRate: keySessionExecutionRateSchema,
  verdict: retrospectiveVerdictSchema,
  source: z.enum(["ai", "fallback"]),
  generatedAt: z.string()
});

/** AI-side schema — only the verdict; the rest is deterministic. */
export const retrospectiveAiSchema = retrospectiveVerdictSchema;

export type CtlTrajectoryPoint = z.infer<typeof ctlTrajectoryPointSchema>;
export type CtlTrajectory = z.infer<typeof ctlTrajectorySchema>;
export type TaperReadOut = z.infer<typeof taperReadOutSchema>;
export type KeySessionExecutionEntry = z.infer<typeof keySessionExecutionEntrySchema>;
export type KeySessionExecutionRate = z.infer<typeof keySessionExecutionRateSchema>;
export type RetrospectiveVerdict = z.infer<typeof retrospectiveVerdictSchema>;
export type PreRaceRetrospective = z.infer<typeof preRaceRetrospectiveSchema>;
