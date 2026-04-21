import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROGRESS_REPORT_GENERATION_VERSION,
  progressReportArtifactSchema,
  progressReportFactsSchema,
  progressReportFeedbackInputSchema,
  progressReportNarrativeSchema,
  type ProgressReportArtifact,
  type ProgressReportFacts,
  type ProgressReportFeedbackInput,
  type ProgressReportNarrative,
  type ProgressReportRecord
} from "./types";

export type ProgressReportComputed = {
  facts: ProgressReportFacts;
  narrative: ProgressReportNarrative;
  sourceUpdatedAt: string;
};

/**
 * Stable sentinel used when the athlete has zero activities in the two-block
 * window. Returning `new Date().toISOString()` here would change every call
 * and permanently flag any persisted artifact as stale, causing infinite
 * regeneration (and fabricated AI writes) on empty accounts.
 */
export const PROGRESS_REPORT_EMPTY_SOURCE_UPDATED_AT =
  "1970-01-01T00:00:00.000Z";

/** Current-block activity floor below which we refuse to compute a report. */
export const PROGRESS_REPORT_MIN_CURRENT_ACTIVITIES = 1;

export type ProgressReportReadiness = {
  currentBlockActivityCount: number;
  hasSufficientData: boolean;
  sourceUpdatedAt: string;
};

function normalizePersistedRecord(
  record: ProgressReportRecord,
  effectiveStatus: "ready" | "stale" | "failed"
): ProgressReportArtifact {
  const rawFacts = progressReportFactsSchema.parse(record.facts);
  const rawNarrative = progressReportNarrativeSchema.parse(record.narrative);
  return progressReportArtifactSchema.parse({
    blockStart: record.block_start,
    blockEnd: record.block_end,
    status: effectiveStatus,
    sourceUpdatedAt: record.source_updated_at,
    generatedAt: record.generated_at,
    generationVersion: record.generation_version,
    facts: rawFacts,
    narrative: rawNarrative,
    feedback: {
      helpful: record.helpful,
      accurate: record.accurate,
      note: record.feedback_note,
      updatedAt: record.feedback_updated_at
    }
  });
}

export async function persistProgressReport(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockStart: string;
  blockEnd: string;
  /** When provided, stored alongside the row so block-keyed lookups work. */
  blockId?: string | null;
  computed: ProgressReportComputed;
}): Promise<ProgressReportArtifact> {
  const generatedAt = new Date().toISOString();

  const basePayload = {
    athlete_id: args.athleteId,
    user_id: args.athleteId,
    block_start: args.blockStart,
    block_end: args.blockEnd,
    status: "ready" as const,
    source_updated_at: args.computed.sourceUpdatedAt,
    generated_at: generatedAt,
    generation_version: PROGRESS_REPORT_GENERATION_VERSION,
    facts: args.computed.facts,
    narrative: args.computed.narrative
  };

  const selectClause =
    "block_start,block_end,status,source_updated_at,generated_at,generation_version,facts,narrative,helpful,accurate,feedback_note,feedback_updated_at";

  // Prefer the block-id conflict target when we have a real block. This
  // survives block date edits that would otherwise shift `block_start` and
  // leak a duplicate past the `(athlete_id, block_start)` target, tripping
  // the `(athlete_id, block_id)` unique index on the next INSERT.
  if (args.blockId != null) {
    const payload = { ...basePayload, block_id: args.blockId };
    const { data, error } = await args.supabase
      .from("progress_reports")
      .upsert(payload, { onConflict: "athlete_id,block_id" })
      .select(selectClause)
      .maybeSingle();

    if (error) {
      // Schema predates block_id (column or index missing). Fall back to the
      // legacy block_start conflict target so older dev DBs keep working.
      if (isMissingBlockIdError(error)) {
        const { data: retryData, error: retryError } = await args.supabase
          .from("progress_reports")
          .upsert(basePayload, { onConflict: "athlete_id,block_start" })
          .select(selectClause)
          .maybeSingle();
        if (retryError) throw new Error(retryError.message);
        if (!retryData) throw new Error("Could not persist progress report.");
        return normalizePersistedRecord(retryData as ProgressReportRecord, "ready");
      }
      throw new Error(error.message);
    }
    if (!data) throw new Error("Could not persist progress report.");
    return normalizePersistedRecord(data as ProgressReportRecord, "ready");
  }

  const { data, error } = await args.supabase
    .from("progress_reports")
    .upsert(basePayload, { onConflict: "athlete_id,block_start" })
    .select(selectClause)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not persist progress report.");

  return normalizePersistedRecord(data as ProgressReportRecord, "ready");
}

function isMissingBlockIdError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    // column missing
    error.code === "PGRST204" ||
    message.includes('column "block_id"') ||
    message.includes("'block_id'") ||
    // no unique/exclusion constraint matching ON CONFLICT — schema only
    // has the old partial index that PostgREST cannot express.
    error.code === "42P10" ||
    message.includes("no unique or exclusion constraint")
  );
}

