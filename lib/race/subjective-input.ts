import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const SUBJECTIVE_ISSUE_TAGS = [
  "nutrition",
  "mechanical",
  "illness",
  "navigation",
  "pacing",
  "mental",
  "weather"
] as const;

export type SubjectiveIssueTag = (typeof SUBJECTIVE_ISSUE_TAGS)[number];

export const subjectiveInputSchema = z.object({
  athleteRating: z.number().int().min(1).max(5),
  athleteNotes: z.string().max(4000).nullable().optional(),
  issuesFlagged: z.array(z.enum(SUBJECTIVE_ISSUE_TAGS)).max(SUBJECTIVE_ISSUE_TAGS.length).default([]),
  finishPosition: z.number().int().positive().nullable().optional(),
  ageGroupPosition: z.number().int().positive().nullable().optional()
});

export type SubjectiveInput = z.infer<typeof subjectiveInputSchema>;

export type PersistSubjectiveInputArgs = {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
  input: SubjectiveInput;
};

export type PersistSubjectiveInputResult =
  | { status: "ok"; bundleId: string }
  | { status: "error"; reason: string };

/**
 * Persist subjective inputs against a race bundle. Sets
 * `subjective_captured_at = now()` and flips `status` from 'imported' to
 * 'reviewed' the first time inputs are captured. Re-saves are idempotent.
 */
export async function persistSubjectiveInput(
  args: PersistSubjectiveInputArgs
): Promise<PersistSubjectiveInputResult> {
  const { supabase, userId, bundleId, input } = args;

  const { data: existing, error: existingError } = await supabase
    .from("race_bundles")
    .select("id, status")
    .eq("id", bundleId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError || !existing) {
    return { status: "error", reason: "bundle_not_found" };
  }

  const dedupedIssues = Array.from(new Set(input.issuesFlagged));

  const update: Record<string, unknown> = {
    athlete_rating: input.athleteRating,
    athlete_notes: input.athleteNotes ?? null,
    issues_flagged: dedupedIssues,
    finish_position: input.finishPosition ?? null,
    age_group_position: input.ageGroupPosition ?? null,
    subjective_captured_at: new Date().toISOString()
  };

  if (existing.status === "imported") {
    update.status = "reviewed";
  }

  const { error: updateError } = await supabase
    .from("race_bundles")
    .update(update)
    .eq("id", bundleId)
    .eq("user_id", userId);

  if (updateError) {
    return { status: "error", reason: `update_failed:${updateError.message}` };
  }

  return { status: "ok", bundleId };
}
