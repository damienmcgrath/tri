import type { SupabaseClient } from "@supabase/supabase-js";

export type TaperComplianceResult = {
  score: number | null;
  summary: string | null;
};

/**
 * Score how cleanly the athlete executed the 14 days of training that preceded
 * the race. Reads `sessions.execution_result` (set by the regular execution
 * review pipeline) and weights `on_target` = 1, `partial` = 0.5, `missed` = 0.
 *
 * Sessions without an `execution_result` (rest days, planned-but-uncompleted,
 * sessions still pending review) are excluded from both numerator and
 * denominator so a heavy taper week with rest days is not artificially
 * penalised. Returns `{ null, null }` when the window has zero scored sessions.
 */
export async function computeTaperCompliance(
  supabase: SupabaseClient,
  userId: string,
  raceDate: string
): Promise<TaperComplianceResult> {
  const windowStart = isoDateOffset(raceDate, -14);

  const { data: rows, error } = await supabase
    .from("sessions")
    .select("id, date, type, session_name, execution_result")
    .eq("user_id", userId)
    .gte("date", windowStart)
    .lt("date", raceDate);

  if (error || !rows) {
    return { score: null, summary: null };
  }

  let onTarget = 0;
  let partial = 0;
  let missed = 0;

  for (const row of rows) {
    const intentMatch = readIntentMatch(row.execution_result);
    if (intentMatch === "on_target") onTarget += 1;
    else if (intentMatch === "partial") partial += 1;
    else if (intentMatch === "missed") missed += 1;
  }

  const total = onTarget + partial + missed;
  if (total === 0) {
    return { score: null, summary: null };
  }

  const score = (onTarget + 0.5 * partial) / total;
  const summary = `${onTarget} of ${total} taper sessions on target`;

  return {
    score: Math.round(score * 1000) / 1000,
    summary
  };
}

function readIntentMatch(executionResult: unknown): "on_target" | "partial" | "missed" | null {
  if (!executionResult || typeof executionResult !== "object") return null;
  const value = (executionResult as Record<string, unknown>).intentMatch;
  if (value === "on_target" || value === "partial" || value === "missed") return value;
  return null;
}

function isoDateOffset(date: string, offsetDays: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
