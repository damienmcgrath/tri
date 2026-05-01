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
 * Shared shape for `profiles` rows. Keep this aligned with the columns used
 * by callers — extend as new fields are read. `getProfileSnapshot` selects a
 * subset and returns `Pick<ProfileRow, F>` so each caller stays minimal.
 */
export type ProfileRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  active_plan_id: string | null;
  race_name: string | null;
  race_date: string | null;
  locale: string | null;
  units: string | null;
  timezone: string | null;
  week_start_day: number | null;
};

export type ProfileField = keyof ProfileRow;

/**
 * Fetch a typed subset of `profiles` columns for a single user. Returns null
 * when no row exists. Pass `fields` as a `const` tuple so the return type
 * narrows to `Pick<ProfileRow, F>`:
 *
 *   const profile = await getProfileSnapshot(supabase, userId, [
 *     "active_plan_id",
 *     "race_name",
 *     "race_date",
 *   ] as const);
 */
export async function getProfileSnapshot<F extends ProfileField>(
  supabase: SupabaseClient,
  userId: string,
  fields: readonly F[]
): Promise<Pick<ProfileRow, F> | null> {
  const { data } = await supabase
    .from("profiles")
    .select(fields.join(","))
    .eq("id", userId)
    .maybeSingle();

  return (data as Pick<ProfileRow, F> | null) ?? null;
}

/**
 * Fetch the active_plan_id for a user. Returns null if no profile or no active plan.
 */
export async function getActivePlanId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const profile = await getProfileSnapshot(supabase, userId, ["active_plan_id"] as const);
  return profile?.active_plan_id ?? null;
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
