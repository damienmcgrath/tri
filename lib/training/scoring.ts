/**
 * Training Score engine: computes the tri.ai 3-dimension composite score.
 *
 * Dimensions:
 * 1. Execution Quality (0-100) — from session verdicts
 * 2. Progression Signal (0-100) — from session comparisons
 * 3. Balance Score (0-100) — from discipline balance
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  VERDICT_SCORE_MAP,
  TREND_SCORE_MAP,
  RACE_TYPE_DISTRIBUTIONS,
  DIMENSION_WEIGHTS,
  DIMENSION_WEIGHTS_NO_PROGRESSION,
  EXECUTION_WINDOW_DAYS,
  PROGRESSION_WINDOW_DAYS,
  BALANCE_WINDOW_DAYS,
  MIN_WEEKS_FOR_PROGRESSION,
  MIN_VERDICTS_FOR_EXECUTION
} from "./scoring-constants";

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type TrainingScore = {
  compositeScore: number;
  executionQuality: number | null;
  executionInputs: { verdictCount: number; keyVerdictCount: number } | null;
  progressionSignal: number | null;
  progressionInputs: { comparisonCount: number; improvingCount: number } | null;
  progressionActive: boolean;
  balanceScore: number | null;
  balanceInputs: { actualDistribution: Record<string, number>; idealDistribution: Record<string, number> } | null;
  scoreDelta7d: number | null;
  scoreDelta28d: number | null;
  goalRaceType: string | null;
};

/**
 * Compute Execution Quality (0-100) from session verdicts in a rolling window.
 */
export async function computeExecutionQuality(
  supabase: SupabaseClient,
  userId: string,
  date: string
): Promise<{ score: number; inputs: { verdictCount: number; keyVerdictCount: number } } | null> {
  const windowStart = addDaysIso(date, -EXECUTION_WINDOW_DAYS);

  const { data: verdicts } = await supabase
    .from("session_verdicts")
    .select("verdict_status,discipline,created_at,session_id")
    .eq("user_id", userId)
    .gte("created_at", `${windowStart}T00:00:00.000Z`)
    .lte("created_at", `${date}T23:59:59.999Z`)
    .order("created_at", { ascending: false });

  if (!verdicts || verdicts.length < MIN_VERDICTS_FOR_EXECUTION) return null;

  // Check which sessions are key
  const sessionIds = verdicts.map((v: Record<string, unknown>) => v.session_id as string);
  const { data: sessionData } = await supabase
    .from("sessions")
    .select("id,is_key")
    .in("id", sessionIds);

  const keySessionSet = new Set(
    (sessionData ?? [])
      .filter((s: Record<string, unknown>) => Boolean(s.is_key))
      .map((s: Record<string, unknown>) => s.id as string)
  );

  let totalWeight = 0;
  let weightedScore = 0;

  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i] as Record<string, unknown>;
    const status = v.verdict_status as string;
    const sessionId = v.session_id as string;
    const isKey = keySessionSet.has(sessionId);

    // Recency weight: most recent gets 1.0, oldest gets 0.5
    const recencyWeight = 1.0 - (i / verdicts.length) * 0.5;
    const keyWeight = isKey ? 2.0 : 1.0;
    const weight = recencyWeight * keyWeight;

    const score = VERDICT_SCORE_MAP[status] ?? 50;
    weightedScore += score * weight;
    totalWeight += weight;
  }

  const executionQuality = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;

  return {
    score: Math.max(0, Math.min(100, executionQuality)),
    inputs: {
      verdictCount: verdicts.length,
      keyVerdictCount: keySessionSet.size
    }
  };
}

/**
 * Compute Progression Signal (0-100) from session comparisons.
 */
