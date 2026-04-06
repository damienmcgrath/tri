/**
 * Race-week detection and context assembly.
 *
 * Determines the athlete's proximity to their next race (within 14 days)
 * and assembles a rich context object used by Morning Briefs, Coach,
 * Dashboard, and Calendar to deliver race-week-specific intelligence.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBlockForDate, type TrainingBlock } from "./race-profile";
import { getLatestFitness, getTsbTrend, getReadinessState, type DisciplineFitness } from "./fitness-model";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RaceProximity =
  | "race_day"       // today is race day
  | "day_before"     // tomorrow is race day
  | "race_week"      // 2-7 days out
  | "pre_race_week"  // 8-14 days out
  | "post_race"      // race was 1-7 days ago
  | "normal";        // >14 days or no race

export type RaceWeekContext = {
  proximity: RaceProximity;
  race: {
    id: string;
    name: string;
    date: string;
    type: string; // 'sprint', 'olympic', '70.3', 'ironman', 'custom'
    priority: "A" | "B" | "C";
    daysUntil: number; // negative for post_race
    swimDistanceM: number | null;
    bikeDistanceKm: number | null;
    runDistanceKm: number | null;
    bikeElevationM: number | null;
    courseType: string | null;
    expectedConditions: string | null;
  };
  readiness: {
    tsb: number;
    readinessState: string;
    ctlTrend: "rising" | "stable" | "falling";
  };
  recentExecution: {
    lastWeekScore: number | null;
    keySessionsHit: number;
    keySessionsTotal: number;
    feelTrend: number[];
    averageFeel: number;
  };
  taperStatus: {
    inTaper: boolean;
    taperWeek: number | null;
    volumeReductionPct: number | null;
  };
};

// ─── Proximity helpers ──────────────────────────────────────────────────────

function classifyProximity(daysUntil: number): RaceProximity {
  if (daysUntil < 0 && daysUntil >= -7) return "post_race";
  if (daysUntil === 0) return "race_day";
  if (daysUntil === 1) return "day_before";
  if (daysUntil >= 2 && daysUntil <= 7) return "race_week";
  if (daysUntil >= 8 && daysUntil <= 14) return "pre_race_week";
  return "normal";
}

function dateDiffDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime();
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / 86400000);
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Get race-week context for an athlete on a given date.
 * Returns null if no race within 14 days (future) or 7 days (past).
 */
