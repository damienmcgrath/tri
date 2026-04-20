/**
 * Variance corpus for session-level AI verdicts.
 *
 * Two generators produce session-level verdicts and they write to different
 * tables: the structured `session-verdict` flow writes to `session_verdicts`
 * (dedicated columns + full payload in `raw_ai_response`), while the
 * `execution-review` flow writes a `PersistedExecutionReview` JSONB into
 * `sessions.execution_result` for planned sessions and into
 * `completed_activities.execution_result` for extra (unplanned) activities.
 *
 * Each generator therefore needs to see its *own* prior output to avoid
 * repeating itself. This module provides two fetchers:
 *
 *   - `fetchSessionVerdictPriorHeadlines` — reads `session_verdicts`
 *     (used by the session-verdict generator)
 *   - `fetchExecutionReviewPriorHeadlines` — reads `sessions` + extras
 *     (used by the execution-review generator; covers both planned sessions
 *     and extra workouts)
 *
 * Both return the same `SessionPriorHeadline` shape so a single
 * `SESSION_VARIANCE_PROMPT` can instruct either generator. Mirrors the
 * weekly-debrief variance-corpus pattern at
 * `lib/weekly-debrief/variance-corpus.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type SessionPriorHeadline = {
  sessionId: string;
  sessionDate: string;
  coachHeadline: string | null;
  purposeHeadline: string | null;
  executionSummary: string | null;
  nonObviousInsight: string | null;
  teach: string | null;
};

/** Row shape returned from `session_verdicts` joined to `sessions.date`. */
export type PriorSessionVerdictRow = {
  session_id: string;
  purpose_statement?: unknown;
  execution_summary?: unknown;
  raw_ai_response?: unknown;
  sessions?: { date?: unknown } | Array<{ date?: unknown }> | null;
};

/** Row shape for `sessions.execution_result` or `completed_activities.execution_result`. */
export type PriorExecutionReviewRow = {
  id: string;
  date: string;
  execution_result: unknown;
};

