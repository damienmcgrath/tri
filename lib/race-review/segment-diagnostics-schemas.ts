/**
 * Schemas for AI Layer 3 — per-segment diagnostic.
 *
 * The AI produces narratives ONLY. Every reference frame, gate, and
 * threshold comparison is computed deterministically upstream in
 * buildSegmentDiagnostics. The model's job is wording, not invention.
 */

import { z } from "zod";

const referenceFrameVsPlanSchema = z
  .object({
    label: z.enum(["on_plan", "under", "over"]),
    deltaPct: z.number(),
    summary: z.string().min(1).max(220)
  })
  .nullable();

const referenceFrameVsThresholdSchema = z
  .object({
    thresholdValue: z.number(),
    thresholdUnit: z.enum(["watts", "sec_per_km", "sec_per_100m"]),
    intensityFactor: z.number(),
    summary: z.string().min(1).max(220)
  })
  .nullable();

const referenceFrameVsBestComparableTrainingSchema = z
  .object({
    sessionId: z.string(),
    sessionDate: z.string(),
    sessionName: z.string(),
    comparison: z.string().min(1).max(220)
  })
  .nullable();

const referenceFrameVsPriorRaceSchema = z
  .object({
    bundleId: z.string(),
    raceName: z.string(),
    raceDate: z.string(),
    comparison: z.string().min(1).max(220)
  })
  .nullable();

export const pacingAnalysisSchema = z.object({
  splitType: z.enum(["even", "positive", "negative"]).nullable(),
  driftObservation: z.string().min(1).max(220).nullable(),
  decouplingObservation: z.string().min(1).max(220).nullable()
});

export const anomalySchema = z.object({
  type: z.enum(["hr_spike", "power_dropout", "pace_break", "cadence_drop"]),
  atSec: z.number().int().nonnegative(),
  observation: z.string().min(1).max(220)
});

export const segmentDiagnosticSchema = z.object({
  discipline: z.enum(["swim", "bike", "run"]),
  referenceFrames: z.object({
    vsPlan: referenceFrameVsPlanSchema,
    vsThreshold: referenceFrameVsThresholdSchema,
    vsBestComparableTraining: referenceFrameVsBestComparableTrainingSchema,
    vsPriorRace: referenceFrameVsPriorRaceSchema
  }),
  pacingAnalysis: pacingAnalysisSchema,
  anomalies: z.array(anomalySchema).max(3),
  /** AI narrative synthesis, ≤500 chars. May be null when no AI call ran. */
  aiNarrative: z.string().min(1).max(500).nullable()
});

export const segmentDiagnosticsSchema = z.array(segmentDiagnosticSchema);

export const transitionsAnalysisSchema = z
  .object({
    t1: z
      .object({
        athleteSec: z.number().int().nonnegative(),
        populationMedianSec: z.number().int().nonnegative().nullable(),
        hrAtEnd: z.number().int().nonnegative().nullable(),
        summary: z.string().min(1).max(220)
      })
      .nullable(),
    t2: z
      .object({
        athleteSec: z.number().int().nonnegative(),
        populationMedianSec: z.number().int().nonnegative().nullable(),
        hrAtEnd: z.number().int().nonnegative().nullable(),
        summary: z.string().min(1).max(220)
      })
      .nullable()
  })
  .nullable();

/**
 * AI narrative-only response. One synthesis paragraph per discipline. The
 * orchestrator merges these strings into the deterministic packet and
 * persists the combined object.
 */
export const segmentNarrativesSchema = z.object({
  swim: z.string().min(1).max(500).nullable(),
  bike: z.string().min(1).max(500).nullable(),
  run: z.string().min(1).max(500).nullable()
});

export type SegmentDiagnostic = z.infer<typeof segmentDiagnosticSchema>;
export type SegmentDiagnostics = z.infer<typeof segmentDiagnosticsSchema>;
export type TransitionsAnalysis = z.infer<typeof transitionsAnalysisSchema>;
export type SegmentNarratives = z.infer<typeof segmentNarrativesSchema>;
