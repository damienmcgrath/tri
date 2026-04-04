import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSessionComparison,
  type MetricDelta,
  type SessionComparison
} from "@/lib/training/session-comparison";
import {
  generateComparisonNarrative,
  SESSION_COMPARISON_NARRATIVE_PROMPT_VERSION,
  type ComparisonNarrativeContext
} from "@/lib/ai/prompts/session-comparison-narrative";
import { getCoachModel } from "@/lib/openai";

export type StoredComparison = {
  id: string;
  currentSessionId: string;
  comparisonSessionId: string;
  matchScore: number;
  matchFactors: Record<string, number>;
  comparisonSummary: string;
  metricDeltas: MetricDelta[];
  trendDirection: "improving" | "stable" | "declining" | "insufficient_data";
  trendConfidence: "high" | "moderate" | "low";
  weeksApart: number;
  discipline: string;
  sessionType: string;
  comparisonRange: "recent" | "extended";
};

type SessionRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  intent_category?: string | null;
  duration_minutes: number | null;
  status: string | null;
  is_key?: boolean | null;
};

function computeWeeksApart(date1: string, date2: string): number {
  const d1 = new Date(`${date1}T00:00:00.000Z`);
  const d2 = new Date(`${date2}T00:00:00.000Z`);
  return Math.round(Math.abs(d1.getTime() - d2.getTime()) / (7 * 86400000));
}

function computeMatchScore(
  current: SessionRow,
  candidate: SessionRow
): { score: number; factors: Record<string, number> } {
  const factors: Record<string, number> = {};

  // Discipline match (required)
  factors.discipline = current.sport === candidate.sport ? 1.0 : 0.0;
  if (factors.discipline === 0) return { score: 0, factors };

  // Session type match
  factors.session_type =
    current.type === candidate.type
      ? 1.0
      : current.intent_category && current.intent_category === candidate.intent_category
        ? 0.8
        : 0.4;

  // Duration match (within ±20%)
  if (current.duration_minutes && candidate.duration_minutes) {
    const ratio = candidate.duration_minutes / current.duration_minutes;
    if (ratio >= 0.8 && ratio <= 1.2) {
      factors.duration = 1.0 - Math.abs(1 - ratio) / 0.2;
    } else {
      factors.duration = Math.max(0, 0.5 - Math.abs(1 - ratio));
    }
  } else {
    factors.duration = 0.5; // Unknown — neutral
  }

  // Compute weighted score
  const score =
    factors.discipline * 0.3 +
    factors.session_type * 0.45 +
    factors.duration * 0.25;

  return { score, factors };
}

/**
 * Find comparable sessions for a given session. Returns up to 2:
 * one "recent" (1-3 weeks) and one "extended" (4-8 weeks).
 */
