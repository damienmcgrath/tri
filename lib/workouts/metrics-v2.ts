export type MetricsRecord = Record<string, unknown>;

export type ActivityLapMetrics = {
  index: number;
  startTime: string | null;
  durationSec: number | null;
  elapsedDurationSec: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  normalizedPower: number | null;
  maxPower: number | null;
  avgCadence: number | null;
  maxCadence: number | null;
  calories: number | null;
  workKj: number | null;
  intensity: string | number | null;
  trigger: string | null;
  avgPaceSecPerKm?: number | null;
  avgPacePer100mSec?: number | null;
};

export type ZoneMetrics = {
  zone: number;
  durationSec: number;
  pctOfSession: number | null;
  powerMin?: number | null;
  powerMax?: number | null;
  heartRateMin?: number | null;
  heartRateMax?: number | null;
};

export function asMetricsRecord(value: unknown): MetricsRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as MetricsRecord) : null;
}

export function getNestedValue(source: unknown, path: string[]) {
  let cursor: unknown = source;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(key in cursor)) {
      return null;
    }
    cursor = (cursor as MetricsRecord)[key];
  }
  return cursor ?? null;
}

export function getNestedNumber(source: unknown, pathOptions: string[][]) {
  for (const path of pathOptions) {
    const value = getNestedValue(source, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function getNestedString(source: unknown, pathOptions: string[][]) {
  for (const path of pathOptions) {
    const value = getNestedValue(source, path);
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function coerceLapMetrics(value: unknown): ActivityLapMetrics | null {
  const lap = asMetricsRecord(value);
  if (!lap) return null;

  const index = getNestedNumber(lap, [["index"]]);
  if (index === null) return null;

  return {
    index,
    startTime: getNestedString(lap, [["startTime"], ["start_time"]]),
    durationSec: getNestedNumber(lap, [["durationSec"], ["duration_sec"]]),
    elapsedDurationSec: getNestedNumber(lap, [["elapsedDurationSec"], ["elapsed_duration_sec"]]),
    distanceM: getNestedNumber(lap, [["distanceM"], ["distance_m"]]),
    avgHr: getNestedNumber(lap, [["avgHr"], ["avg_hr"]]),
    maxHr: getNestedNumber(lap, [["maxHr"], ["max_hr"]]),
    avgPower: getNestedNumber(lap, [["avgPower"], ["avg_power"]]),
    normalizedPower: getNestedNumber(lap, [["normalizedPower"], ["normalized_power"]]),
    maxPower: getNestedNumber(lap, [["maxPower"], ["max_power"]]),
    avgCadence: getNestedNumber(lap, [["avgCadence"], ["avg_cadence"]]),
    maxCadence: getNestedNumber(lap, [["maxCadence"], ["max_cadence"]]),
    calories: getNestedNumber(lap, [["calories"]]),
    workKj: getNestedNumber(lap, [["workKj"], ["work_kj"]]),
    intensity: getNestedValue(lap, ["intensity"]) as string | number | null,
    trigger: getNestedString(lap, [["trigger"]]),
    avgPaceSecPerKm: getNestedNumber(lap, [["avgPaceSecPerKm"], ["avg_pace_sec_per_km"]]),
    avgPacePer100mSec: getNestedNumber(lap, [["avgPacePer100mSec"], ["avg_pace_per_100m_sec"]])
  };
}

function coerceZoneMetrics(value: unknown): ZoneMetrics | null {
  const zone = asMetricsRecord(value);
  if (!zone) return null;

  const index = getNestedNumber(zone, [["zone"]]);
  const durationSec = getNestedNumber(zone, [["durationSec"], ["duration_sec"]]);
  if (index === null || durationSec === null) return null;

  return {
    zone: index,
    durationSec,
    pctOfSession: getNestedNumber(zone, [["pctOfSession"], ["pct_of_session"]]),
    powerMin: getNestedNumber(zone, [["powerMin"], ["power_min"]]),
    powerMax: getNestedNumber(zone, [["powerMax"], ["power_max"]]),
    heartRateMin: getNestedNumber(zone, [["heartRateMin"], ["heart_rate_min"]]),
    heartRateMax: getNestedNumber(zone, [["heartRateMax"], ["heart_rate_max"]])
  };
}

export function getMetricsV2Laps(metrics: unknown) {
  const laps = getNestedValue(metrics, ["laps"]);
  return Array.isArray(laps)
    ? laps.map((lap) => coerceLapMetrics(lap)).filter((lap): lap is ActivityLapMetrics => lap !== null)
    : [];
}

export function getMetricsV2PowerZones(metrics: unknown) {
  const zones = getNestedValue(metrics, ["zones", "power"]);
  return Array.isArray(zones)
    ? zones.map((zone) => coerceZoneMetrics(zone)).filter((zone): zone is ZoneMetrics => zone !== null)
    : [];
}

export function getMetricsV2HrZones(metrics: unknown) {
  const zones = getNestedValue(metrics, ["zones", "heartRate"]);
  return Array.isArray(zones)
    ? zones.map((zone) => coerceZoneMetrics(zone)).filter((zone): zone is ZoneMetrics => zone !== null)
    : [];
}
