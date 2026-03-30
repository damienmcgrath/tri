/**
 * Load sync: triggers after an activity is linked to compute + persist training load.
 *
 * Coordinates between:
 *   - lib/training/load.ts (TSS computation)
 *   - lib/training/fitness-model.ts (CTL/ATL/TSB update)
 *   - Supabase tables: session_load, daily_load, athlete_fitness
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTss, type AthleteThresholds, type MetricsInput, type Sport } from "@/lib/training/load";
import { computeDailyFitness, computeRampRate, SPORTS, type FitnessSport } from "@/lib/training/fitness-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityRow = {
  id: string;
  user_id: string;
  sport_type: string;
  date?: string;
  start_time_utc?: string;
  duration_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec?: number | null;
  metrics_v2: unknown;
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Compute and persist training load for a single completed activity.
 *
 * Call this after an activity is uploaded/linked or after execution result is built.
 */
export async function syncSessionLoad(
  supabase: SupabaseClient,
  userId: string,
  activityId: string,
  sessionId?: string | null,
  intentCategory?: string | null
): Promise<void> {
  // 1. Fetch the activity
  const { data: activity, error: actError } = await supabase
    .from("completed_activities")
    .select("id, user_id, sport_type, date, start_time_utc, duration_sec, avg_hr, max_hr, avg_power, avg_pace_per_100m_sec, metrics_v2")
    .eq("id", activityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (actError || !activity) return;

  // 2. Fetch athlete thresholds
  const thresholds = await getAthleteThresholds(supabase, userId);

  // 3. Compute TSS
  const sport = normalizeSport(activity.sport_type);
  const avgPaceSPerKm = getAvgRunPace(activity.metrics_v2);

  const metricsInput: MetricsInput = {
    metricsV2: activity.metrics_v2,
    sport,
    durationSec: activity.duration_sec,
    avgHr: activity.avg_hr,
    maxHr: activity.max_hr,
    avgPower: activity.avg_power,
    avgPaceSPerKm,
    avgPacePer100mSec: activity.avg_pace_per_100m_sec ?? null
  };

  const result = resolveTss(metricsInput, thresholds, intentCategory);
  const activityDate = activity.date
    ?? (activity.start_time_utc ? activity.start_time_utc.slice(0, 10) : new Date().toISOString().slice(0, 10));

  // 4. Upsert session_load
  const { error: loadError } = await supabase.from("session_load").upsert(
    {
      user_id: userId,
      activity_id: activityId,
      session_id: sessionId ?? null,
      sport,
      date: activityDate,
      tss: result.tss,
      tss_source: result.source,
      duration_sec: activity.duration_sec,
      intensity_factor: result.intensityFactor
    },
    { onConflict: "user_id,activity_id" }
  );

  if (loadError) {
    console.error("[load-sync] Failed to upsert session_load:", loadError.message);
    return;
  }

  // 5. Rebuild daily_load for this date
  await rebuildDailyLoad(supabase, userId, activityDate);

  // 6. Update athlete_fitness from this date forward
  await updateFitnessFromDate(supabase, userId, activityDate);
}

// ---------------------------------------------------------------------------
// Daily load aggregation
// ---------------------------------------------------------------------------

/**
 * Rebuild daily_load rows for a specific date by summing session_load.
 */
async function rebuildDailyLoad(
  supabase: SupabaseClient,
  userId: string,
  date: string
): Promise<void> {
  // Get all session_loads for this user + date
  const { data: loads, error } = await supabase
    .from("session_load")
    .select("sport, tss")
    .eq("user_id", userId)
    .eq("date", date);

  if (error) {
    console.error("[load-sync] Failed to fetch session_loads for daily rebuild:", error.message);
    return;
  }

  // Aggregate by sport
  const bySport: Record<string, { tss: number; count: number }> = {};
  let totalTss = 0;
  let totalCount = 0;

  for (const load of loads ?? []) {
    const sport = load.sport;
    const tss = Number(load.tss) || 0;
    if (!bySport[sport]) bySport[sport] = { tss: 0, count: 0 };
    bySport[sport].tss += tss;
    bySport[sport].count += 1;
    totalTss += tss;
    totalCount += 1;
  }

  // Upsert per-sport daily_load rows
  const rows = Object.entries(bySport).map(([sport, agg]) => ({
    user_id: userId,
    date,
    sport,
    tss: Math.round(agg.tss * 10) / 10,
    session_count: agg.count
  }));

  // Add total row
  rows.push({
    user_id: userId,
    date,
    sport: "total",
    tss: Math.round(totalTss * 10) / 10,
    session_count: totalCount
  });

  const { error: upsertError } = await supabase
    .from("daily_load")
    .upsert(rows, { onConflict: "user_id,date,sport" });

  if (upsertError) {
    console.error("[load-sync] Failed to upsert daily_load:", upsertError.message);
  }
}

// ---------------------------------------------------------------------------
// Incremental fitness update
// ---------------------------------------------------------------------------

/**
 * Update athlete_fitness from a specific date forward.
 * Only recomputes from the affected date — not the full history.
 */
async function updateFitnessFromDate(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string
): Promise<void> {
  // Get the day before to seed EMA
  const seedDate = prevDate(fromDate);
  const { data: seedRows } = await supabase
    .from("athlete_fitness")
    .select("sport, ctl, atl")
    .eq("user_id", userId)
    .eq("date", seedDate);

  const prev: Record<string, { ctl: number; atl: number }> = {};
  for (const sport of SPORTS) {
    const seed = seedRows?.find((r) => r.sport === sport);
    prev[sport] = { ctl: seed?.ctl ?? 0, atl: seed?.atl ?? 0 };
  }

  // Get daily loads from fromDate onward
  const { data: loads } = await supabase
    .from("daily_load")
    .select("date, sport, tss")
    .eq("user_id", userId)
    .gte("date", fromDate)
    .order("date", { ascending: true });

  if (!loads?.length) return;

  // Group by date
  const byDate = new Map<string, Map<string, number>>();
  for (const row of loads) {
    if (!byDate.has(row.date)) byDate.set(row.date, new Map());
    byDate.get(row.date)!.set(row.sport, Number(row.tss) || 0);
  }

  const dates = Array.from(byDate.keys()).sort();
  // Fill gaps between dates
  const allDates = generateDateRange(dates[0], dates[dates.length - 1]);

  // Track CTL for ramp rate
  const ctlHistory: Record<string, number[]> = {};
  for (const sport of SPORTS) {
    ctlHistory[sport] = [];
  }

  // Also fetch the 7 prior CTL values for ramp rate
  const { data: priorCtl } = await supabase
    .from("athlete_fitness")
    .select("date, sport, ctl")
    .eq("user_id", userId)
    .lt("date", fromDate)
    .order("date", { ascending: false })
    .limit(7 * SPORTS.length);

  if (priorCtl) {
    for (const sport of SPORTS) {
      const sportPrior = priorCtl
        .filter((r) => r.sport === sport)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => Number(r.ctl));
      ctlHistory[sport] = sportPrior;
    }
  }

  const upsertBatch: Array<{
    user_id: string;
    date: string;
    sport: string;
    ctl: number;
    atl: number;
    tsb: number;
    ramp_rate: number | null;
  }> = [];

  for (const date of allDates) {
    const dayLoads = byDate.get(date);

    for (const sport of SPORTS) {
      const todayTss = dayLoads?.get(sport) ?? 0;
      const prevVal = prev[sport];
      const { ctl, atl, tsb } = computeDailyFitness(prevVal.ctl, prevVal.atl, todayTss);

      const history = ctlHistory[sport];
      history.push(ctl);
      const rampRate = history.length > 7
        ? computeRampRate(ctl, history[history.length - 8])
        : null;

      upsertBatch.push({
        user_id: userId,
        date,
        sport,
        ctl,
        atl,
        tsb,
        ramp_rate: rampRate
      });

      prev[sport] = { ctl, atl };
    }
  }

  // Upsert in batches
  for (let i = 0; i < upsertBatch.length; i += 500) {
    const batch = upsertBatch.slice(i, i + 500);
    const { error } = await supabase
      .from("athlete_fitness")
      .upsert(batch, { onConflict: "user_id,date,sport" });
    if (error) {
      console.error("[load-sync] Failed to upsert athlete_fitness batch:", error.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Threshold resolution
// ---------------------------------------------------------------------------

async function getAthleteThresholds(
  supabase: SupabaseClient,
  userId: string
): Promise<AthleteThresholds> {
  // Get latest FTP
  const { data: ftp } = await supabase
    .from("athlete_ftp_history")
    .select("value")
    .eq("athlete_id", userId)
    .order("recorded_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // TODO: In the future, retrieve run/swim thresholds from athlete profile
  // For now, we only have FTP from athlete_ftp_history
  return {
    ftp: ftp?.value ?? null,
    maxHr: null,
    restingHr: null,
    thresholdRunPace: null,
    thresholdSwimPace: null
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSport(sport: string | null): Sport {
  const s = (sport ?? "").toLowerCase();
  if (s === "swim" || s === "swimming" || s === "pool_swim" || s === "open_water") return "swim";
  if (s === "bike" || s === "cycling" || s === "virtual_ride") return "bike";
  if (s === "run" || s === "running" || s === "trail_running" || s === "treadmill") return "run";
  if (s === "strength" || s === "functional_fitness" || s === "weight_training") return "strength";
  return "other";
}

function getAvgRunPace(metricsV2: unknown): number | null {
  if (!metricsV2 || typeof metricsV2 !== "object") return null;
  const pace = (metricsV2 as Record<string, unknown>).pace;
  if (!pace || typeof pace !== "object") return null;
  const val = (pace as Record<string, unknown>).avgPaceSecPerKm;
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

function prevDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function generateDateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endStr}T00:00:00.000Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}
