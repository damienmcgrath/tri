import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProgressReportFacts,
  buildProgressReportFactsForBlock,
  computeBlockBoundaries
} from "./facts";
import { buildDeterministicNarrative } from "./deterministic";
import { generateProgressReportNarrative } from "./narrative";
import {
  persistProgressReport,
  getPersistedProgressReport,
  getPersistedProgressReportByBlockId,
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
  buildProgressReportFactsForBlock,
  computeBlockBoundaries
} from "./facts";

export { buildDeterministicNarrative } from "./deterministic";
export { generateProgressReportNarrative } from "./narrative";

export {
  persistProgressReport,
  getPersistedProgressReport,
  getPersistedProgressReportByBlockId,
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
  /** The training_blocks.id used to drive this snapshot, if any. */
  blockId: string | null;
  /** The prior block's id used for comparison, if resolvable. */
  priorBlockId: string | null;
  artifact: ProgressReportArtifact | null;
  stale: boolean;
  sourceUpdatedAt: string;
  readiness: ProgressReportReadiness;
};

type ResolvedBlockBounds = {
  blockStart: string;
  blockEnd: string;
  priorBlockStart: string;
  priorBlockEnd: string;
  blockId: string | null;
  priorBlockId: string | null;
};

/**
 * Resolve block bounds either from a real training_blocks row (preferred) or
 * from the legacy 28-day rolling window keyed on blockEnd. Returns null when
 * the caller asked for a blockId that doesn't exist.
 */
async function resolveBlockBounds(args: {
  supabase: SupabaseClient;
  blockId?: string;
  blockEnd?: string;
}): Promise<ResolvedBlockBounds | null> {
  if (args.blockId) {
    const { data: block, error } = await args.supabase
      .from("training_blocks")
      .select("id,plan_id,start_date,end_date,sort_order")
      .eq("id", args.blockId)
      .maybeSingle();
    if (error || !block) return null;

    let priorBlockStart: string | null = null;
    let priorBlockEnd: string | null = null;
    let priorBlockId: string | null = null;
    if (block.plan_id != null && block.sort_order != null) {
      const { data: priorRow } = await args.supabase
        .from("training_blocks")
        .select("id,start_date,end_date")
        .eq("plan_id", block.plan_id)
        .lt("sort_order", block.sort_order)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priorRow) {
        priorBlockId = (priorRow as { id: string }).id;
        priorBlockStart = (priorRow as { start_date: string }).start_date;
        priorBlockEnd = (priorRow as { end_date: string }).end_date;
      }
    }

    const fallback = computeBlockBoundaries(block.end_date);
    return {
      blockStart: block.start_date,
      blockEnd: block.end_date,
      priorBlockStart: priorBlockStart ?? fallback.priorBlockStart,
      priorBlockEnd: priorBlockEnd ?? fallback.priorBlockEnd,
      blockId: block.id,
      priorBlockId
    };
  }

  if (!args.blockEnd) return null;
  const bounds = computeBlockBoundaries(args.blockEnd);
  return { ...bounds, blockId: null, priorBlockId: null };
}

/**
 * Postgres `timestamptz` columns come back from PostgREST in the form
 * `2026-04-23T20:49:27.22214+00:00` — Zod's default `.datetime()` wants a
 * `Z` suffix and rejects offset form. Round-trip through `Date` so the
 * schema sees a canonical `…Z` string.
 */
function normalizeIsoTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function hydratePersistedArtifact(record: ProgressReportRecord): ProgressReportArtifact | null {
  try {
    const facts = progressReportFactsSchema.parse(record.facts);
    const narrative = progressReportNarrativeSchema.parse(record.narrative);
    return progressReportArtifactSchema.parse({
      blockStart: record.block_start,
      blockEnd: record.block_end,
      status: record.status,
      sourceUpdatedAt: normalizeIsoTimestamp(record.source_updated_at),
      generatedAt: normalizeIsoTimestamp(record.generated_at),
      generationVersion: record.generation_version,
      facts,
      narrative,
      feedback: {
        helpful: record.helpful,
        accurate: record.accurate,
        note: record.feedback_note,
        updatedAt: record.feedback_updated_at
          ? normalizeIsoTimestamp(record.feedback_updated_at)
          : null
      }
    });
  } catch (err) {
    console.error(
      "[progress-report] hydratePersistedArtifact failed — falling back to null",
      err
    );
    return null;
  }
}

