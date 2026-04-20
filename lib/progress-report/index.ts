import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProgressReportFacts, computeBlockBoundaries } from "./facts";
import { buildDeterministicNarrative } from "./deterministic";
import { generateProgressReportNarrative } from "./narrative";
import {
  persistProgressReport,
  getPersistedProgressReport,
  getLatestPersistedProgressReport,
  getProgressReportSourceUpdatedAt,
  getProgressReportReadiness,
  isProgressReportStale,
  PROGRESS_REPORT_MIN_CURRENT_ACTIVITIES,
  type ProgressReportReadiness
} from "./persistence";
import {
  progressReportFactsSchema,
  progressReportNarrativeSchema,
  progressReportArtifactSchema
} from "./types";
import type {
  ProgressReportArtifact,
  ProgressReportFacts,
  ProgressReportNarrative,
  ProgressReportRecord
} from "./types";

export { PROGRESS_REPORT_GENERATION_VERSION, progressReportFeedbackInputSchema } from "./types";

export type {
  ProgressReportFacts,
  ProgressReportNarrative,
  ProgressReportArtifact,
  ProgressReportDisciplineVerdict,
  ProgressReportFitnessPoint,
  ProgressReportPaceAtHr,
  ProgressReportDurability,
  ProgressReportPeak,
  ProgressReportFeedbackInput,
  ProgressReportRecord
} from "./types";

export {
  buildProgressReportFacts,
  computeBlockBoundaries
} from "./facts";

export { buildDeterministicNarrative } from "./deterministic";
export { generateProgressReportNarrative } from "./narrative";

export {
  persistProgressReport,
  getPersistedProgressReport,
  getLatestPersistedProgressReport,
  getProgressReportSourceUpdatedAt,
  getProgressReportReadiness,
  isProgressReportStale,
  saveProgressReportFeedback,
  PROGRESS_REPORT_EMPTY_SOURCE_UPDATED_AT,
  PROGRESS_REPORT_MIN_CURRENT_ACTIVITIES
} from "./persistence";

export type { ProgressReportReadiness } from "./persistence";

/**
 * Thrown by refreshProgressReport when the current block has fewer than
 * PROGRESS_REPORT_MIN_CURRENT_ACTIVITIES activities. Callers (pages, API
 * routes) should catch this and render an empty state without retrying.
 */
export class ProgressReportInsufficientDataError extends Error {
  readonly currentBlockActivityCount: number;
  constructor(currentBlockActivityCount: number) {
    super(
      `Progress report requires at least ${PROGRESS_REPORT_MIN_CURRENT_ACTIVITIES} ` +
        `activity in the current block; found ${currentBlockActivityCount}.`
    );
    this.name = "ProgressReportInsufficientDataError";
    this.currentBlockActivityCount = currentBlockActivityCount;
  }
}

// ---------------------------------------------------------------------------
// Snapshot: a single high-level loader that pages/API routes can call.
// ---------------------------------------------------------------------------

export type ProgressReportSnapshot = {
  blockStart: string;
  blockEnd: string;
  priorBlockStart: string;
  priorBlockEnd: string;
  artifact: ProgressReportArtifact | null;
  stale: boolean;
  sourceUpdatedAt: string;
  readiness: ProgressReportReadiness;
};

function hydratePersistedArtifact(record: ProgressReportRecord): ProgressReportArtifact | null {
  try {
    const facts = progressReportFactsSchema.parse(record.facts);
    const narrative = progressReportNarrativeSchema.parse(record.narrative);
    return progressReportArtifactSchema.parse({
      blockStart: record.block_start,
      blockEnd: record.block_end,
      status: record.status,
      sourceUpdatedAt: record.source_updated_at,
      generatedAt: record.generated_at,
      generationVersion: record.generation_version,
      facts,
      narrative,
      feedback: {
        helpful: record.helpful,
        accurate: record.accurate,
        note: record.feedback_note,
        updatedAt: record.feedback_updated_at
      }
    });
  } catch {
    return null;
  }
}

/**
 * Load the snapshot for the block ending on `blockEnd`. Returns the persisted
 * artifact (if any) plus a staleness flag against the current source data.
 */
