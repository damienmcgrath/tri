import type { SupabaseClient } from "@supabase/supabase-js";

export type TrendDirection = "improving" | "declining" | "stable";
export type TrendConfidence = "low" | "medium" | "high";

export type WeeklyTrend = {
  metric: string;
  sport: string;
  direction: TrendDirection;
  dataPoints: Array<{ weekStart: string; value: number; label: string }>;
  detail: string;
  confidence: TrendConfidence;
};

type ActivityMetricsRow = {
  start_time_utc: string;
  sport_type: string;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  metrics_v2: Record<string, unknown> | null;
};

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function inferDirection(values: number[], lowerIsBetter: boolean): TrendDirection {
  if (values.length < 3) return "stable";

  // Use last 3 data points for trend direction
  const recent = values.slice(-3);
  const deltas: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    deltas.push(recent[i] - recent[i - 1]);
  }

  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const range = Math.max(...values) - Math.min(...values);
  const relativeChange = range > 0 ? Math.abs(avgDelta) / range : 0;

  // Only call it a trend if the change is meaningful (>10% of range)
  if (relativeChange < 0.1) return "stable";

  const isGoingUp = avgDelta > 0;
  if (lowerIsBetter) {
    return isGoingUp ? "declining" : "improving";
  } else {
    return isGoingUp ? "improving" : "declining";
  }
}

function inferConfidence(dataPointCount: number, consistentDirectionCount: number): TrendConfidence {
  if (dataPointCount >= 5 && consistentDirectionCount >= 4) return "high";
  if (dataPointCount >= 4 && consistentDirectionCount >= 3) return "medium";
  return "low";
}

function countConsistentDirections(values: number[]): number {
  if (values.length < 2) return 0;
  let count = 0;
  const firstDir = values[1] - values[0] > 0 ? 1 : -1;
  for (let i = 1; i < values.length; i++) {
    const dir = values[i] - values[i - 1] > 0 ? 1 : -1;
    if (dir === firstDir) count++;
  }
  return count;
}

function buildTrend(params: {
  metric: string;
  sport: string;
  lowerIsBetter: boolean;
  dataPoints: Array<{ weekStart: string; value: number; label: string }>;
  detail: (direction: TrendDirection, values: number[]) => string;
}): WeeklyTrend | null {
  const { metric, lowerIsBetter, dataPoints } = params;
  if (dataPoints.length < 3) return null;

  const values = dataPoints.map((d) => d.value);
  const direction = inferDirection(values, lowerIsBetter);
  const consistent = countConsistentDirections(values);
  const confidence = inferConfidence(dataPoints.length, consistent);

  // Only surface improving or declining trends with at least medium confidence
  if (direction === "stable" && confidence === "low") return null;

  return {
    metric,
    sport: params.sport,
    direction,
    dataPoints,
    detail: params.detail(direction, values),
    confidence
  };
}