/**
 * Load the snapshot for the block ending on `blockEnd` (legacy rolling window)
 * or for the real training_blocks row identified by `blockId` (preferred).
 * Returns the persisted artifact (if any) plus a staleness flag against the
 * current source data.
 */
export async function getProgressReportSnapshot(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockEnd?: string;
  blockId?: string;
}): Promise<ProgressReportSnapshot> {
  const bounds = await resolveBlockBounds({
    supabase: args.supabase,
    blockId: args.blockId,
    blockEnd: args.blockEnd
  });
  if (!bounds) {
    throw new Error(
      args.blockId
        ? `progress-report: block ${args.blockId} not found`
        : "progress-report: blockEnd or blockId is required"
    );
  }

  const [record, readiness] = await Promise.all([
    bounds.blockId
      ? getPersistedProgressReportByBlockId({
          supabase: args.supabase,
          athleteId: args.athleteId,
          blockId: bounds.blockId
        }).then(
          (row) =>
            row ??
            getPersistedProgressReport({
              supabase: args.supabase,
              athleteId: args.athleteId,
              blockStart: bounds.blockStart
            })
        )
      : getPersistedProgressReport({
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
    blockId: bounds.blockId,
    priorBlockId: bounds.priorBlockId,
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
 * List the athlete's training blocks newest-first for use in a picker.
 * Gracefully returns an empty array when the table is unavailable.
 */
export async function listAthleteTrainingBlocks(args: {
  supabase: SupabaseClient;
  athleteId: string;
}): Promise<
  Array<{
    id: string;
    name: string;
    block_type: string;
    start_date: string;
    end_date: string;
    plan_id: string | null;
    sort_order: number;
  }>
> {
  const { data, error } = await args.supabase
    .from("training_blocks")
    .select("id,name,block_type,start_date,end_date,plan_id,sort_order")
    .eq("user_id", args.athleteId)
    .order("start_date", { ascending: false });

  if (error) {
    const message = (error.message ?? "").toLowerCase();
    if (
      error.code === "PGRST205" ||
      message.includes("could not find the table 'public.training_blocks'")
    ) {
      return [];
    }
    throw new Error(error.message);
  }

  return (data ?? []) as Array<{
    id: string;
    name: string;
    block_type: string;
    start_date: string;
    end_date: string;
    plan_id: string | null;
    sort_order: number;
  }>;
}

/**
 * Assemble facts + narrative for a given block end (legacy rolling window) or
 * training_blocks id (preferred). Returns the AI narrative when available,
 * otherwise the deterministic fallback.
 */
export async function computeProgressReport(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockEnd?: string;
  blockId?: string;
  priorBlockId?: string | null;
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
  const bounds = await resolveBlockBounds({
    supabase: args.supabase,
    blockId: args.blockId,
    blockEnd: args.blockEnd
  });
  if (!bounds) {
    throw new Error(
      args.blockId
        ? `progress-report: block ${args.blockId} not found`
        : "progress-report: blockEnd or blockId is required"
    );
  }

  const factsPromise = bounds.blockId
    ? buildProgressReportFactsForBlock({
        supabase: args.supabase,
        athleteId: args.athleteId,
        blockId: bounds.blockId,
        priorBlockId: args.priorBlockId ?? bounds.priorBlockId ?? undefined
      })
    : buildProgressReportFacts({
        supabase: args.supabase,
        athleteId: args.athleteId,
        blockEnd: bounds.blockEnd
      });

  const [facts, sourceUpdatedAt] = await Promise.all([
    factsPromise,
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
  blockEnd?: string;
  blockId?: string;
}): Promise<ProgressReportArtifact> {
  const bounds = await resolveBlockBounds({
    supabase: args.supabase,
    blockId: args.blockId,
    blockEnd: args.blockEnd
  });
  if (!bounds) {
    throw new Error(
      args.blockId
        ? `progress-report: block ${args.blockId} not found`
        : "progress-report: blockEnd or blockId is required"
    );
  }

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
    blockEnd: bounds.blockEnd,
    blockId: bounds.blockId ?? undefined,
    priorBlockId: bounds.priorBlockId,
    sourceUpdatedAt: readiness.sourceUpdatedAt
  });
  return persistProgressReport({
    supabase: args.supabase,
    athleteId: args.athleteId,
    blockStart: bounds.blockStart,
    blockEnd: bounds.blockEnd,
    blockId: bounds.blockId,
    computed: {
      facts: computed.facts,
      narrative: computed.narrative,
      sourceUpdatedAt: computed.sourceUpdatedAt
    }
  });
}
