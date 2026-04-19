/**
 * Shared Supabase query helpers to eliminate duplicated column lists and
 * common single-row lookups that appear across multiple modules.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Sessions ────────────────────────────────────────────────────────────────

/**
 * Core column set selected by most `sessions` table queries.
 * Callers that need extra columns can interpolate:
 *   .select(`${SESSION_BASE_COLUMNS},execution_result`)
 */
export const SESSION_BASE_COLUMNS = "id,date,sport,type,duration_minutes,status" as const;

// ─── Profiles ────────────────────────────────────────────────────────────────

/**
 * Fetch the active_plan_id for a user. Returns null if no profile or no active plan.
 */
export async function getActivePlanId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("active_plan_id")
    .eq("id", userId)
    .maybeSingle();

  return (data?.active_plan_id as string | null) ?? null;
}

// ─── Session Load ────────────────────────────────────────────────────────────

export type SessionLoadRow = {
  sport: string;
  tss: number | null;
  duration_sec: number | null;
};

/**
 * Fetch session_load rows for a user within a date range (inclusive).
 */
export async function querySessionLoad(
  supabase: SupabaseClient,
  userId: string,
  dateStart: string,
  dateEnd: string
): Promise<SessionLoadRow[]> {
  const { data } = await supabase
    .from("session_load")
    .select("sport, tss, duration_sec")
    .eq("user_id", userId)
    .gte("date", dateStart)
    .lte("date", dateEnd);

  return (data ?? []) as SessionLoadRow[];
}
