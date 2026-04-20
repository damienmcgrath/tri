/**
 * Variance corpus for session-level AI verdicts.
 *
 * Prior verdicts are summarised into a compact list of phrasings the athlete
 * has already seen — the coach headline (when execution-review populated it),
 * the purpose statement, the execution summary, and the non-obvious insight.
 * The session-verdict and execution-review generators consume this list and
 * are instructed not to reuse the same framings so verdicts stop feeling
 * templated week-over-week.
 *
 * Mirrors the weekly-debrief variance-corpus pattern at
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
};

export type PriorSessionVerdictRow = {
  session_id: string;
  purpose_statement?: unknown;
  execution_summary?: unknown;
  raw_ai_response?: unknown;
  sessions?: { date?: unknown } | Array<{ date?: unknown }> | null;
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
 * Convert prior session_verdicts rows into a variance corpus for the next
 * generation. Ordered most-recent-first so the model weights the freshest
 * phrasings highest. Rows with no reusable phrasings are dropped.
 */
export function extractSessionPriorHeadlines(
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
      };
    })
    .filter((entry): entry is SessionPriorHeadline =>
      entry !== null &&
      (entry.coachHeadline != null ||
        entry.purposeHeadline != null ||
        entry.executionSummary != null ||
        entry.nonObviousInsight != null)
    );
}

/**
 * Fetch the most recent ready verdicts preceding a given session date, joined
 * to `sessions` for the date ordering. Returns up to `limit` rows.
 *
 * Note: uses `any` on the supabase client result because the generated types
 * don't model the join; the extractor validates the row shape at runtime.
 */
export async function fetchSessionPriorHeadlines(
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
    .order("sessions(date)", { ascending: false })
    .limit(limit);

  if (!data) return [];
  return extractSessionPriorHeadlines(data as PriorSessionVerdictRow[]);
}

/**
 * Shared prompt text for the session-level variance corpus. Injected into
 * both the session-verdict and the execution-review prompts so the generator
 * knows how to consume `priorHeadlines`.
 */
export const SESSION_VARIANCE_PROMPT = [
  "Variance (priorHeadlines):",
  "- priorHeadlines is a list of the athlete's most recent session verdicts (coachHeadline, purposeHeadline, executionSummary, nonObviousInsight). Treat it as a \"do not repeat\" corpus — not as evidence about this session.",
  "- Your headline, purpose_statement, execution_summary, and non_obvious_insight must avoid reusing the opening phrasings, metaphors, or framings that appear in priorHeadlines. If this session genuinely echoes a prior pattern, describe the continuation in fresh language rather than restating the previous phrasing.",
  "- Reusing concrete numbers, dates, or session names is fine — only the prose framings must be different."
].join("\n");
