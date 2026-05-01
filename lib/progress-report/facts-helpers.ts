/**
 * Pure formatting + access helpers used by the progress-report facts builders.
 * No I/O — kept together so each category builder can import from one place.
 */

import { getNestedNumber } from "@/lib/workouts/metrics-v2";

export type ActivityRow = {
  id: string;
  user_id: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  moving_duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec: number | null;
  metrics_v2: Record<string, unknown> | null;
};

export type FitnessRow = {
  date: string;
  sport: string;
  ctl: number;
  atl: number;
  tsb: number;
  ramp_rate: number | null;
};

export type SessionRow = {
  id: string;
  date: string;
  sport: string | null;
  duration_minutes: number | null;
  status: string;
  is_key: boolean | null;
  session_role: string | null;
};

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function effectiveDurationSec(row: ActivityRow): number | null {
  return row.moving_duration_sec ?? row.duration_sec;
}

export function isEnduranceSport(sport: string): sport is "run" | "bike" | "swim" {
  return sport === "run" || sport === "bike" || sport === "swim";
}

export function formatShortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

export function formatBlockRange(start: string, end: string): string {
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

export function formatPaceMinSec(secPerUnit: number, unit: string): string {
  const rounded = Math.round(secPerUnit);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}${unit}`;
}

export function extractHalves(row: ActivityRow) {
  const metrics = row.metrics_v2 ?? {};
  const splits = (metrics as Record<string, unknown>).splits as
    | Record<string, unknown>
    | null
    | undefined;
  const halves = (metrics as Record<string, unknown>).halves as
    | Record<string, unknown>
    | null
    | undefined;
  const sources = [splits, halves, metrics];

  return {
    firstHalfAvgHr: getNestedNumber(sources, [
      ["firstHalfAvgHr"],
      ["first_half_avg_hr"],
      ["firstHalf", "avgHr"],
      ["first_half", "avg_hr"]
    ]),
    lastHalfAvgHr: getNestedNumber(sources, [
      ["lastHalfAvgHr"],
      ["last_half_avg_hr"],
      ["lastHalf", "avgHr"],
      ["last_half", "avg_hr"]
    ]),
    firstHalfAvgPower: getNestedNumber(sources, [
      ["firstHalfAvgPower"],
      ["first_half_avg_power"],
      ["firstHalf", "avgPower"],
      ["first_half", "avg_power"]
    ]),
    lastHalfAvgPower: getNestedNumber(sources, [
      ["lastHalfAvgPower"],
      ["last_half_avg_power"],
      ["lastHalf", "avgPower"],
      ["last_half", "avg_power"]
    ]),
    firstHalfPaceSPerKm: getNestedNumber(sources, [
      ["firstHalfPaceSPerKm"],
      ["first_half_pace_s_per_km"],
      ["firstHalf", "avgPaceSecPerKm"],
      ["first_half", "avg_pace_sec_per_km"]
    ]),
    lastHalfPaceSPerKm: getNestedNumber(sources, [
      ["lastHalfPaceSPerKm"],
      ["last_half_pace_s_per_km"],
      ["lastHalf", "avgPaceSecPerKm"],
      ["last_half", "avg_pace_sec_per_km"]
    ])
  };
}

export function bikeNormalizedPower(row: ActivityRow): number | null {
  return (
    getNestedNumber(row.metrics_v2, [
      ["power", "normalizedPower"],
      ["power", "normalized_power"]
    ]) ?? row.avg_power
  );
}
