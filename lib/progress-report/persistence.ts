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
  computed: ProgressReportComputed;
}): Promise<ProgressReportArtifact> {
  const generatedAt = new Date().toISOString();

  const { data, error } = await args.supabase
    .from("progress_reports")
    .upsert(
      {
        athlete_id: args.athleteId,
        user_id: args.athleteId,
        block_start: args.blockStart,
        block_end: args.blockEnd,
        status: "ready",
        source_updated_at: args.computed.sourceUpdatedAt,
        generated_at: generatedAt,
        generation_version: PROGRESS_REPORT_GENERATION_VERSION,
        facts: args.computed.facts,
        narrative: args.computed.narrative
      },
      { onConflict: "athlete_id,block_start" }
    )
    .select(
      "block_start,block_end,status,source_updated_at,generated_at,generation_version,facts,narrative,helpful,accurate,feedback_note,feedback_updated_at"
    )
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Could not persist progress report.");

  return normalizePersistedRecord(data as ProgressReportRecord, "ready");
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
 * Max `updated_at` across the athlete's completed_activities in the block range
 * — used as the source-of-truth signal for report staleness.
 */
export async function getProgressReportSourceUpdatedAt(args: {
  supabase: SupabaseClient;
  athleteId: string;
  priorBlockStart: string;
  blockEnd: string;
}): Promise<string> {
  const { data } = await args.supabase
    .from("completed_activities")
    .select("updated_at")
    .eq("user_id", args.athleteId)
    .gte("start_time_utc", `${args.priorBlockStart}T00:00:00.000Z`)
    .lte("start_time_utc", `${args.blockEnd}T23:59:59.999Z`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.updated_at) return data.updated_at as string;
  return new Date().toISOString();
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