export async function computeProgressionSignal(
  supabase: SupabaseClient,
  userId: string,
  date: string
): Promise<{ score: number; active: boolean; inputs: { comparisonCount: number; improvingCount: number } } | null> {
  const windowStart = addDaysIso(date, -PROGRESSION_WINDOW_DAYS);

  const { data: comparisons } = await supabase
    .from("session_comparisons")
    .select("trend_direction,trend_confidence,created_at")
    .eq("user_id", userId)
    .gte("created_at", `${windowStart}T00:00:00.000Z`)
    .lte("created_at", `${date}T23:59:59.999Z`);

  if (!comparisons || comparisons.length === 0) {
    return { score: 50, active: false, inputs: { comparisonCount: 0, improvingCount: 0 } };
  }

  // Check if we have at least MIN_WEEKS_FOR_PROGRESSION weeks of data
  const dates = comparisons.map((c: Record<string, unknown>) =>
    ((c.created_at as string) ?? "").slice(0, 10)
  );
  const uniqueWeeks = new Set(dates.map((d) => {
    const dt = new Date(`${d}T00:00:00.000Z`);
    const day = dt.getUTCDay();
    const offset = day === 0 ? -6 : 1 - day;
    dt.setUTCDate(dt.getUTCDate() + offset);
    return dt.toISOString().slice(0, 10);
  }));

  const active = uniqueWeeks.size >= MIN_WEEKS_FOR_PROGRESSION;

  let totalScore = 0;
  let improvingCount = 0;

  for (const comp of comparisons as Array<Record<string, unknown>>) {
    const direction = (comp.trend_direction as string) ?? "insufficient_data";
    const confidence = (comp.trend_confidence as string) ?? "low";
    const scoreMap = TREND_SCORE_MAP[direction] ?? TREND_SCORE_MAP.insufficient_data;
    totalScore += scoreMap[confidence] ?? 50;
    if (direction === "improving") improvingCount++;
  }

  const avgScore = Math.round(totalScore / comparisons.length);

  return {
    score: Math.max(0, Math.min(100, avgScore)),
    active,
    inputs: {
      comparisonCount: comparisons.length,
      improvingCount
    }
  };
}

/**
 * Compute Balance Score (0-100) from discipline distribution.
 */
export async function computeBalanceScore(
  supabase: SupabaseClient,
  userId: string,
  date: string,
  goalRaceType: string | null
): Promise<{ score: number; inputs: { actualDistribution: Record<string, number>; idealDistribution: Record<string, number> } }> {
  const windowStart = addDaysIso(date, -BALANCE_WINDOW_DAYS);

  // Get actual training distribution from session_load
  const { data: loads } = await supabase
    .from("session_load")
    .select("sport,duration_sec")
    .eq("user_id", userId)
    .gte("date", windowStart)
    .lte("date", date);

  const sportMinutes: Record<string, number> = {};
  let totalMinutes = 0;

  for (const row of (loads ?? []) as Array<Record<string, unknown>>) {
    const sport = (row.sport as string) ?? "other";
    const minutes = ((row.duration_sec as number) ?? 0) / 60;
    if (sport === "swim" || sport === "bike" || sport === "run") {
      sportMinutes[sport] = (sportMinutes[sport] ?? 0) + minutes;
      totalMinutes += minutes;
    }
  }

  // If no data, fall back to planned sessions
  if (totalMinutes === 0) {
    const { data: planned } = await supabase
      .from("sessions")
      .select("sport,duration_minutes,status")
      .eq("user_id", userId)
      .gte("date", windowStart)
      .lte("date", date);

    for (const row of (planned ?? []) as Array<Record<string, unknown>>) {
      const sport = (row.sport as string) ?? "other";
      const minutes = (row.duration_minutes as number) ?? 0;
      if (sport === "swim" || sport === "bike" || sport === "run") {
        sportMinutes[sport] = (sportMinutes[sport] ?? 0) + minutes;
        totalMinutes += minutes;
      }
    }
  }

  if (totalMinutes === 0) {
    return {
      score: 50,
      inputs: {
        actualDistribution: { swim: 0, bike: 0, run: 0 },
        idealDistribution: RACE_TYPE_DISTRIBUTIONS[goalRaceType ?? "general"] ?? RACE_TYPE_DISTRIBUTIONS.general
      }
    };
  }

  const actual: Record<string, number> = {
    swim: (sportMinutes.swim ?? 0) / totalMinutes,
    bike: (sportMinutes.bike ?? 0) / totalMinutes,
    run: (sportMinutes.run ?? 0) / totalMinutes
  };

  const ideal = RACE_TYPE_DISTRIBUTIONS[goalRaceType ?? "general"] ?? RACE_TYPE_DISTRIBUTIONS.general;

  // Compute balance score: 100 minus penalty for deviation from ideal
  let totalDeviation = 0;
  for (const sport of ["swim", "bike", "run"]) {
    totalDeviation += Math.abs((actual[sport] ?? 0) - (ideal[sport as keyof typeof ideal] ?? 0));
  }

  // Max possible deviation is 2.0 (completely wrong distribution)
  // Scale so small deviations don't penalize too much
  const deviationPenalty = Math.min(100, Math.round(totalDeviation * 100));
  const score = Math.max(0, 100 - deviationPenalty);

  return {
    score,
    inputs: {
      actualDistribution: {
        swim: Math.round((actual.swim ?? 0) * 100) / 100,
        bike: Math.round((actual.bike ?? 0) * 100) / 100,
        run: Math.round((actual.run ?? 0) * 100) / 100
      },
      idealDistribution: ideal
    }
  };
}

/**
 * Compute the full Training Score and store it.
 */
