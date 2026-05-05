// Findings persistence layer.
// Spec: tri.ai Findings Pipeline Spec §1.3 (Phase 1).
// Schema lives in supabase/migrations/202605050001_findings_registry.sql (#379).
//
// `Finding.id` is the analyzer-supplied stable id stored as `finding_id` in DB;
// the table's primary key is a separate auto-generated UUID surfaced as
// `row_id` on read so callers can reference rows for supersede chains.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Finding,
  FindingCategory,
  FindingEvidence,
  FindingPolarity,
  FindingPrescription,
  FindingSeverity,
  VisualType
} from "./types";

const FINDINGS_TABLE = "findings";

const FINDING_COLUMNS =
  "id,session_id,user_id,finding_id,analyzer_id,analyzer_version,category,polarity,severity,headline,evidence,reasoning,prescription,visual,conditional_on,scope,scope_ref,generated_at,superseded_by";

interface FindingRow {
  id: string;
  session_id: string;
  user_id: string;
  finding_id: string;
  analyzer_id: string;
  analyzer_version: string;
  category: FindingCategory;
  polarity: FindingPolarity;
  severity: FindingSeverity;
  headline: string;
  evidence: FindingEvidence[];
  reasoning: string;
  prescription: FindingPrescription | null;
  visual: VisualType | null;
  conditional_on: string[] | null;
  scope: "session" | "block" | "segment";
  scope_ref: string | null;
  generated_at: string;
  superseded_by: string | null;
}

function toRowPayload(
  sessionId: string,
  userId: string,
  finding: Finding
): Omit<FindingRow, "id" | "generated_at" | "superseded_by"> {
  return {
    session_id: sessionId,
    user_id: userId,
    finding_id: finding.id,
    analyzer_id: finding.analyzer_id,
    analyzer_version: finding.analyzer_version,
    category: finding.category,
    polarity: finding.polarity,
    severity: finding.severity,
    headline: finding.headline,
    evidence: finding.evidence,
    reasoning: finding.reasoning,
    prescription: finding.prescription ?? null,
    visual: finding.visual ?? null,
    conditional_on: finding.conditional_on ?? null,
    scope: finding.scope,
    scope_ref: finding.scope_ref ?? null
  };
}

function fromRow(row: FindingRow): Finding {
  return {
    id: row.finding_id,
    analyzer_id: row.analyzer_id,
    analyzer_version: row.analyzer_version,
    category: row.category,
    polarity: row.polarity,
    severity: row.severity,
    headline: row.headline,
    evidence: row.evidence ?? [],
    reasoning: row.reasoning,
    ...(row.prescription ? { prescription: row.prescription } : {}),
    ...(row.visual ? { visual: row.visual } : {}),
    ...(row.conditional_on ? { conditional_on: row.conditional_on } : {}),
    scope: row.scope,
    ...(row.scope_ref ? { scope_ref: row.scope_ref } : {})
  };
}

/**
 * Idempotent upsert keyed on `(session_id, finding_id, analyzer_version)`.
 * Re-running the same analyzer with the same version overwrites in place;
 * a version bump produces a new row that the caller can later wire into a
 * supersede chain via {@link supersedeFindings}.
 */
export async function upsertFindings(
  sessionId: string,
  userId: string,
  findings: Finding[],
  supabase: SupabaseClient
): Promise<void> {
  if (findings.length === 0) return;

  const payload = findings.map((f) => toRowPayload(sessionId, userId, f));

  const { error } = await supabase
    .from(FINDINGS_TABLE)
    .upsert(payload, {
      onConflict: "session_id,finding_id,analyzer_version"
    });

  if (error) throw new Error(`upsertFindings: ${error.message}`);
}

/**
 * Returns the active (non-superseded) findings for a session in stable order.
 * RLS restricts visibility to the authenticated user.
 */
export async function getFindingsForSession(
  sessionId: string,
  supabase: SupabaseClient
): Promise<Finding[]> {
  const { data, error } = await supabase
    .from(FINDINGS_TABLE)
    .select(FINDING_COLUMNS)
    .eq("session_id", sessionId)
    .is("superseded_by", null)
    .order("generated_at", { ascending: true });

  if (error) throw new Error(`getFindingsForSession: ${error.message}`);
  if (!data) return [];
  return (data as FindingRow[]).map(fromRow);
}

/**
 * Supersede an existing finding row with a new finding. Inserts the new row
 * first, then points the old row's `superseded_by` at the new row's PK.
 *
 * Not transactional — Postgres MVCC and the immutable supersede pointer make
 * the worst case (insert succeeds, update fails) recoverable: a subsequent
 * call with the same `oldFindingRowId` and `newFinding` will hit the unique
 * constraint, surface the existing new row's id, and re-attempt the update.
 * Callers that need strict atomicity can wrap this in an RPC.
 */
export async function supersedeFindings(
  oldFindingRowId: string,
  newFinding: Finding,
  userId: string,
  sessionId: string,
  supabase: SupabaseClient
): Promise<void> {
  const insertPayload = toRowPayload(sessionId, userId, newFinding);

  const { data: inserted, error: insertError } = await supabase
    .from(FINDINGS_TABLE)
    .upsert(insertPayload, {
      onConflict: "session_id,finding_id,analyzer_version"
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    throw new Error(`supersedeFindings insert: ${insertError.message}`);
  }
  if (!inserted?.id) {
    throw new Error("supersedeFindings: insert returned no row id");
  }

  const { error: updateError } = await supabase
    .from(FINDINGS_TABLE)
    .update({ superseded_by: inserted.id })
    .eq("id", oldFindingRowId);

  if (updateError) {
    throw new Error(`supersedeFindings update: ${updateError.message}`);
  }
}
