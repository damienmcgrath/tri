import type { SupabaseClient } from "@supabase/supabase-js";

export type HistoricalComparable = {
  sessionId: string;
  date: string;
  title: string | null;
  durationMin: number | null;
  avgHr: number | null;
  avgPower: number | null;
  avgPaceSPerKm: number | null;
  avgPacePer100mSec: number | null;
  intentMatch: "on_target" | "partial" | "missed" | "unknown";
  executionScore: number | null;
  /** Human-readable summary of what executed well or missed, pulled from the stored review. */
  takeaway: string | null;
};

type RawExecutionResult = {
  executionScore?: unknown;
  intentMatchStatus?: unknown;
  status?: unknown;
  avgHr?: unknown;
  avgPower?: unknown;
  avgPaceSPerKm?: unknown;
  avgPacePer100mSec?: unknown;
  summary?: unknown;
  executionSummary?: unknown;
  verdict?: { sessionVerdict?: { headline?: unknown; summary?: unknown } };
};

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeIntentMatch(status: unknown): HistoricalComparable["intentMatch"] {
  if (status === "matched_intent") return "on_target";
  if (status === "partial_intent") return "partial";
  if (status === "missed_intent") return "missed";
  return "unknown";
}

function pickTakeaway(result: RawExecutionResult): string | null {
  const verdictSummary = result.verdict?.sessionVerdict?.summary;
  if (typeof verdictSummary === "string" && verdictSummary.trim().length > 0) return verdictSummary.trim().slice(0, 200);
  if (typeof result.executionSummary === "string" && result.executionSummary.trim().length > 0) return result.executionSummary.trim().slice(0, 200);
  if (typeof result.summary === "string" && result.summary.trim().length > 0) return result.summary.trim().slice(0, 200);
  return null;
}

/**
 * Fetch up to `limit` previous completed sessions matching the same sport and
 * intent_category, strictly before the target date. Used by the session reviewer
 * to compare "this threshold bike" against the last 3-5 threshold bikes.
 *
 * Returns newest-first. Rows without an execution_result are skipped — they
 * carry no signal for comparison.
 */
export async function fetchHistoricalComparables(
  supabase: SupabaseClient,
  args: {
    athleteId: string;
    sport: string;
    intentCategory: string | null;
    beforeDate: string;
    excludeSessionId?: string;
    limit?: number;
  }
): Promise<HistoricalComparable[]> {
  if (!args.intentCategory) return [];
  const limit = args.limit ?? 4;

  let query = supabase
    .from("sessions")
    .select("id,date,session_name,type,duration_minutes,execution_result")
    .eq("athlete_id", args.athleteId)
    .eq("sport", args.sport)
    .eq("intent_category", args.intentCategory)
    .eq("status", "completed")
    .lt("date", args.beforeDate)
    .order("date", { ascending: false })
    .limit(limit * 2); // over-fetch then filter rows lacking execution_result

  if (args.excludeSessionId) {
    query = query.neq("id", args.excludeSessionId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const results: HistoricalComparable[] = [];
  for (const row of data) {
    const raw = (row as { execution_result: RawExecutionResult | null }).execution_result;
    if (!raw) continue;
    const intentMatch = normalizeIntentMatch(raw.intentMatchStatus ?? raw.status);
    results.push({
      sessionId: row.id as string,
      date: row.date as string,
      title: ((row.session_name as string | null) ?? (row.type as string | null)) ?? null,
      durationMin: toNumber(row.duration_minutes),
      avgHr: toNumber(raw.avgHr),
      avgPower: toNumber(raw.avgPower),
      avgPaceSPerKm: toNumber(raw.avgPaceSPerKm),
      avgPacePer100mSec: toNumber(raw.avgPacePer100mSec),
      intentMatch,
      executionScore: toNumber(raw.executionScore),
      takeaway: pickTakeaway(raw)
    });
    if (results.length >= limit) break;
  }
  return results;
}
