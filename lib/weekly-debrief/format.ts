import { getMetricsV2Laps, getMetricsV2PaceZones, getMetricsV2HrZones } from "@/lib/workouts/metrics-v2";
import type { WeeklyDebriefActivity } from "./types";

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatMinutes(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

export function compactZoneEvidence(zones: ReturnType<typeof getMetricsV2HrZones | typeof getMetricsV2PaceZones>) {
  return zones
    .filter((zone) => zone.durationSec > 0)
    .map((zone) => ({
      zone: zone.zone,
      durationSec: zone.durationSec,
      pctOfSession: zone.pctOfSession,
      heartRateMin: zone.heartRateMin ?? null,
      heartRateMax: zone.heartRateMax ?? null,
      paceMin: zone.paceMin ?? null,
      paceMax: zone.paceMax ?? null
    }))
    .slice(0, 6);
}

export function toCompactLap(lap: ReturnType<typeof getMetricsV2Laps>[number]) {
  return {
    index: lap.index,
    durationSec: lap.durationSec,
    distanceM: lap.distanceM,
    avgHr: lap.avgHr,
    avgCadence: lap.avgCadence,
    avgPaceSecPerKm: lap.avgPaceSecPerKm ?? null,
    avgPacePer100mSec: lap.avgPacePer100mSec ?? null,
    avgStrokeRateSpm: lap.avgStrokeRateSpm ?? null,
    avgSwolf: lap.avgSwolf ?? null,
    restSec: lap.restSec ?? null,
    elevationGainM: lap.elevationGainM ?? null,
    elevationLossM: lap.elevationLossM ?? null,
    trigger: lap.trigger,
    isRest: lap.isRest ?? null
  };
}

function compactRunLapEvidence(activity: WeeklyDebriefActivity) {
  const laps = getMetricsV2Laps(activity.metrics_v2);
  const sorted = [...laps].sort((a, b) => {
    const distanceDelta = (b.distanceM ?? 0) - (a.distanceM ?? 0);
    if (distanceDelta !== 0) return distanceDelta;
    return (b.durationSec ?? 0) - (a.durationSec ?? 0);
  });
  const selected = [
    sorted[0],
    sorted[Math.max(0, Math.floor(sorted.length / 2) - 1)],
    sorted[sorted.length - 1]
  ].filter((lap, index, all): lap is NonNullable<typeof lap> => Boolean(lap) && all.indexOf(lap) === index);
  return selected.map(toCompactLap).slice(0, 4);
}

function compactSwimLapEvidence(activity: WeeklyDebriefActivity) {
  const laps = getMetricsV2Laps(activity.metrics_v2);
  const workLaps = laps.filter((lap) => (lap.distanceM ?? 0) > 0);
  const restLaps = laps.filter((lap) => lap.isRest === true || (lap.restSec ?? 0) > 0);
  const selected = [
    ...workLaps.slice(0, 4),
    ...restLaps.slice(0, 2)
  ].filter((lap, index, all) => all.indexOf(lap) === index);
  return selected.map(toCompactLap).slice(0, 6);
}

function compactBikeLapEvidence(activity: WeeklyDebriefActivity) {
  return getMetricsV2Laps(activity.metrics_v2)
    .slice(0, 4)
    .map(toCompactLap);
}

function compactGenericLapEvidence(activity: WeeklyDebriefActivity) {
  return getMetricsV2Laps(activity.metrics_v2)
    .slice(0, 4)
    .map(toCompactLap);
}

export function compactLapEvidence(activity: WeeklyDebriefActivity) {
  if (activity.sport_type === "run") return compactRunLapEvidence(activity);
  if (activity.sport_type === "swim") return compactSwimLapEvidence(activity);
  if (activity.sport_type === "bike") return compactBikeLapEvidence(activity);
  return compactGenericLapEvidence(activity);
}

export function trimNullishEntries<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (entry === null || typeof entry === "undefined") return [];
      if (Array.isArray(entry)) return entry.length > 0 ? [[key, entry]] : [];
      if (typeof entry === "object") {
        const cleaned = trimNullishEntries(entry as Record<string, unknown>);
        return Object.keys(cleaned).length > 0 ? [[key, cleaned]] : [];
      }
      return [[key, entry]];
    })
  );
}

export function compactMetricBlock<T extends Record<string, unknown>>(value: T) {
  return trimNullishEntries(value);
}
