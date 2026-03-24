import { createHash } from "crypto";
import FitParser from "fit-file-parser";
import { XMLParser } from "fast-xml-parser";

export type ParsedActivity = {
  sportType: string;
  startTimeUtc: string;
  endTimeUtc: string;
  durationSec: number;
  distanceM: number;
  avgHr: number | null;
  avgPower: number | null;
  calories: number | null;
  movingDurationSec?: number;
  elapsedDurationSec?: number;
  poolLengthM?: number;
  lapsCount?: number;
  avgPacePer100mSec?: number;
  bestPacePer100mSec?: number;
  avgStrokeRateSpm?: number;
  avgSwolf?: number;
  avgCadence?: number;
  maxHr?: number;
  maxPower?: number;
  elevationGainM?: number;
  elevationLossM?: number;
  activityTypeRaw?: string;
  activitySubtypeRaw?: string;
  activityVendor?: string;
  metricsV2?: Record<string, unknown>;
  parseSummary?: Record<string, unknown>;
};

function buildPaceSummary(durationSec: number, distanceM: number) {
  if (durationSec <= 0 || distanceM <= 0) {
    return {};
  }

  return {
    avgPaceSecPerKm: Number((durationSec / (distanceM / 1000)).toFixed(2)),
    avgPaceSecPer100m: Number((durationSec / (distanceM / 100)).toFixed(2))
  };
}

const tcxParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: true, trimValues: true });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function positiveInt(value: unknown): number | undefined {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function firstPositiveNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = positiveNumber(value);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function normalizeSport(raw?: string) {
  const sport = (raw ?? "").toLowerCase();
  if (sport.includes("run")) return "run";
  if (sport.includes("bike") || sport.includes("cycl")) return "bike";
  if (sport.includes("swim")) return "swim";
  if (sport.includes("functional") || sport.includes("cross") || sport.includes("hiit")) return "functional_fitness";
  if (sport.includes("weight")) return "weightlifting";
  if (sport.includes("strength")) return "strength";
  return "other";
}

function normalizeActivityType(rawType?: string, rawSubtype?: string) {
  const joined = `${rawType ?? ""} ${rawSubtype ?? ""}`.toLowerCase();
  if (joined.includes("swim")) return "swim";
  if (joined.includes("bike") || joined.includes("cycl")) return "bike";
  if (joined.includes("run") || joined.includes("trail") || joined.includes("treadmill")) return "run";
  if (joined.includes("functional") || joined.includes("cross") || joined.includes("hiit")) return "functional_fitness";
  if (joined.includes("weight")) return "weightlifting";
  if (joined.includes("strength")) return "strength";
  return normalizeSport(rawType);
}

export function sha256Hex(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

export async function parseFitFile(buffer: Buffer): Promise<ParsedActivity> {
  const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m", temperatureUnit: "celsius" });

  const fit = await new Promise<any>((resolve, reject) => {
    parser.parse(buffer as any, (error: unknown, data: unknown) => {
      if (error) reject(error);
      else resolve(data);
    });
  });

  const session = fit?.sessions?.[0];
  if (!session?.start_time) {
    throw new Error("FIT file missing session start time.");
  }

  const start = new Date(session.start_time);
  const movingDurationSec = positiveInt(firstPositiveNumber([session.total_timer_time, session.total_moving_time]));
  const elapsedDurationSec = positiveInt(firstPositiveNumber([session.total_elapsed_time, session.total_time, movingDurationSec]));
  const durationSec = movingDurationSec ?? elapsedDurationSec ?? 0;
  const poolLengthM = firstPositiveNumber([session.pool_length, session.pool_length_m]);

  if (durationSec <= 0) {
    throw new Error("FIT file missing usable duration.");
  }

  const sportRaw = typeof session.sport === "string" ? session.sport : undefined;
  const subSportRaw = typeof session.sub_sport === "string" ? session.sub_sport : undefined;
  const normalizedSport = normalizeActivityType(sportRaw, subSportRaw);
  const distanceM = Number(session.total_distance ?? 0);
  const avgPacePer100mSec = normalizedSport === "swim" && durationSec > 0 && distanceM > 0
    ? Math.round(durationSec / (distanceM / 100))
    : undefined;

  const lapsCount = positiveInt(firstPositiveNumber([session.num_laps, fit?.laps?.length]));
  const maxHr = positiveInt(firstPositiveNumber([session.max_heart_rate]));
  const maxPower = positiveInt(firstPositiveNumber([session.max_power]));
  const avgCadence = positiveInt(firstPositiveNumber([session.avg_cadence, session.avg_running_cadence, session.avg_bike_cadence]));
  const avgStrokeRateSpm = positiveInt(firstPositiveNumber([session.avg_stroke_rate]));
  const avgSwolf = positiveInt(firstPositiveNumber([session.avg_swolf]));
  const elevationGainM = positiveInt(firstPositiveNumber([session.total_ascent]));
  const elevationLossM = positiveInt(firstPositiveNumber([session.total_descent]));

  const qualityMissing = [
    ["movingDurationSec", movingDurationSec],
    ["elapsedDurationSec", elapsedDurationSec],
    ["poolLengthM", poolLengthM],
    ["lapsCount", lapsCount],
    ["avgStrokeRateSpm", avgStrokeRateSpm],
    ["avgSwolf", avgSwolf],
    ["avgCadence", avgCadence],
    ["maxHr", maxHr],
    ["maxPower", maxPower],
    ["elevationGainM", elevationGainM],
    ["elevationLossM", elevationLossM]
  ].filter(([, value]) => value === undefined).map(([name]) => name);

  const end = new Date(start.getTime() + durationSec * 1000);

  return {
    sportType: normalizedSport,
    startTimeUtc: start.toISOString(),
    endTimeUtc: end.toISOString(),
    durationSec,
    distanceM,
    avgHr: session.avg_heart_rate ? Number(session.avg_heart_rate) : null,
    avgPower: session.avg_power ? Number(session.avg_power) : null,
    calories: session.total_calories ? Number(session.total_calories) : null,
    movingDurationSec,
    elapsedDurationSec,
    poolLengthM,
    lapsCount,
    avgPacePer100mSec,
    avgStrokeRateSpm,
    avgSwolf,
    avgCadence,
    maxHr,
    maxPower,
    elevationGainM,
    elevationLossM,
    activityTypeRaw: sportRaw,
    activitySubtypeRaw: subSportRaw,
    activityVendor: "garmin",
    metricsV2: {
      schemaVersion: 1,
      sourceFormat: "fit",
      activity: {
        vendor: "garmin",
        rawType: sportRaw ?? null,
        rawSubType: subSportRaw ?? null,
        normalizedType: normalizedSport
      },
      quality: {
        missing: qualityMissing,
        warnings: []
      }
    },
    parseSummary: {
      records: Array.isArray(fit?.records) ? fit.records.length : 0,
      movingDurationSec,
      elapsedDurationSec,
      poolLengthMeters: poolLengthM
    }
  };
}

export function parseTcxFile(xml: string): ParsedActivity {
  const doc = tcxParser.parse(xml) as any;
  const activity = asArray(doc?.TrainingCenterDatabase?.Activities?.Activity)[0];
  if (!activity) throw new Error("No activity found in TCX file.");

  const laps = asArray(activity.Lap);
  const start = new Date(activity.Id);
  if (Number.isNaN(start.getTime())) throw new Error("TCX activity start time is invalid.");

  const elapsedDurationSec = Math.round(laps.reduce((sum, lap) => sum + Number(lap.TotalTimeSeconds ?? 0), 0));
  const movingDurationSec = undefined;
  const durationSec = elapsedDurationSec;
  const distanceM = laps.reduce((sum, lap) => sum + Number(lap.DistanceMeters ?? 0), 0);
  const calories = Math.round(laps.reduce((sum, lap) => sum + Number(lap.Calories ?? 0), 0));
  const avgHrValues = laps.map((lap) => Number(lap.AverageHeartRateBpm?.Value ?? 0)).filter((value) => value > 0);
  const avgHr = avgHrValues.length ? Math.round(avgHrValues.reduce((a, b) => a + b, 0) / avgHrValues.length) : null;
  const maxHrValues = laps.map((lap) => Number(lap.MaximumHeartRateBpm?.Value ?? 0)).filter((value) => value > 0);
  const maxHr = maxHrValues.length ? Math.max(...maxHrValues) : undefined;
  const sportRaw = typeof activity.Sport === "string" ? activity.Sport : undefined;

  const trackpoints = laps.flatMap((lap) => asArray(lap.Track?.Trackpoint));
  const cadenceValues = trackpoints.map((trackpoint) => Number(trackpoint.Cadence ?? 0)).filter((value) => value > 0);
  const avgCadence = cadenceValues.length ? Math.round(cadenceValues.reduce((a, b) => a + b, 0) / cadenceValues.length) : undefined;

  const altitudeValues = trackpoints
    .map((trackpoint) => Number(trackpoint.AltitudeMeters ?? Number.NaN))
    .filter((value) => Number.isFinite(value));

  let elevationGainM: number | undefined;
  let elevationLossM: number | undefined;
  if (altitudeValues.length > 1) {
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < altitudeValues.length; i += 1) {
      const delta = altitudeValues[i] - altitudeValues[i - 1];
      if (delta > 0) gain += delta;
      if (delta < 0) loss += Math.abs(delta);
    }

    elevationGainM = positiveInt(gain);
    elevationLossM = positiveInt(loss);
  }

  const poolLengthM = undefined;
  const lapsCount = laps.length > 0 ? laps.length : undefined;
  const normalizedSport = normalizeActivityType(sportRaw);
  const avgPacePer100mSec = normalizedSport === "swim" && durationSec > 0 && distanceM > 0
    ? Math.round(durationSec / (distanceM / 100))
    : undefined;

  const missing = [
    ["movingDurationSec", movingDurationSec],
    ["poolLengthM", poolLengthM],
    ["avgCadence", avgCadence],
    ["maxHr", maxHr],
    ["elevationGainM", elevationGainM],
    ["elevationLossM", elevationLossM]
  ].filter(([, value]) => value === undefined).map(([name]) => name);

  return {
    sportType: normalizedSport,
    startTimeUtc: start.toISOString(),
    endTimeUtc: new Date(start.getTime() + durationSec * 1000).toISOString(),
    durationSec,
    distanceM,
    avgHr,
    avgPower: null,
    calories,
    movingDurationSec,
    elapsedDurationSec,
    poolLengthM,
    lapsCount,
    avgPacePer100mSec,
    avgCadence,
    maxHr,
    elevationGainM,
    elevationLossM,
    activityTypeRaw: sportRaw,
    activityVendor: "garmin",
    metricsV2: {
      schemaVersion: 1,
      sourceFormat: "tcx",
      activity: {
        vendor: "garmin",
        rawType: sportRaw ?? null,
        rawSubType: null,
        normalizedType: normalizedSport
      },
      quality: {
        missing,
        warnings: movingDurationSec === undefined ? ["movingDurationUnavailableInTcx"] : []
      }
    },
    parseSummary: {
      lapCount: laps.length,
      movingDurationSec,
      elapsedDurationSec,
      ...buildPaceSummary(durationSec, distanceM)
    }
  };
}