export async function getRaceWeekContext(
  supabase: SupabaseClient,
  userId: string,
  today: string
): Promise<RaceWeekContext | null> {
  // 1. Find the next upcoming race within 14 days, OR a recent race within 7 days
  const windowStart = addDaysIso(today, -7);
  const windowEnd = addDaysIso(today, 14);

  const { data: raceRows } = await supabase
    .from("race_profiles")
    .select("id,name,date,distance_type,priority,course_profile")
    .eq("user_id", userId)
    .gte("date", windowStart)
    .lte("date", windowEnd)
    .order("date", { ascending: true })
    .limit(3);

  if (!raceRows || raceRows.length === 0) return null;

  // Prefer upcoming races over past races
  const upcomingRace = raceRows.find((r: any) => r.date >= today);
  const recentRace = raceRows.filter((r: any) => r.date < today).pop();
  const race = upcomingRace ?? recentRace;
  if (!race) return null;

  const daysUntil = dateDiffDays(today, race.date);
  const proximity = classifyProximity(daysUntil);

  if (proximity === "normal") return null;

  // For C-races, only return context for race_week and closer (not pre_race_week)
  if (race.priority === "C" && proximity === "pre_race_week") return null;

  const courseProfile = (race.course_profile ?? {}) as Record<string, unknown>;

  // 2. Fetch readiness data
  const [fitness, tsbTrend] = await Promise.all([
    getLatestFitness(supabase, userId),
    getTsbTrend(supabase, userId, "total", 5)
  ]);

  const totalFitness = fitness?.total ?? { ctl: 0, atl: 0, tsb: 0, rampRate: null };
  const readinessState = getReadinessState(totalFitness.tsb, tsbTrend);
  const ctlTrend = mapTsbTrendToCtl(tsbTrend);

  // 3. Fetch recent execution quality
  const recentExecution = await getRecentExecution(supabase, userId, today);

  // 4. Determine taper status
  const taperStatus = await getTaperStatus(supabase, userId, today);

  return {
    proximity,
    race: {
      id: race.id,
      name: race.name,
      date: race.date,
      type: race.distance_type,
      priority: race.priority,
      daysUntil,
      swimDistanceM: (courseProfile.swim_distance_m as number) ?? null,
      bikeDistanceKm: (courseProfile.bike_distance_km as number) ?? null,
      runDistanceKm: (courseProfile.run_distance_km as number) ?? null,
      bikeElevationM: (courseProfile.bike_elevation_m as number) ?? null,
      courseType: (courseProfile.course_type as string) ?? null,
      expectedConditions: (courseProfile.expected_conditions as string) ?? null,
    },
    readiness: {
      tsb: totalFitness.tsb,
      readinessState,
      ctlTrend,
    },
    recentExecution,
    taperStatus,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapTsbTrendToCtl(trend: "rising" | "stable" | "declining" | null): "rising" | "stable" | "falling" {
  if (trend === "declining") return "falling";
  if (trend === "rising") return "rising";
  return "stable";
}

async function getRecentExecution(
  supabase: SupabaseClient,
  userId: string,
  today: string
): Promise<RaceWeekContext["recentExecution"]> {
  const twoWeeksAgo = addDaysIso(today, -14);

  // Fetch recent verdicts for key session tracking
  const { data: verdicts } = await supabase
    .from("session_verdicts")
    .select("verdict_status,created_at")
    .eq("user_id", userId)
    .gte("created_at", `${twoWeeksAgo}T00:00:00.000Z`)
    .order("created_at", { ascending: false })
    .limit(20);

  // Fetch recent training score
  const { data: scoreRow } = await supabase
    .from("training_scores")
    .select("composite_score")
    .eq("user_id", userId)
    .order("score_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch recent feel scores
  const { data: feels } = await supabase
    .from("session_feels")
    .select("overall_feel")
    .eq("user_id", userId)
    .not("overall_feel", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const verdictList = (verdicts ?? []) as Array<{ verdict_status: string }>;

  // Key sessions: look for sessions marked as key that have verdicts
  const { data: keyVerdicts } = await supabase
    .from("session_verdicts")
    .select("verdict_status,session_id")
    .eq("user_id", userId)
    .gte("created_at", `${twoWeeksAgo}T00:00:00.000Z`);

  // Get key session IDs from sessions table
  const { data: keySessions } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("is_key", true)
    .gte("date", twoWeeksAgo)
    .lte("date", today);

  const keySessionIds = new Set((keySessions ?? []).map((s: any) => s.id));
  const keyVerdictList = (keyVerdicts ?? []).filter((v: any) => keySessionIds.has(v.session_id));
  const keySessionsHit = keyVerdictList.filter((v: any) => v.verdict_status === "achieved").length;
  const keySessionsTotal = keySessionIds.size;

  const feelScores = (feels ?? []).map((f: any) => Number(f.overall_feel)).filter((n) => !isNaN(n));
  const averageFeel = feelScores.length > 0
    ? Math.round((feelScores.reduce((sum, f) => sum + f, 0) / feelScores.length) * 10) / 10
    : 3;

  return {
    lastWeekScore: scoreRow?.composite_score != null ? Math.round(Number(scoreRow.composite_score)) : null,
    keySessionsHit,
    keySessionsTotal,
    feelTrend: feelScores,
    averageFeel,
  };
}

async function getTaperStatus(
  supabase: SupabaseClient,
  userId: string,
  today: string
): Promise<RaceWeekContext["taperStatus"]> {
  const block = await getBlockForDate(supabase, userId, today).catch(() => null);

  if (!block || block.blockType !== "Taper") {
    return { inTaper: false, taperWeek: null, volumeReductionPct: null };
  }

  const taperWeek = weekInBlock(block.startDate, today);
  const totalTaperWeeks = totalBlockWeeks(block.startDate, block.endDate);

  // Estimate volume reduction based on taper week position
  // Typical taper: 20-30% reduction per week
  const volumeReductionPct = Math.min(60, taperWeek * 20 + 10);

  return {
    inTaper: true,
    taperWeek,
    volumeReductionPct,
  };
}

function weekInBlock(blockStartIso: string, todayIso: string): number {
  const start = new Date(`${blockStartIso}T00:00:00.000Z`);
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / (7 * 86400000)) + 1);
}

function totalBlockWeeks(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  return Math.max(1, Math.ceil((end.getTime() - start.getTime() + 86400000) / (7 * 86400000)));
}

/**
 * Lightweight check: is the athlete in race week?
 * Use when you only need the proximity, not the full context.
 */
export async function getRaceProximity(
  supabase: SupabaseClient,
  userId: string,
  today: string
): Promise<RaceProximity> {
  const windowStart = addDaysIso(today, -7);
  const windowEnd = addDaysIso(today, 14);

  const { data: raceRows } = await supabase
    .from("race_profiles")
    .select("date")
    .eq("user_id", userId)
    .gte("date", windowStart)
    .lte("date", windowEnd)
    .order("date", { ascending: true })
    .limit(1);

  if (!raceRows || raceRows.length === 0) return "normal";

  const daysUntil = dateDiffDays(today, raceRows[0].date);
  return classifyProximity(daysUntil);
}

/**
 * Format race distance for display.
 */
export function formatRaceDistance(ctx: RaceWeekContext): string {
  const parts: string[] = [];
  if (ctx.race.swimDistanceM) {
    parts.push(ctx.race.swimDistanceM >= 1000
      ? `${(ctx.race.swimDistanceM / 1000).toFixed(1)}km swim`
      : `${ctx.race.swimDistanceM}m swim`);
  }
  if (ctx.race.bikeDistanceKm) parts.push(`${ctx.race.bikeDistanceKm}km bike`);
  if (ctx.race.runDistanceKm) parts.push(`${ctx.race.runDistanceKm}km run`);
  return parts.join(" / ") || ctx.race.type;
}

/**
 * Get a coaching confidence statement based on the athlete's data.
 */
export function getConfidenceStatement(ctx: RaceWeekContext): string {
  const score = ctx.recentExecution.lastWeekScore;
  const feel = ctx.recentExecution.averageFeel;
  const keyHitRate = ctx.recentExecution.keySessionsTotal > 0
    ? ctx.recentExecution.keySessionsHit / ctx.recentExecution.keySessionsTotal
    : 0;

  if (score !== null && score >= 75 && keyHitRate >= 0.7 && feel >= 3.5) {
    return "Your preparation has been strong. Trust the work you've done.";
  }
  if (score !== null && score >= 60 && feel >= 3) {
    return "You've put in solid training. Focus on what you can control on race day.";
  }
  if (feel < 3) {
    return "Recent sessions have been tough, but that's part of the process. Race day is a fresh start.";
  }
  return "Trust your training. You've done the work to get here.";
}