export async function computeTrainingScore(
  supabase: SupabaseClient,
  userId: string,
  date: string
): Promise<TrainingScore> {
  // Get goal race type from profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("race_name")
    .eq("id", userId)
    .maybeSingle();

  const raceName = ((profile?.race_name as string) ?? "").toLowerCase();
  const goalRaceType = raceName.includes("ironman") && !raceName.includes("70.3")
    ? "ironman"
    : raceName.includes("70.3")
      ? "70.3"
      : raceName.includes("olympic")
        ? "olympic"
        : raceName.includes("sprint")
          ? "sprint"
          : null;

  // Compute all three dimensions in parallel
  const [executionResult, progressionResult, balanceResult] = await Promise.all([
    computeExecutionQuality(supabase, userId, date),
    computeProgressionSignal(supabase, userId, date),
    computeBalanceScore(supabase, userId, date, goalRaceType)
  ]);

  const progressionActive = progressionResult?.active ?? false;

  // Compute composite score
  let compositeScore: number;
  if (progressionActive && executionResult && progressionResult) {
    compositeScore = Math.round(
      (executionResult.score * DIMENSION_WEIGHTS.execution) +
      (progressionResult.score * DIMENSION_WEIGHTS.progression) +
      (balanceResult.score * DIMENSION_WEIGHTS.balance)
    );
  } else if (executionResult) {
    compositeScore = Math.round(
      (executionResult.score * DIMENSION_WEIGHTS_NO_PROGRESSION.execution) +
      (balanceResult.score * DIMENSION_WEIGHTS_NO_PROGRESSION.balance)
    );
  } else {
    compositeScore = balanceResult.score;
  }

  compositeScore = Math.max(0, Math.min(100, compositeScore));

  // Fetch historical scores for deltas
  const [{ data: score7d }, { data: score28d }] = await Promise.all([
    supabase
      .from("training_scores")
      .select("composite_score")
      .eq("user_id", userId)
      .eq("score_date", addDaysIso(date, -7))
      .maybeSingle(),
    supabase
      .from("training_scores")
      .select("composite_score")
      .eq("user_id", userId)
      .eq("score_date", addDaysIso(date, -28))
      .maybeSingle()
  ]);

  const scoreDelta7d = score7d ? Math.round(compositeScore - (score7d.composite_score as number)) : null;
  const scoreDelta28d = score28d ? Math.round(compositeScore - (score28d.composite_score as number)) : null;

  // Store
  await supabase
    .from("training_scores")
    .upsert(
      {
        user_id: userId,
        score_date: date,
        composite_score: compositeScore,
        execution_quality: executionResult?.score ?? null,
        execution_inputs: executionResult?.inputs ?? null,
        progression_signal: progressionResult?.score ?? null,
        progression_inputs: progressionResult?.inputs ?? null,
        progression_active: progressionActive,
        balance_score: balanceResult.score,
        balance_inputs: balanceResult.inputs,
        goal_race_type: goalRaceType,
        score_delta_7d: scoreDelta7d,
        score_delta_28d: scoreDelta28d
      },
      { onConflict: "user_id,score_date" }
    );

  return {
    compositeScore,
    executionQuality: executionResult?.score ?? null,
    executionInputs: executionResult?.inputs ?? null,
    progressionSignal: progressionResult?.score ?? null,
    progressionInputs: progressionResult?.inputs ?? null,
    progressionActive,
    balanceScore: balanceResult.score,
    balanceInputs: balanceResult.inputs,
    scoreDelta7d,
    scoreDelta28d,
    goalRaceType
  };
}

/**
 * Get an existing training score for a date.
 */
export async function getTrainingScore(
  supabase: SupabaseClient,
  userId: string,
  date: string
): Promise<TrainingScore | null> {
  const { data } = await supabase
    .from("training_scores")
    .select("*")
    .eq("user_id", userId)
    .eq("score_date", date)
    .maybeSingle();

  if (!data) return null;

  return {
    compositeScore: data.composite_score as number,
    executionQuality: (data.execution_quality as number | null) ?? null,
    executionInputs: (data.execution_inputs as TrainingScore["executionInputs"]) ?? null,
    progressionSignal: (data.progression_signal as number | null) ?? null,
    progressionInputs: (data.progression_inputs as TrainingScore["progressionInputs"]) ?? null,
    progressionActive: Boolean(data.progression_active),
    balanceScore: (data.balance_score as number | null) ?? null,
    balanceInputs: (data.balance_inputs as TrainingScore["balanceInputs"]) ?? null,
    scoreDelta7d: (data.score_delta_7d as number | null) ?? null,
    scoreDelta28d: (data.score_delta_28d as number | null) ?? null,
    goalRaceType: (data.goal_race_type as string | null) ?? null
  };
}