export async function detectTrends(
  supabase: SupabaseClient,
  athleteId: string,
  weekCount = 6
): Promise<WeeklyTrend[]> {
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(new Date().getTime() - weekCount * 7 * 86400000).toISOString().slice(0, 10);

  const { data: activities } = await supabase
    .from("completed_activities")
    .select("start_time_utc,sport_type,avg_hr,avg_power,avg_pace_per_100m_sec,duration_sec,distance_m,metrics_v2")
    .eq("user_id", athleteId)
    .gte("start_time_utc", `${startDate}T00:00:00.000Z`)
    .lte("start_time_utc", `${endDate}T23:59:59.999Z`)
    .order("start_time_utc", { ascending: true });

  if (!activities || activities.length < 3) return [];

  const rows = activities as ActivityMetricsRow[];

  // Group by week start
  const byWeek = new Map<string, ActivityMetricsRow[]>();
  for (const row of rows) {
    const week = getMonday(new Date(row.start_time_utc));
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week)!.push(row);
  }

  const weeks = Array.from(byWeek.keys()).sort();
  if (weeks.length < 3) return [];

  const trends: WeeklyTrend[] = [];

  // Trend 1: Avg HR for runs
  const runHrPoints: Array<{ weekStart: string; value: number; label: string }> = [];
  for (const week of weeks) {
    const weekRuns = byWeek.get(week)!.filter((r) => r.sport_type === "run" && r.avg_hr != null);
    if (weekRuns.length === 0) continue;
    const avgHr = weekRuns.reduce((s, r) => s + r.avg_hr!, 0) / weekRuns.length;
    runHrPoints.push({ weekStart: week, value: Math.round(avgHr), label: `${Math.round(avgHr)} bpm` });
  }

  const runHrTrend = buildTrend({
    metric: "Run avg HR",
    sport: "run",
    lowerIsBetter: true,
    dataPoints: runHrPoints,
    detail: (dir) =>
      dir === "improving"
        ? "Average HR during runs is trending down — cardiac efficiency improving."
        : dir === "declining"
          ? "Average HR during runs is trending up — watch for accumulated fatigue."
          : "Run HR is stable."
  });
  if (runHrTrend) trends.push(runHrTrend);

  // Trend 2: Run pace (lower sec/km = faster = better)
  const runPacePoints: Array<{ weekStart: string; value: number; label: string }> = [];
  for (const week of weeks) {
    const weekRuns = byWeek.get(week)!.filter((r) => r.sport_type === "run" && r.distance_m && r.duration_sec);
    if (weekRuns.length === 0) continue;
    const totalDist = weekRuns.reduce((s, r) => s + (r.distance_m ?? 0), 0);
    const totalDur = weekRuns.reduce((s, r) => s + (r.duration_sec ?? 0), 0);
    if (totalDist < 100) continue;
    const secPerKm = (totalDur / totalDist) * 1000;
    const mins = Math.floor(secPerKm / 60);
    const secs = Math.round(secPerKm % 60);
    runPacePoints.push({ weekStart: week, value: secPerKm, label: `${mins}:${secs.toString().padStart(2, "0")}/km` });
  }

  const runPaceTrend = buildTrend({
    metric: "Run pace",
    sport: "run",
    lowerIsBetter: true,
    dataPoints: runPacePoints,
    detail: (dir) =>
      dir === "improving"
        ? "Run pace is improving week over week."
        : dir === "declining"
          ? "Run pace is slowing — could indicate fatigue or volume accumulation."
          : "Run pace is consistent."
  });
  if (runPaceTrend) trends.push(runPaceTrend);

  // Trend 3: Bike avg power
  const bikePowerPoints: Array<{ weekStart: string; value: number; label: string }> = [];
  for (const week of weeks) {
    const weekBikes = byWeek.get(week)!.filter((r) => (r.sport_type === "bike" || r.sport_type === "cycling") && r.avg_power);
    if (weekBikes.length === 0) continue;
    const avgPower = weekBikes.reduce((s, r) => s + (r.avg_power ?? 0), 0) / weekBikes.length;
    bikePowerPoints.push({ weekStart: week, value: Math.round(avgPower), label: `${Math.round(avgPower)} W` });
  }

  const bikePowerTrend = buildTrend({
    metric: "Bike avg power",
    sport: "bike",
    lowerIsBetter: false,
    dataPoints: bikePowerPoints,
    detail: (dir) =>
      dir === "improving"
        ? "Cycling power output is trending up — fitness building as expected."
        : dir === "declining"
          ? "Cycling power is trending down — check for fatigue or reduced training quality."
          : "Cycling power is consistent."
  });
  if (bikePowerTrend) trends.push(bikePowerTrend);

  // Trend 4: Swim pace (lower sec/100m = faster = better)
  const swimPacePoints: Array<{ weekStart: string; value: number; label: string }> = [];
  for (const week of weeks) {
    const weekSwims = byWeek.get(week)!.filter((r) => r.sport_type === "swim" && r.avg_pace_per_100m_sec);
    if (weekSwims.length === 0) continue;
    const avgPace = weekSwims.reduce((s, r) => s + (r.avg_pace_per_100m_sec ?? 0), 0) / weekSwims.length;
    const mins = Math.floor(avgPace / 60);
    const secs = Math.round(avgPace % 60);
    swimPacePoints.push({ weekStart: week, value: avgPace, label: `${mins}:${secs.toString().padStart(2, "0")}/100m` });
  }

  const swimPaceTrend = buildTrend({
    metric: "Swim pace",
    sport: "swim",
    lowerIsBetter: true,
    dataPoints: swimPacePoints,
    detail: (dir) =>
      dir === "improving"
        ? "Swim pace is getting faster week over week."
        : dir === "declining"
          ? "Swim pace is slowing — consider stroke efficiency work."
          : "Swim pace is consistent."
  });
  if (swimPaceTrend) trends.push(swimPaceTrend);

  // Trend 5: Strength session duration (longer = more consistent training)
  const strengthDurPoints: Array<{ weekStart: string; value: number; label: string }> = [];
  for (const week of weeks) {
    const weekStrength = byWeek.get(week)!.filter((r) => r.sport_type === "strength" && r.duration_sec);
    if (weekStrength.length === 0) continue;
    const avgDur = weekStrength.reduce((s, r) => s + (r.duration_sec ?? 0), 0) / weekStrength.length;
    const mins = Math.round(avgDur / 60);
    strengthDurPoints.push({ weekStart: week, value: avgDur, label: `${mins} min` });
  }

  const strengthDurTrend = buildTrend({
    metric: "Strength duration",
    sport: "strength",
    lowerIsBetter: false,
    dataPoints: strengthDurPoints,
    detail: (dir) =>
      dir === "improving"
        ? "Strength session duration is increasing — good consistency."
        : dir === "declining"
          ? "Strength sessions are getting shorter — consider protecting this time."
          : "Strength session duration is stable."
  });
  if (strengthDurTrend) trends.push(strengthDurTrend);

  // Return top 3 most confident trends
  return trends
    .sort((a, b) => {
      const order = { high: 3, medium: 2, low: 1 };
      const dirOrder = { improving: 2, declining: 2, stable: 1 };
      return order[b.confidence] - order[a.confidence] || dirOrder[b.direction] - dirOrder[a.direction];
    })
    .slice(0, 5);
}