export async function findComparableSessions(
  supabase: SupabaseClient,
  sessionId: string,
  athleteId: string
): Promise<Array<{ session: SessionRow; matchScore: number; matchFactors: Record<string, number>; range: "recent" | "extended" }>> {
  const { data: currentData } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,intent_category,duration_minutes,status,is_key")
    .eq("id", sessionId)
    .eq("user_id", athleteId)
    .maybeSingle();

  if (!currentData) return [];
  const current = currentData as SessionRow;
  if (current.status !== "completed") return [];

  // Find candidates: same sport, completed, before current date, within 8 weeks
  const eightWeeksAgo = (() => {
    const d = new Date(`${current.date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 56);
    return d.toISOString().slice(0, 10);
  })();

  const { data: candidates } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,intent_category,duration_minutes,status,is_key")
    .eq("user_id", athleteId)
    .eq("sport", current.sport)
    .eq("status", "completed")
    .lt("date", current.date)
    .gte("date", eightWeeksAgo)
    .order("date", { ascending: false })
    .limit(20);

  if (!candidates || candidates.length === 0) return [];

  // Score and sort candidates
  const scored = (candidates as SessionRow[])
    .map((candidate) => {
      const { score, factors } = computeMatchScore(current, candidate);
      const weeks = computeWeeksApart(current.date, candidate.date);
      const range: "recent" | "extended" = weeks <= 3 ? "recent" : "extended";
      return { session: candidate, matchScore: score, matchFactors: factors, range, weeks };
    })
    .filter((c) => c.matchScore >= 0.5)
    .sort((a, b) => b.matchScore - a.matchScore);

  // Pick best recent (1-3 weeks) and best extended (4-8 weeks)
  const results: Array<{ session: SessionRow; matchScore: number; matchFactors: Record<string, number>; range: "recent" | "extended" }> = [];
  const bestRecent = scored.find((c) => c.range === "recent");
  const bestExtended = scored.find((c) => c.range === "extended");

  if (bestRecent) results.push(bestRecent);
  if (bestExtended) results.push(bestExtended);

  return results;
}

/**
 * Generate and store a session comparison with AI narrative.
 */
export async function generateAndStoreComparison(
  supabase: SupabaseClient,
  currentSessionId: string,
  comparisonSessionId: string,
  athleteId: string,
  matchScore: number,
  matchFactors: Record<string, number>,
  range: "recent" | "extended"
): Promise<StoredComparison | null> {
  // Get the metric comparison using existing infrastructure
  const comparison = await getSessionComparison(supabase, currentSessionId, athleteId);
  if (!comparison || comparison.metrics.length === 0) return null;

  // Get session details for context
  const { data: currentSession } = await supabase
    .from("sessions")
    .select("sport,type,date,session_name,intent_category")
    .eq("id", currentSessionId)
    .maybeSingle();

  const { data: compSession } = await supabase
    .from("sessions")
    .select("date")
    .eq("id", comparisonSessionId)
    .maybeSingle();

  if (!currentSession || !compSession) return null;

  const weeksApart = computeWeeksApart(currentSession.date, compSession.date);

  // Generate AI narrative
  const narrativeCtx: ComparisonNarrativeContext = {
    discipline: currentSession.sport,
    sessionType: currentSession.type,
    weeksApart,
    trainingBlock: "Current block",
    metricDeltas: comparison.metrics
  };

  const narrative = await generateComparisonNarrative(narrativeCtx);

  // Store
  const { data: stored, error } = await supabase
    .from("session_comparisons")
    .upsert(
      {
        user_id: athleteId,
        current_session_id: currentSessionId,
        comparison_session_id: comparisonSessionId,
        match_score: matchScore,
        match_factors: matchFactors,
        comparison_summary: narrative.summary,
        metric_deltas: comparison.metrics,
        trend_direction: narrative.trend_direction,
        trend_confidence: narrative.trend_confidence,
        weeks_apart: weeksApart,
        discipline: currentSession.sport,
        session_type: currentSession.type,
        comparison_range: range
      },
      { onConflict: "id" }
    )
    .select("*")
    .maybeSingle();

  if (error || !stored) {
    console.warn("[session-comparison-engine] Failed to store comparison:", error?.message);
    return null;
  }

  return {
    id: stored.id,
    currentSessionId: stored.current_session_id,
    comparisonSessionId: stored.comparison_session_id,
    matchScore: stored.match_score,
    matchFactors: stored.match_factors as Record<string, number>,
    comparisonSummary: stored.comparison_summary,
    metricDeltas: stored.metric_deltas as MetricDelta[],
    trendDirection: stored.trend_direction,
    trendConfidence: stored.trend_confidence,
    weeksApart: stored.weeks_apart,
    discipline: stored.discipline,
    sessionType: stored.session_type,
    comparisonRange: stored.comparison_range
  };
}

/**
 * Trigger comparison generation after a session verdict is created.
 * Fire-and-forget — errors are logged but don't propagate.
 */
export async function triggerComparisonAfterVerdict(
  supabase: SupabaseClient,
  sessionId: string,
  athleteId: string
): Promise<void> {
  try {
    const comparables = await findComparableSessions(supabase, sessionId, athleteId);
    if (comparables.length === 0) return;

    await Promise.allSettled(
      comparables.map((c) =>
        generateAndStoreComparison(
          supabase,
          sessionId,
          c.session.id,
          athleteId,
          c.matchScore,
          c.matchFactors,
          c.range
        )
      )
    );
  } catch (error) {
    console.warn("[session-comparison-engine] triggerComparisonAfterVerdict failed:", error);
  }
}

/**
 * Fetch stored comparisons for a session.
 */
export async function getStoredComparisons(
  supabase: SupabaseClient,
  sessionId: string,
  athleteId: string
): Promise<StoredComparison[]> {
  const { data } = await supabase
    .from("session_comparisons")
    .select("*")
    .eq("current_session_id", sessionId)
    .eq("user_id", athleteId)
    .order("comparison_range", { ascending: true });

  if (!data) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    currentSessionId: row.current_session_id as string,
    comparisonSessionId: row.comparison_session_id as string,
    matchScore: row.match_score as number,
    matchFactors: row.match_factors as Record<string, number>,
    comparisonSummary: row.comparison_summary as string,
    metricDeltas: row.metric_deltas as MetricDelta[],
    trendDirection: row.trend_direction as StoredComparison["trendDirection"],
    trendConfidence: row.trend_confidence as StoredComparison["trendConfidence"],
    weeksApart: row.weeks_apart as number,
    discipline: row.discipline as string,
    sessionType: row.session_type as string,
    comparisonRange: row.comparison_range as "recent" | "extended"
  }));
}
