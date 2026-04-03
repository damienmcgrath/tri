/**
 * Schema compatibility helpers for Supabase operations.
 *
 * When migrations haven't been applied yet, INSERT/UPDATE calls can fail with
 * PostgreSQL error 42703 ("column does not exist"). Several places in the
 * codebase handle this by stripping optional columns and retrying. This module
 * centralises that pattern.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Detect whether a Supabase error is caused by a missing database column
 * (typically because a migration hasn't been applied yet).
 */
export function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined,
  column?: string
): boolean {
  if (!error) return false;

  if (error.code === "42703") {
    if (column) {
      return new RegExp(`\\b${column}\\b`, "i").test(error.message ?? "");
    }
    return true;
  }

  const msg = error.message ?? "";

  if (column) {
    return new RegExp(`(${column}|schema cache|column .* does not exist|42703)`, "i").test(msg);
  }

  return /(schema cache|column .* does not exist|42703)/i.test(msg);
}

/** Column names that may not exist on the `sessions` table before certain migrations. */
export const SESSIONS_OPTIONAL_COLUMNS = ["day_order", "target", "is_key", "session_role"] as const;

/** Column names that may not exist on the `completed_activities` table before certain migrations. */
export const COMPLETED_ACTIVITIES_OPTIONAL_COLUMNS = ["is_unplanned", "schedule_status"] as const;

type AnySupabaseClient = SupabaseClient | Awaited<ReturnType<any>>;

function stripColumns(payload: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> {
  const result = { ...payload };
  for (const col of columns) {
    delete result[col];
  }
  return result;
}

/**
 * Insert a single row, retrying without optional columns on missing-column errors.
 */
export async function insertWithCompat(
  supabase: AnySupabaseClient,
  table: string,
  payload: Record<string, unknown>,
  optionalColumns: readonly string[]
): Promise<void> {
  const { error: initialError } = await (supabase as SupabaseClient).from(table).insert(payload);
  if (!initialError) return;

  const stripped = stripColumns(payload, optionalColumns);
  if (Object.keys(stripped).length === Object.keys(payload).length) {
    throw new Error(initialError.message);
  }

  const { error: retryError } = await (supabase as SupabaseClient).from(table).insert(stripped);
  if (retryError) throw new Error(retryError.message);
}

/**
 * Insert a batch of rows, retrying without optional columns on missing-column errors.
 */
export async function insertBatchWithCompat(
  supabase: AnySupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  optionalColumns: readonly string[]
): Promise<void> {
  const { error: initialError } = await (supabase as SupabaseClient).from(table).insert(rows);
  if (!initialError) return;

  const fallback = rows.map((row) => stripColumns(row, optionalColumns));
  const { error: retryError } = await (supabase as SupabaseClient).from(table).insert(fallback);
  if (retryError) throw new Error(retryError.message);
}

/**
 * Update a single row by ID, retrying without optional columns on missing-column errors.
 */
export async function updateWithCompat(
  supabase: AnySupabaseClient,
  table: string,
  id: string,
  payload: Record<string, unknown>,
  optionalColumns: readonly string[]
): Promise<void> {
  const { error: initialError } = await (supabase as SupabaseClient).from(table).update(payload).eq("id", id);
  if (!initialError) return;

  const stripped = stripColumns(payload, optionalColumns);
  if (Object.keys(stripped).length === Object.keys(payload).length) {
    throw new Error(initialError.message);
  }

  const { error: retryError } = await (supabase as SupabaseClient).from(table).update(stripped).eq("id", id);
  if (retryError) throw new Error(retryError.message);
}

/**
 * Insert a row into `completed_activities` with select, retrying without optional
 * columns on missing-column errors. Returns the inserted row data.
 */
export async function insertActivityWithCompat(
  supabase: AnySupabaseClient,
  payload: Record<string, unknown>,
  selectClause: string
): Promise<{ data: any; error: any }> {
  const result = await (supabase as SupabaseClient)
    .from("completed_activities")
    .insert(payload)
    .select(selectClause)
    .single();

  if (!result.error || !isMissingColumnError(result.error)) {
    return result;
  }

  const stripped = stripColumns(payload, COMPLETED_ACTIVITIES_OPTIONAL_COLUMNS);
  return (supabase as SupabaseClient)
    .from("completed_activities")
    .insert(stripped)
    .select(selectClause)
    .single();
}
