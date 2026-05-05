// ResolvedIntent persistence layer.
// Spec: tri.ai Findings Pipeline Spec §3.2 (Phase 2).
// Schema: supabase/migrations/202605060001_session_resolved_intent.sql adds
// `resolved_intent JSONB` and `resolved_intent_source TEXT` to public.sessions.
// RLS on public.sessions already gates access by auth.uid() = user_id.

import type { SupabaseClient } from "@supabase/supabase-js";

import { validateIntent } from "@/lib/intent/parser";
import type { ResolvedIntent } from "@/lib/intent/types";

const SESSIONS_TABLE = "sessions";

interface ResolvedIntentRow {
  resolved_intent: ResolvedIntent | null;
  resolved_intent_source: ResolvedIntent["source"] | null;
}

/**
 * Persist a ResolvedIntent against the planned session row.
 *
 * Writes both `resolved_intent` (full JSON) and `resolved_intent_source`
 * (denormalised so the index in the migration can answer "which sessions are
 * still open intent?" without scanning the JSONB blob).
 */
export async function saveResolvedIntent(
  sessionId: string,
  intent: ResolvedIntent,
  supabase: SupabaseClient,
): Promise<void> {
  const { error } = await supabase
    .from(SESSIONS_TABLE)
    .update({
      resolved_intent: intent,
      resolved_intent_source: intent.source,
    })
    .eq("id", sessionId);

  if (error) throw new Error(`saveResolvedIntent: ${error.message}`);
}

/**
 * Load the ResolvedIntent for a session. Returns `null` when no intent has
 * been persisted yet (the column is nullable). Validates the JSON shape on
 * read so callers get a typed value or a clear error rather than silently
 * propagating a malformed blob from the DB.
 */
export async function loadResolvedIntent(
  sessionId: string,
  supabase: SupabaseClient,
): Promise<ResolvedIntent | null> {
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .select("resolved_intent,resolved_intent_source")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(`loadResolvedIntent: ${error.message}`);
  if (!data) return null;

  const row = data as ResolvedIntentRow;
  if (!row.resolved_intent) return null;

  try {
    return validateIntent(row.resolved_intent);
  } catch (err) {
    console.warn("[loadResolvedIntent] persisted intent failed validation", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