export async function getProgressReportSnapshot(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockEnd: string;
}): Promise<ProgressReportSnapshot> {
  const bounds = computeBlockBoundaries(args.blockEnd);

  const [record, readiness] = await Promise.all([
    getPersistedProgressReport({
      supabase: args.supabase,
      athleteId: args.athleteId,
      blockStart: bounds.blockStart
    }),
    getProgressReportReadiness({
      supabase: args.supabase,
      athleteId: args.athleteId,
      blockStart: bounds.blockStart,
      priorBlockStart: bounds.priorBlockStart,
      blockEnd: bounds.blockEnd
    })
  ]);

  const artifact = record ? hydratePersistedArtifact(record) : null;
  const stale = isProgressReportStale({
    persisted: record,
    sourceUpdatedAt: readiness.sourceUpdatedAt
  });

  return {
    blockStart: bounds.blockStart,
    blockEnd: bounds.blockEnd,
    priorBlockStart: bounds.priorBlockStart,
    priorBlockEnd: bounds.priorBlockEnd,
    artifact,
    stale,
    sourceUpdatedAt: readiness.sourceUpdatedAt,
    readiness
  };
}

/**
 * Load the most recent persisted progress report for this athlete regardless
 * of block end. Useful for UI that renders the latest report without knowing
 * the block date.
 */
export async function getLatestProgressReportSnapshot(args: {
  supabase: SupabaseClient;
  athleteId: string;
}): Promise<ProgressReportSnapshot | null> {
  const record = await getLatestPersistedProgressReport({
    supabase: args.supabase,
    athleteId: args.athleteId
  });
  if (!record) return null;
  return getProgressReportSnapshot({
    supabase: args.supabase,
    athleteId: args.athleteId,
    blockEnd: record.block_end
  });
}

/**
 * Assemble facts + narrative for a given block end. Returns the AI narrative
 * when available, otherwise the deterministic fallback.
 */
export async function computeProgressReport(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockEnd: string;
  /**
   * Override for the source timestamp (typically supplied by refreshProgressReport
   * so the readiness and compute passes share one query). Falls back to a fresh
   * lookup when omitted.
   */
  sourceUpdatedAt?: string;
}): Promise<{
  facts: ProgressReportFacts;
  narrative: ProgressReportNarrative;
  source: "ai" | "fallback";
  sourceUpdatedAt: string;
}> {
  const bounds = computeBlockBoundaries(args.blockEnd);
  const [facts, sourceUpdatedAt] = await Promise.all([
    buildProgressReportFacts({
      supabase: args.supabase,
      athleteId: args.athleteId,
      blockEnd: args.blockEnd
    }),
    args.sourceUpdatedAt !== undefined
      ? Promise.resolve(args.sourceUpdatedAt)
      : getProgressReportSourceUpdatedAt({
          supabase: args.supabase,
          athleteId: args.athleteId,
          priorBlockStart: bounds.priorBlockStart,
          blockEnd: bounds.blockEnd
        })
  ]);

  const deterministic = buildDeterministicNarrative(facts);
  const { narrative, source } = await generateProgressReportNarrative({
    facts,
    deterministicFallback: deterministic
  });

  return {
    facts: { ...facts, narrativeSource: source },
    narrative,
    source,
    sourceUpdatedAt
  };
}

/**
 * One-call orchestrator: compute and persist the report for the block ending
 * on `blockEnd`. Safe to re-run — upserts on (athlete_id, block_start).
 *
 * Throws `ProgressReportInsufficientDataError` when the current block has
 * fewer than `PROGRESS_REPORT_MIN_CURRENT_ACTIVITIES` activities. Callers
 * should catch that case and render an empty state; persisting a synthesized
 * "success" artifact from zero inputs would churn on every refresh and write
 * fabricated content on every visit.
 */
export async function refreshProgressReport(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockEnd: string;
}): Promise<ProgressReportArtifact> {
  const bounds = computeBlockBoundaries(args.blockEnd);

  const readiness = await getProgressReportReadiness({
    supabase: args.supabase,
    athleteId: args.athleteId,
    blockStart: bounds.blockStart,
    priorBlockStart: bounds.priorBlockStart,
    blockEnd: bounds.blockEnd
  });

  if (!readiness.hasSufficientData) {
    throw new ProgressReportInsufficientDataError(readiness.currentBlockActivityCount);
  }

  const computed = await computeProgressReport({
    supabase: args.supabase,
    athleteId: args.athleteId,
    blockEnd: args.blockEnd,
    sourceUpdatedAt: readiness.sourceUpdatedAt
  });
  return persistProgressReport({
    supabase: args.supabase,
    athleteId: args.athleteId,
    blockStart: bounds.blockStart,
    blockEnd: bounds.blockEnd,
    computed: {
      facts: computed.facts,
      narrative: computed.narrative,
      sourceUpdatedAt: computed.sourceUpdatedAt
    }
  });
}