function readString(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object") return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNestedString(source: unknown, path: string[]): string | null {
  let cursor: unknown = source;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (typeof cursor !== "string") return null;
  const trimmed = cursor.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readJoinedDate(source: PriorSessionVerdictRow["sessions"]): string | null {
  if (!source) return null;
  const row = Array.isArray(source) ? source[0] : source;
  if (!row || typeof row !== "object") return null;
  const date = (row as Record<string, unknown>).date;
  if (typeof date !== "string") return null;
  const trimmed = date.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTopLevelString(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Convert prior `session_verdicts` rows into the variance corpus. Ordered
 * most-recent-first by the caller. Rows with no reusable phrasings are
 * dropped.
 */
export function extractSessionVerdictPriorHeadlines(
  rows: PriorSessionVerdictRow[]
): SessionPriorHeadline[] {
  return rows
    .map((row) => {
      const sessionDate = readJoinedDate(row.sessions);
      if (!sessionDate || typeof row.session_id !== "string" || row.session_id.length === 0) {
        return null;
      }
      return {
        sessionId: row.session_id,
        sessionDate,
        coachHeadline: readNestedString(row.raw_ai_response, ["sessionVerdict", "headline"]),
        purposeHeadline: readTopLevelString(row, "purpose_statement"),
        executionSummary: readTopLevelString(row, "execution_summary"),
        nonObviousInsight:
          readString(row.raw_ai_response, "non_obvious_insight") ??
          readString(row.raw_ai_response, "nonObviousInsight"),
        teach: readString(row.raw_ai_response, "teach"),
      };
    })
    .filter((entry): entry is SessionPriorHeadline =>
      entry !== null &&
      (entry.coachHeadline != null ||
        entry.purposeHeadline != null ||
        entry.executionSummary != null ||
        entry.nonObviousInsight != null ||
        entry.teach != null)
    );
}

/**
 * Convert prior `execution_result` blobs (from `sessions` or
 * `completed_activities`) into the variance corpus. The verdict lives at
 * `execution_result.verdict` under the `PersistedExecutionReview` shape.
 */
export function extractExecutionReviewPriorHeadlines(
  rows: PriorExecutionReviewRow[]
): SessionPriorHeadline[] {
  return rows
    .map((row) => {
      if (!row.id || !row.date || !row.execution_result) return null;
      const verdict =
        row.execution_result && typeof row.execution_result === "object" && !Array.isArray(row.execution_result)
          ? (row.execution_result as Record<string, unknown>).verdict
          : null;
      if (!verdict || typeof verdict !== "object") return null;
      return {
        sessionId: row.id,
        sessionDate: row.date,
        coachHeadline: readNestedString(verdict, ["sessionVerdict", "headline"]),
        purposeHeadline: readNestedString(verdict, ["explanation", "sessionIntent"]),
        executionSummary:
          readNestedString(verdict, ["explanation", "whatHappened"]) ??
          readNestedString(verdict, ["sessionVerdict", "summary"]),
        nonObviousInsight: readString(verdict, "nonObviousInsight"),
        teach: readString(verdict, "teach"),
      };
    })
    .filter((entry): entry is SessionPriorHeadline =>
      entry !== null &&
      (entry.coachHeadline != null ||
        entry.purposeHeadline != null ||
        entry.executionSummary != null ||
        entry.nonObviousInsight != null ||
        entry.teach != null)
    );
}

/**
 * Fetch the most recent `session_verdicts` rows preceding a given session
 * date, joined to `sessions` for the date ordering. Orders by the joined
 * `sessions.date` via the `referencedTable` option — without that option the
 * URL key would be malformed and PostgREST would silently drop the sort.
 */
export async function fetchSessionVerdictPriorHeadlines(
  supabase: SupabaseClient,
  userId: string,
  beforeDate: string,
  limit: number = 4
): Promise<SessionPriorHeadline[]> {
  const { data } = await supabase
    .from("session_verdicts")
    .select(
      "session_id, purpose_statement, execution_summary, raw_ai_response, sessions!inner(date)"
    )
    .eq("user_id", userId)
    .lt("sessions.date", beforeDate)
    .order("date", { referencedTable: "sessions", ascending: false })
    .limit(limit);

  if (!data) return [];
  return extractSessionVerdictPriorHeadlines(data as PriorSessionVerdictRow[]);
}

/**
 * Fetch the most recent `execution_result` blobs the athlete has seen,
 * combining planned sessions (`sessions.execution_result`) and extra
 * workouts (`completed_activities.execution_result`). Both queries run in
 * parallel and are merged, sorted most-recent-first, and capped at `limit`.
 *
 * `beforeDate` is a YYYY-MM-DD session date. Extras use `start_time_utc`
 * and are converted to a YYYY-MM-DD date string for merging.
 */
export async function fetchExecutionReviewPriorHeadlines(
  supabase: SupabaseClient,
  userId: string,
  beforeDate: string,
  limit: number = 4
): Promise<SessionPriorHeadline[]> {
  const [sessionsResult, extrasResult] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, date, execution_result")
      .eq("user_id", userId)
      .lt("date", beforeDate)
      .not("execution_result", "is", null)
      .order("date", { ascending: false })
      .limit(limit),
    supabase
      .from("completed_activities")
      .select("id, start_time_utc, execution_result")
      .eq("user_id", userId)
      .lt("start_time_utc", `${beforeDate}T00:00:00.000Z`)
      .not("execution_result", "is", null)
      .order("start_time_utc", { ascending: false })
      .limit(limit),
  ]);

  const sessionRows = (sessionsResult.data ?? []) as Array<{
    id: string;
    date: string;
    execution_result: unknown;
  }>;
  const extraRows = (extrasResult.data ?? []) as Array<{
    id: string;
    start_time_utc: string;
    execution_result: unknown;
  }>;

  const normalized: PriorExecutionReviewRow[] = [
    ...sessionRows,
    ...extraRows.map((row) => ({
      id: row.id,
      date: typeof row.start_time_utc === "string" ? row.start_time_utc.slice(0, 10) : "",
      execution_result: row.execution_result,
    })),
  ];

  return extractExecutionReviewPriorHeadlines(normalized)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
    .slice(0, limit);
}

/**
 * Shared prompt text for the session-level variance corpus. Injected into
 * both the session-verdict and the execution-review prompts so the generator
 * knows how to consume `priorHeadlines`.
 */
export const SESSION_VARIANCE_PROMPT = [
  "Variance (priorHeadlines):",
  "- priorHeadlines is a list of the athlete's most recent session verdicts (coachHeadline, purposeHeadline, executionSummary, nonObviousInsight, teach). Treat it as a \"do not repeat\" corpus — not as evidence about this session.",
  "- Your headline, purpose_statement, execution_summary, non_obvious_insight, and teach must avoid reusing the opening phrasings, metaphors, or framings that appear in priorHeadlines. If this session genuinely echoes a prior pattern, describe the continuation in fresh language rather than restating the previous phrasing.",
  "- In particular: rotate the teach mechanism. If recent priorHeadlines taught aerobic decoupling, prefer a different mechanism this time unless the evidence genuinely repeats.",
  "- Reusing concrete numbers, dates, or session names is fine — only the prose framings must be different."
].join("\n");