export async function getLatestPersistedProgressReport(args: {
  supabase: SupabaseClient;
  athleteId: string;
}): Promise<ProgressReportRecord | null> {
  const { data, error } = await args.supabase
    .from("progress_reports")
    .select(
      "block_start,block_end,status,source_updated_at,generated_at,generation_version,facts,narrative,helpful,accurate,feedback_note,feedback_updated_at"
    )
    .eq("athlete_id", args.athleteId)
    .order("block_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data as ProgressReportRecord) : null;
}

/**
 * Max `created_at` across the athlete's completed_activities in the block range
 * — used as the source-of-truth signal for report staleness. The table only
 * stores `created_at`, so this catches new uploads/imports but not in-place
 * re-parses of existing rows (acceptable: a re-parse without a new activity
 * is not a meaningful block-level signal).
 */
export async function getProgressReportSourceUpdatedAt(args: {
  supabase: SupabaseClient;
  athleteId: string;
  priorBlockStart: string;
  blockEnd: string;
}): Promise<string> {
  const { data, error } = await args.supabase
    .from("completed_activities")
    .select("created_at")
    .eq("user_id", args.athleteId)
    .gte("start_time_utc", `${args.priorBlockStart}T00:00:00.000Z`)
    .lte("start_time_utc", `${args.blockEnd}T23:59:59.999Z`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`progress-report source_updated_at: ${error.message}`);
  if (data?.created_at) return data.created_at as string;
  return PROGRESS_REPORT_EMPTY_SOURCE_UPDATED_AT;
}

/**
 * Cheap readiness gate: counts activities in the current block and fetches
 * the stable `source_updated_at` signal in parallel. Callers use the returned
 * `hasSufficientData` to decide whether to run the AI generator at all.
 */
export async function getProgressReportReadiness(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockStart: string;
  priorBlockStart: string;
  blockEnd: string;
}): Promise<ProgressReportReadiness> {
  const [countRes, sourceUpdatedAt] = await Promise.all([
    args.supabase
      .from("completed_activities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", args.athleteId)
      .gte("start_time_utc", `${args.blockStart}T00:00:00.000Z`)
      .lte("start_time_utc", `${args.blockEnd}T23:59:59.999Z`),
    getProgressReportSourceUpdatedAt({
      supabase: args.supabase,
      athleteId: args.athleteId,
      priorBlockStart: args.priorBlockStart,
      blockEnd: args.blockEnd
    })
  ]);
  if (countRes.error) {
    throw new Error(`progress-report readiness count: ${countRes.error.message}`);
  }
  const currentBlockActivityCount = countRes.count ?? 0;
  return {
    currentBlockActivityCount,
    hasSufficientData:
      currentBlockActivityCount >= PROGRESS_REPORT_MIN_CURRENT_ACTIVITIES,
    sourceUpdatedAt
  };
}

export async function getPersistedProgressReport(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockStart: string;
}): Promise<ProgressReportRecord | null> {
  const { data, error } = await args.supabase
    .from("progress_reports")
    .select(
      "block_start,block_end,status,source_updated_at,generated_at,generation_version,facts,narrative,helpful,accurate,feedback_note,feedback_updated_at"
    )
    .eq("athlete_id", args.athleteId)
    .eq("block_start", args.blockStart)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? (data as ProgressReportRecord) : null;
}

/**
 * Look up a persisted report by the training_blocks FK. Prefer this over
 * `getPersistedProgressReport` when the caller has a real block id — it
 * survives block date edits that would otherwise change the block_start key.
 */
export async function getPersistedProgressReportByBlockId(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockId: string;
}): Promise<ProgressReportRecord | null> {
  const { data, error } = await args.supabase
    .from("progress_reports")
    .select(
      "block_start,block_end,status,source_updated_at,generated_at,generation_version,facts,narrative,helpful,accurate,feedback_note,feedback_updated_at"
    )
    .eq("athlete_id", args.athleteId)
    .eq("block_id", args.blockId)
    .maybeSingle();

  if (error) {
    if (isMissingBlockIdError(error)) return null;
    throw new Error(error.message);
  }
  return data ? (data as ProgressReportRecord) : null;
}

export function isProgressReportStale(args: {
  persisted: Pick<
    ProgressReportRecord,
    "generated_at" | "source_updated_at" | "status" | "generation_version"
  > | null;
  sourceUpdatedAt: string;
}): boolean {
  if (!args.persisted) return false;
  if (args.persisted.status === "failed") return false;
  return (
    args.persisted.generation_version !== PROGRESS_REPORT_GENERATION_VERSION ||
    args.sourceUpdatedAt > args.persisted.generated_at ||
    args.persisted.source_updated_at !== args.sourceUpdatedAt
  );
}

export async function saveProgressReportFeedback(args: {
  supabase: SupabaseClient;
  athleteId: string;
  input: ProgressReportFeedbackInput;
}): Promise<ProgressReportArtifact> {
  const parsed = progressReportFeedbackInputSchema.parse(args.input);
  const { data, error } = await args.supabase
    .from("progress_reports")
    .update({
      helpful: parsed.helpful,
      accurate: parsed.accurate,
      feedback_note: parsed.note ?? null,
      feedback_updated_at: new Date().toISOString()
    })
    .eq("athlete_id", args.athleteId)
    .eq("block_start", parsed.blockStart)
    .select(
      "block_start,block_end,status,source_updated_at,generated_at,generation_version,facts,narrative,helpful,accurate,feedback_note,feedback_updated_at"
    )
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Progress report not found for feedback update.");

  return normalizePersistedRecord(data as ProgressReportRecord, data.status as "ready" | "stale" | "failed");
}
