import type { SupabaseClient } from "@supabase/supabase-js";
import { getNestedNumber } from "@/lib/workouts/metrics-v2";

export type BenchmarkHighlight = {
  sport: "run" | "bike" | "swim";
  label: string;
  value: number;               // raw numeric (sec/km, watts, sec/100m)
  formattedValue: string;      // e.g., "4:32/km"
  unitLabel: string;           // e.g., "/km", "W", "/100m"
  activityId: string;
  activityDate: string;        // ISO date string
  detail: string;              // e.g., "From 21.1km run on Mar 15"
  isThisWeek: boolean;
  deltaVsPriorBlock?: number;  // improvement vs prior 12-week window
  deltaLabel?: string;         // e.g., "12s/km faster than previous block"
};

type ActivityRow = {
  id: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  moving_duration_sec: number | null;
  distance_m: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec: number | null;
  metrics_v2: Record<string, unknown> | null;
};

function formatPaceMinSec(secPerUnit: number, unit: string): string {
  const mins = Math.floor(secPerUnit / 60);
  const secs = Math.round(secPerUnit % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}${unit}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function effectiveDurationSec(row: ActivityRow): number | null {
  return row.moving_duration_sec ?? row.duration_sec;
}

function getBikeNormalizedPower(row: ActivityRow): number | null {
  return getNestedNumber(row.metrics_v2, [["power", "normalizedPower"], ["power", "normalized_power"]]) ?? row.avg_power;
}

function buildRunBenchmark(rows: ActivityRow[], weekStart: string, weekEnd: string): BenchmarkHighlight | null {
  const qualifying = rows.filter(
    (r) => r.sport_type === "run" && (r.distance_m ?? 0) >= 5000 && effectiveDurationSec(r) != null
  );
  if (qualifying.length === 0) return null;

  // Best = lowest pace (sec/km)
  let best: ActivityRow | null = null;
  let bestPace = Infinity;

  for (const row of qualifying) {
    const dur = effectiveDurationSec(row)!;
    const dist = row.distance_m!;
    const pace = (dur / dist) * 1000;
    if (pace < bestPace) {
      bestPace = pace;
      best = row;
    }
  }

  if (!best) return null;

  const distKm = ((best.distance_m ?? 0) / 1000).toFixed(1);
  const date = best.start_time_utc.slice(0, 10);

  return {
    sport: "run",
    label: "Best run pace",
    value: bestPace,
    formattedValue: formatPaceMinSec(bestPace, "/km"),
    unitLabel: "/km",
    activityId: best.id,
    activityDate: date,
    detail: `From ${distKm}km run on ${formatShortDate(date)}`,
    isThisWeek: date >= weekStart && date <= weekEnd
  };
}

function buildBikeBenchmark(rows: ActivityRow[], weekStart: string, weekEnd: string): BenchmarkHighlight | null {
  const qualifying = rows.filter(
    (r) => r.sport_type === "bike" && (effectiveDurationSec(r) ?? 0) >= 1200
  );
  if (qualifying.length === 0) return null;

  // Best = highest normalized power (or avg_power fallback)
  let best: ActivityRow | null = null;
  let bestPower = -Infinity;

  for (const row of qualifying) {
    const power = getBikeNormalizedPower(row);
    if (power != null && power > bestPower) {
      bestPower = power;
      best = row;
    }
  }

  if (!best || bestPower <= 0) return null;

  const durSec = effectiveDurationSec(best)!;
  const hours = Math.floor(durSec / 3600);
  const mins = Math.floor((durSec % 3600) / 60);
  const durLabel = hours > 0 ? `${hours}h${mins > 0 ? `${mins}m` : ""}` : `${mins}m`;
  const date = best.start_time_utc.slice(0, 10);

  return {
    sport: "bike",
    label: "Best bike power",
    value: bestPower,
    formattedValue: `${Math.round(bestPower)}W`,
    unitLabel: "W",
    activityId: best.id,
    activityDate: date,
    detail: `From ${durLabel} ride on ${formatShortDate(date)}`,
    isThisWeek: date >= weekStart && date <= weekEnd
  };
}

function buildSwimBenchmark(rows: ActivityRow[], weekStart: string, weekEnd: string): BenchmarkHighlight | null {
  const qualifying = rows.filter(
    (r) => r.sport_type === "swim" && (r.distance_m ?? 0) >= 400 && r.avg_pace_per_100m_sec != null
  );
  if (qualifying.length === 0) return null;

  // Best = lowest pace (sec/100m)
  let best: ActivityRow | null = null;
  let bestPace = Infinity;

  for (const row of qualifying) {
    const pace = row.avg_pace_per_100m_sec!;
    if (pace < bestPace) {
      bestPace = pace;
      best = row;
    }
  }

  if (!best) return null;

  const distM = best.distance_m ?? 0;
  const date = best.start_time_utc.slice(0, 10);

  return {
    sport: "swim",
    label: "Best swim pace",
    value: bestPace,
    formattedValue: formatPaceMinSec(bestPace, "/100m"),
    unitLabel: "/100m",
    activityId: best.id,
    activityDate: date,
    detail: `From ${distM}m swim on ${formatShortDate(date)}`,
    isThisWeek: date >= weekStart && date <= weekEnd
  };
}

function applyPriorBlockDelta(
  current: BenchmarkHighlight,
  priorRows: ActivityRow[]
): BenchmarkHighlight {
  let priorValue: number | null = null;

  if (current.sport === "run") {
    const qualifying = priorRows.filter(
      (r) => r.sport_type === "run" && (r.distance_m ?? 0) >= 5000 && effectiveDurationSec(r) != null
    );
    let best = Infinity;
    for (const row of qualifying) {
      const pace = (effectiveDurationSec(row)! / row.distance_m!) * 1000;
      if (pace < best) best = pace;
    }
    if (best < Infinity) priorValue = best;
  } else if (current.sport === "bike") {
    const qualifying = priorRows.filter(
      (r) => r.sport_type === "bike" && (effectiveDurationSec(r) ?? 0) >= 1200
    );
    let best = -Infinity;
    for (const row of qualifying) {
      const power = getBikeNormalizedPower(row);
      if (power != null && power > best) best = power;
    }
    if (best > -Infinity) priorValue = best;
  } else if (current.sport === "swim") {
    const qualifying = priorRows.filter(
      (r) => r.sport_type === "swim" && (r.distance_m ?? 0) >= 400 && r.avg_pace_per_100m_sec != null
    );
    let best = Infinity;
    for (const row of qualifying) {
      if (row.avg_pace_per_100m_sec! < best) best = row.avg_pace_per_100m_sec!;
    }
    if (best < Infinity) priorValue = best;
  }

  if (priorValue == null) return current;

  // For pace metrics (lower is better): delta = prior - current (positive = faster)
  // For power metrics (higher is better): delta = current - prior (positive = stronger)
  let delta: number;
  let deltaLabel: string;

  if (current.sport === "run") {
    delta = priorValue - current.value;
    const absDelta = Math.abs(Math.round(delta));
    if (delta > 0) {
      deltaLabel = `${absDelta}s/km faster than previous block`;
    } else if (delta < 0) {
      deltaLabel = `${absDelta}s/km slower than previous block`;
    } else {
      return current;
    }
  } else if (current.sport === "bike") {
    delta = current.value - priorValue;
    const absDelta = Math.abs(Math.round(delta));
    if (delta > 0) {
      deltaLabel = `${absDelta}W higher than previous block`;
    } else if (delta < 0) {
      deltaLabel = `${absDelta}W lower than previous block`;
    } else {
      return current;
    }
  } else {
    // swim
    delta = priorValue - current.value;
    const absDelta = Math.abs(Math.round(delta));
    if (delta > 0) {
      deltaLabel = `${absDelta}s/100m faster than previous block`;
    } else if (delta < 0) {
      deltaLabel = `${absDelta}s/100m slower than previous block`;
    } else {
      return current;
    }
  }

  return { ...current, deltaVsPriorBlock: delta, deltaLabel };
}

async function fetchActivities(
  supabase: SupabaseClient,
  athleteId: string,
  from: string,
  to: string
): Promise<ActivityRow[]> {
  const { data } = await supabase
    .from("completed_activities")
    .select("id,sport_type,start_time_utc,duration_sec,moving_duration_sec,distance_m,avg_power,avg_pace_per_100m_sec,metrics_v2")
    .eq("user_id", athleteId)
    .in("sport_type", ["run", "bike", "swim"])
    .gte("start_time_utc", `${from}T00:00:00.000Z`)
    .lte("start_time_utc", `${to}T23:59:59.999Z`)
    .order("start_time_utc", { ascending: true });

  return (data ?? []) as ActivityRow[];
}

export async function deriveBenchmarks(
  supabase: SupabaseClient,
  athleteId: string,
  weekStart: string,
  weekEnd: string,
  windowWeeks = 12
): Promise<BenchmarkHighlight[]> {
  // Current block: weekEnd - windowWeeks → weekEnd
  const currentFrom = new Date(new Date(`${weekEnd}T00:00:00.000Z`).getTime() - windowWeeks * 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  const currentRows = await fetchActivities(supabase, athleteId, currentFrom, weekEnd);
  if (currentRows.length === 0) return [];

  const runBenchmark = buildRunBenchmark(currentRows, weekStart, weekEnd);
  const bikeBenchmark = buildBikeBenchmark(currentRows, weekStart, weekEnd);
  const swimBenchmark = buildSwimBenchmark(currentRows, weekStart, weekEnd);

  const benchmarks = [runBenchmark, bikeBenchmark, swimBenchmark].filter(
    (b): b is BenchmarkHighlight => b != null
  );

  if (benchmarks.length === 0) return [];

  // Prior block: weeks 13–24 before weekEnd
  const priorTo = new Date(new Date(`${currentFrom}T00:00:00.000Z`).getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
  const priorFrom = new Date(new Date(`${priorTo}T00:00:00.000Z`).getTime() - windowWeeks * 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  const priorRows = await fetchActivities(supabase, athleteId, priorFrom, priorTo);

  return benchmarks.map((b) =>
    priorRows.length > 0 ? applyPriorBlockDelta(b, priorRows) : b
  );
}
