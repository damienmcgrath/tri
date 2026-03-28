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

function paceFromSpeed(speedMetersPerSecond: number | undefined, unitMeters: number) {
  if (!speedMetersPerSecond || speedMetersPerSecond <= 0) return undefined;
  return roundNumber(unitMeters / speedMetersPerSecond, 2);
}

function roundNumber(value: unknown, decimals = 2): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : undefined;
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

function nonNegativeNumber(value: unknown): number | undefined {
  if (value === null || typeof value === "undefined" || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pickSessionTimeInZoneEntry(fit: Record<string, unknown>) {
  const entries = Array.isArray(fit.time_in_zone) ? fit.time_in_zone : [];
  return entries.find((entry) => asRecord(entry)?.reference_mesg === 18) ?? entries[0] ?? null;
}

function buildZoneSummaries(args: {
  durations: unknown;
  boundaries: unknown;
  totalDurationSec: number;
  valueKey: "power" | "heartRate";
}) {
  const durations = Array.isArray(args.durations) ? args.durations : [];
  const boundaries = Array.isArray(args.boundaries)
    ? args.boundaries.map((value) => nonNegativeNumber(value) ?? null)
    : [];

  let previousUpper: number | null = 0;
  return durations
    .map((rawDuration, index) => {
      const durationSec = roundNumber(rawDuration, 3);
      if (durationSec === undefined) return null;

      const upperBound = index < boundaries.length ? boundaries[index] : null;
      const zone: Record<string, unknown> = {
        zone: index + 1,
        durationSec,
        pctOfSession: args.totalDurationSec > 0 ? roundNumber(durationSec / args.totalDurationSec, 4) ?? null : null
      };

      zone[`${args.valueKey}Min`] = previousUpper;
      zone[`${args.valueKey}Max`] = upperBound;
      previousUpper = upperBound;
      return zone;
    })
    .filter((zone): zone is Record<string, unknown> => zone !== null);
}

function buildLapSummaries(laps: unknown[], sport: string) {
  return laps
    .map((lap, index) => {
      const source = asRecord(lap);
      if (!source) return null;

      const durationSec = roundNumber(source.total_timer_time ?? source.total_elapsed_time, 3);
      const distanceM = roundNumber(source.total_distance, 2);
      const avgCadence = positiveInt(source.avg_cadence);
      const maxCadence = positiveInt(source.max_cadence);
      const avgStrokeRateSpm = sport === "swim"
        ? positiveInt(firstPositiveNumber([source.avg_stroke_rate, source.avg_cadence]))
        : undefined;
      const maxStrokeRateSpm = sport === "swim"
        ? positiveInt(firstPositiveNumber([source.max_stroke_rate, source.max_cadence]))
        : undefined;
      const avgSwolf = sport === "swim" ? positiveInt(firstPositiveNumber([source.avg_swolf])) : undefined;
      const isRest = sport === "swim" && distanceM !== undefined && distanceM <= 0;
      const lapSummary: Record<string, unknown> = {
        index: index + 1,
        startTime: typeof source.start_time === "string" ? source.start_time : null,
        durationSec: durationSec ?? null,
        elapsedDurationSec: roundNumber(source.total_elapsed_time, 3) ?? null,
        distanceM: distanceM ?? null,
        avgHr: positiveInt(source.avg_heart_rate) ?? null,
        maxHr: positiveInt(source.max_heart_rate) ?? null,
        avgPower: positiveInt(source.avg_power) ?? null,
        normalizedPower: positiveInt(source.normalized_power) ?? null,
        maxPower: positiveInt(source.max_power) ?? null,
        avgCadence: avgCadence ?? null,
        maxCadence: maxCadence ?? null,
        calories: positiveInt(source.total_calories) ?? null,
        workKj: source.total_work ? roundNumber(Number(source.total_work) / 1000, 1) ?? null : null,
        intensity: typeof source.intensity === "string" ? source.intensity : source.intensity ?? null,
        trigger: typeof source.lap_trigger === "string" ? source.lap_trigger : source.event_type ?? null,
        avgStrokeRateSpm: avgStrokeRateSpm ?? null,
        maxStrokeRateSpm: maxStrokeRateSpm ?? null,
        avgSwolf: avgSwolf ?? null,
        restSec: isRest ? durationSec ?? null : null,
        isRest,
        elevationGainM: roundNumber(source.total_ascent, 1) ?? null,
        elevationLossM: roundNumber(source.total_descent, 1) ?? null
      };

      if (durationSec && distanceM && distanceM > 0) {
        if (sport === "swim") {
          lapSummary.avgPacePer100mSec = Math.round(durationSec / (distanceM / 100));
        } else {
          lapSummary.avgPaceSecPerKm = roundNumber(durationSec / (distanceM / 1000), 2) ?? null;
        }
      }

      return lapSummary;
    })
    .filter((lap): lap is Record<string, unknown> => lap !== null);
}

function buildPauseSummary(events: unknown[], elapsedDurationSec?: number, movingDurationSec?: number) {
  const sortedEvents = events
    .map((event) => asRecord(event))
    .filter((event): event is Record<string, unknown> => event !== null && typeof event.timestamp === "string")
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

  const summarizedEvents = sortedEvents.map((event) => ({
    timestamp: String(event.timestamp),
    event: typeof event.event === "string" ? event.event : null,
    eventType: typeof event.event_type === "string" ? event.event_type : null,
    timerTrigger: typeof event.timer_trigger === "string" ? event.timer_trigger : null,
    data: event.data ?? null
  }));

  let lastStopAt: number | null = null;
  let pauseCount = 0;
  let totalPausedSec = 0;

  for (const event of summarizedEvents) {
    if (event.event !== "timer" || !event.eventType) continue;
    const timestamp = new Date(event.timestamp).getTime();
    if (Number.isNaN(timestamp)) continue;

    if (event.eventType === "stop" || event.eventType === "stop_all") {
      lastStopAt = timestamp;
      continue;
    }

    if (event.eventType === "start" && lastStopAt !== null) {
      const deltaSec = Math.max(0, (timestamp - lastStopAt) / 1000);
      if (deltaSec > 0) {
        totalPausedSec += deltaSec;
        pauseCount += 1;
      }
      lastStopAt = null;
    }
  }

  const fallbackPausedSec =
    elapsedDurationSec && movingDurationSec && elapsedDurationSec > movingDurationSec
      ? roundNumber(elapsedDurationSec - movingDurationSec, 3)
      : undefined;

  if (totalPausedSec === 0 && fallbackPausedSec && fallbackPausedSec > 0) {
    totalPausedSec = fallbackPausedSec;
    pauseCount = 1;
  }

  return {
    count: pauseCount,
    totalPausedSec: totalPausedSec > 0 ? roundNumber(totalPausedSec, 3) ?? null : null,
    events: summarizedEvents
  };
}

function buildHalfSummaries(laps: Array<Record<string, unknown>>, durationSec: number, sport: string) {
  if (durationSec <= 0 || laps.length === 0) return null;

  const halfwaySec = durationSec / 2;
  let elapsedSec = 0;

  const buckets = {
    first: { durationSec: 0, distanceM: 0, hr: 0, hrDuration: 0, power: 0, powerDuration: 0, cadence: 0, cadenceDuration: 0, stroke: 0, strokeDuration: 0 },
    second: { durationSec: 0, distanceM: 0, hr: 0, hrDuration: 0, power: 0, powerDuration: 0, cadence: 0, cadenceDuration: 0, stroke: 0, strokeDuration: 0 }
  };

  for (const lap of laps) {
    const lapDurationSec = nonNegativeNumber(lap.durationSec);
    if (!lapDurationSec || lapDurationSec <= 0) continue;

    const lapDistanceM = nonNegativeNumber(lap.distanceM) ?? 0;
    const lapAvgHr = nonNegativeNumber(lap.avgHr);
    const lapAvgPower = nonNegativeNumber(lap.avgPower);
    const lapAvgCadence = nonNegativeNumber(lap.avgCadence);
    const lapAvgStrokeRate = nonNegativeNumber(lap.avgStrokeRateSpm) ?? (sport === "swim" ? lapAvgCadence : undefined);
    const lapStart = elapsedSec;
    const lapEnd = elapsedSec + lapDurationSec;
    const firstOverlapSec = Math.max(0, Math.min(lapEnd, halfwaySec) - lapStart);
    const secondOverlapSec = Math.max(0, lapEnd - Math.max(lapStart, halfwaySec));

    if (firstOverlapSec > 0) {
      buckets.first.durationSec += firstOverlapSec;
      buckets.first.distanceM += lapDistanceM * (firstOverlapSec / lapDurationSec);
      if (lapAvgHr !== undefined) {
        buckets.first.hr += lapAvgHr * firstOverlapSec;
        buckets.first.hrDuration += firstOverlapSec;
      }
      if (lapAvgPower !== undefined) {
        buckets.first.power += lapAvgPower * firstOverlapSec;
        buckets.first.powerDuration += firstOverlapSec;
      }
      if (lapAvgCadence !== undefined) {
        buckets.first.cadence += lapAvgCadence * firstOverlapSec;
        buckets.first.cadenceDuration += firstOverlapSec;
      }
      if (lapAvgStrokeRate !== undefined) {
        buckets.first.stroke += lapAvgStrokeRate * firstOverlapSec;
        buckets.first.strokeDuration += firstOverlapSec;
      }
    }

    if (secondOverlapSec > 0) {
      buckets.second.durationSec += secondOverlapSec;
      buckets.second.distanceM += lapDistanceM * (secondOverlapSec / lapDurationSec);
      if (lapAvgHr !== undefined) {
        buckets.second.hr += lapAvgHr * secondOverlapSec;
        buckets.second.hrDuration += secondOverlapSec;
      }
      if (lapAvgPower !== undefined) {
        buckets.second.power += lapAvgPower * secondOverlapSec;
        buckets.second.powerDuration += secondOverlapSec;
      }
      if (lapAvgCadence !== undefined) {
        buckets.second.cadence += lapAvgCadence * secondOverlapSec;
        buckets.second.cadenceDuration += secondOverlapSec;
      }
      if (lapAvgStrokeRate !== undefined) {
        buckets.second.stroke += lapAvgStrokeRate * secondOverlapSec;
        buckets.second.strokeDuration += secondOverlapSec;
      }
    }

    elapsedSec = lapEnd;
  }

  function weightedAverage(total: number, duration: number) {
    return duration > 0 ? roundNumber(total / duration, 1) ?? null : null;
  }

  const firstHalfAvgHr = weightedAverage(buckets.first.hr, buckets.first.hrDuration);
  const lastHalfAvgHr = weightedAverage(buckets.second.hr, buckets.second.hrDuration);
  const firstHalfAvgPower = weightedAverage(buckets.first.power, buckets.first.powerDuration);
  const lastHalfAvgPower = weightedAverage(buckets.second.power, buckets.second.powerDuration);
  const firstHalfAvgCadence = weightedAverage(buckets.first.cadence, buckets.first.cadenceDuration);
  const lastHalfAvgCadence = weightedAverage(buckets.second.cadence, buckets.second.cadenceDuration);
  const firstHalfStrokeRate = weightedAverage(buckets.first.stroke, buckets.first.strokeDuration);
  const lastHalfStrokeRate = weightedAverage(buckets.second.stroke, buckets.second.strokeDuration);

  const summary: Record<string, unknown> = {
    firstHalfAvgHr,
    lastHalfAvgHr,
    firstHalfAvgPower,
    lastHalfAvgPower,
    firstHalfAvgCadence,
    lastHalfAvgCadence,
    firstHalfStrokeRate,
    lastHalfStrokeRate,
    hrDriftPct:
      firstHalfAvgHr && lastHalfAvgHr
        ? roundNumber(lastHalfAvgHr / firstHalfAvgHr - 1, 4) ?? null
        : null,
    powerChangePct:
      firstHalfAvgPower && lastHalfAvgPower
        ? roundNumber(lastHalfAvgPower / firstHalfAvgPower - 1, 4) ?? null
        : null
  };

  if (sport === "swim" && buckets.first.durationSec > 0 && buckets.first.distanceM > 0) {
    summary.firstHalfPacePer100mSec = roundNumber(buckets.first.durationSec / (buckets.first.distanceM / 100), 2) ?? null;
  }
  if (sport === "swim" && buckets.second.durationSec > 0 && buckets.second.distanceM > 0) {
    summary.lastHalfPacePer100mSec = roundNumber(buckets.second.durationSec / (buckets.second.distanceM / 100), 2) ?? null;
    if (summary.firstHalfPacePer100mSec && summary.lastHalfPacePer100mSec) {
      summary.paceFadePct = roundNumber(
        Number(summary.lastHalfPacePer100mSec) / Number(summary.firstHalfPacePer100mSec) - 1,
        4
      ) ?? null;
    }
  }
  if (sport !== "swim" && buckets.first.durationSec > 0 && buckets.first.distanceM > 0) {
    summary.firstHalfPaceSPerKm = roundNumber(buckets.first.durationSec / (buckets.first.distanceM / 1000), 2) ?? null;
  }
  if (sport !== "swim" && buckets.second.durationSec > 0 && buckets.second.distanceM > 0) {
    summary.lastHalfPaceSPerKm = roundNumber(buckets.second.durationSec / (buckets.second.distanceM / 1000), 2) ?? null;
    if (summary.firstHalfPaceSPerKm && summary.lastHalfPaceSPerKm) {
      summary.paceFadePct = roundNumber(
        Number(summary.lastHalfPaceSPerKm) / Number(summary.firstHalfPaceSPerKm) - 1,
        4
      ) ?? null;
    }
  }

  return summary;
}

function buildPaceZoneSummaries(laps: Array<Record<string, unknown>>, sport: string, totalDurationSec: number) {
  const valueKey = sport === "swim" ? "avgPacePer100mSec" : "avgPaceSecPerKm";
  const validLaps = laps
    .map((lap) => ({
      pace: nonNegativeNumber(lap[valueKey]),
      durationSec: nonNegativeNumber(lap.durationSec)
    }))
    .filter((lap): lap is { pace: number; durationSec: number } => lap.pace !== undefined && lap.durationSec !== undefined && lap.durationSec > 0);

  if (validLaps.length < 3) return [];

  const minPace = Math.min(...validLaps.map((lap) => lap.pace));
  const maxPace = Math.max(...validLaps.map((lap) => lap.pace));
  if (!Number.isFinite(minPace) || !Number.isFinite(maxPace) || maxPace <= minPace) return [];

  const bandSize = (maxPace - minPace) / 5;
  if (bandSize <= 0) return [];

  return Array.from({ length: 5 }, (_, index) => {
    const lower = minPace + bandSize * index;
    const upper = index === 4 ? maxPace : minPace + bandSize * (index + 1);
    const durationSec = validLaps.reduce((sum, lap) => {
      const inBand = index === 4 ? lap.pace >= lower && lap.pace <= upper : lap.pace >= lower && lap.pace < upper;
      return inBand ? sum + lap.durationSec : sum;
    }, 0);

    return {
      zone: index + 1,
      durationSec: roundNumber(durationSec, 3) ?? 0,
      pctOfSession: totalDurationSec > 0 ? roundNumber(durationSec / totalDurationSec, 4) ?? null : null,
      paceMin: roundNumber(lower, 2) ?? null,
      paceMax: roundNumber(upper, 2) ?? null
    };
  });
}

function buildSwimQualityWarnings(args: {
  subSportRaw?: string;
  poolLengthM?: number;
  lapSummaries: Array<Record<string, unknown>>;
  avgStrokeRateSpm?: number;
  avgSwolf?: number;
}) {
  const warnings: string[] = [];
  const isOpenWater = `${args.subSportRaw ?? ""}`.toLowerCase().includes("open");
  const restLaps = args.lapSummaries.filter((lap) => lap.isRest === true).length;
  const workLaps = args.lapSummaries.filter((lap) => (nonNegativeNumber(lap.distanceM) ?? 0) > 0).length;

  if (isOpenWater) warnings.push("openWaterDerivedMetricsLimited");
  if (!args.poolLengthM) warnings.push("poolLengthUnavailable");
  if (workLaps < 3) warnings.push("sparseSwimLapData");
  if (args.avgStrokeRateSpm === undefined) warnings.push("strokeRateUnavailable");
  if (args.avgSwolf === undefined) warnings.push("swolfUnavailable");
  if (restLaps === 0 && workLaps > 6) warnings.push("restStructureInferableOnly");

  return warnings;
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
  const avgPaceSecPerKm = normalizedSport === "run" && durationSec > 0 && distanceM > 0
    ? roundNumber(durationSec / (distanceM / 1000), 2)
    : undefined;

  const lapsCount = positiveInt(firstPositiveNumber([session.num_laps, fit?.laps?.length]));
  const maxHr = positiveInt(firstPositiveNumber([session.max_heart_rate]));
  const maxPower = positiveInt(firstPositiveNumber([session.max_power]));
  const avgCadence = positiveInt(firstPositiveNumber([session.avg_cadence, session.avg_running_cadence, session.avg_bike_cadence]));
  const maxCadence = positiveInt(firstPositiveNumber([session.max_cadence, session.max_running_cadence, session.max_bike_cadence]));
  const avgStrokeRateSpm = positiveInt(firstPositiveNumber([session.avg_stroke_rate, normalizedSport === "swim" ? session.avg_cadence : undefined]));
  const maxStrokeRateSpm = positiveInt(firstPositiveNumber([session.max_stroke_rate, normalizedSport === "swim" ? session.max_cadence : undefined]));
  const avgSwolf = positiveInt(firstPositiveNumber([session.avg_swolf]));
  const elevationGainM = positiveInt(firstPositiveNumber([session.total_ascent]));
  const elevationLossM = positiveInt(firstPositiveNumber([session.total_descent]));
  const normalizedPower = positiveInt(firstPositiveNumber([session.normalized_power]));
  const thresholdPower = positiveInt(firstPositiveNumber([session.threshold_power]));
  const intensityFactor = roundNumber(session.intensity_factor, 3);
  const trainingStressScore = roundNumber(session.training_stress_score, 1);
  const totalWorkKj = session.total_work ? roundNumber(Number(session.total_work) / 1000, 1) : undefined;
  const avgTemperature = roundNumber(session.avg_temperature, 1);
  const minTemperature = roundNumber(session.min_temperature, 1);
  const maxTemperature = roundNumber(session.max_temperature, 1);
  const avgRespirationRate = roundNumber(session.enhanced_avg_respiration_rate, 2);
  const minRespirationRate = roundNumber(session.enhanced_min_respiration_rate, 2);
  const maxRespirationRate = roundNumber(session.enhanced_max_respiration_rate, 2);
  const totalTrainingEffect = roundNumber(session.total_training_effect, 1);
  const anaerobicTrainingEffect = roundNumber(session.total_anaerobic_training_effect, 1);
  const trainingLoadPeak = roundNumber(session.training_load_peak, 1);
  const totalCycles = positiveInt(firstPositiveNumber([session.total_cycles]));
  const maxSpeed = firstPositiveNumber([session.enhanced_max_speed, session.max_speed]);
  const avgGradeAdjustedSpeed = firstPositiveNumber([session.avg_grade_adjusted_speed, session.enhanced_avg_grade_adjusted_speed]);
  const bestPaceSecPerKm = normalizedSport === "run" ? paceFromSpeed(maxSpeed, 1000) : undefined;
  const bestPacePer100mSec = normalizedSport === "swim" ? positiveInt(paceFromSpeed(maxSpeed, 100)) : undefined;
  const normalizedGradedPaceSecPerKm = normalizedSport === "run" ? paceFromSpeed(avgGradeAdjustedSpeed, 1000) : undefined;
  const lapSummaries = buildLapSummaries(Array.isArray(fit?.laps) ? fit.laps : [], normalizedSport);
  const splitSummaries = buildHalfSummaries(lapSummaries, durationSec, normalizedSport);
  const pauseSummary = buildPauseSummary(Array.isArray(fit?.events) ? fit.events : [], elapsedDurationSec, movingDurationSec);
  const sessionTimeInZone = pickSessionTimeInZoneEntry(fit as Record<string, unknown>);
  const timeInZoneRecord = asRecord(sessionTimeInZone);
  const powerZoneSummaries = timeInZoneRecord
    ? buildZoneSummaries({
        durations: timeInZoneRecord.time_in_power_zone,
        boundaries: timeInZoneRecord.power_zone_high_boundary,
        totalDurationSec: movingDurationSec ?? durationSec,
        valueKey: "power"
      })
    : [];
  const hrZoneSummaries = timeInZoneRecord
    ? buildZoneSummaries({
        durations: timeInZoneRecord.time_in_hr_zone,
        boundaries: timeInZoneRecord.hr_zone_high_boundary,
        totalDurationSec: movingDurationSec ?? durationSec,
        valueKey: "heartRate"
      })
    : [];
  const paceZoneSummaries = buildPaceZoneSummaries(lapSummaries, normalizedSport, movingDurationSec ?? durationSec);
  const activityMetrics = Array.isArray(fit?.activity_metrics) ? asRecord(fit.activity_metrics[0]) : null;
  const recoveryTimeSec = positiveInt(firstPositiveNumber([activityMetrics?.recovery_time]));
  const vo2Max = roundNumber(activityMetrics?.vo2_max, 2);
  const variabilityIndex =
    normalizedPower && session.avg_power
      ? roundNumber(normalizedPower / Number(session.avg_power), 3)
      : undefined;
  const leftRightBalance = asRecord(session.left_right_balance);
  const leftRightBalanceSummary = leftRightBalance
    ? {
        rightBalance: leftRightBalance.right === true,
        value: positiveInt(firstPositiveNumber([leftRightBalance.value])) ?? null
      }
    : null;

  const qualityMissing = [
    ["movingDurationSec", movingDurationSec],
    ["elapsedDurationSec", elapsedDurationSec],
    ["poolLengthM", poolLengthM],
    ["lapsCount", lapsCount],
    ["avgStrokeRateSpm", avgStrokeRateSpm],
    ["avgSwolf", avgSwolf],
    ["avgCadence", avgCadence],
    ["maxCadence", maxCadence],
    ["maxHr", maxHr],
    ["maxPower", maxPower],
    ["elevationGainM", elevationGainM],
    ["elevationLossM", elevationLossM],
    ["normalizedPower", normalizedPower],
    ["trainingStressScore", trainingStressScore],
    ["intensityFactor", intensityFactor],
    ["thresholdPower", thresholdPower],
    ["bestPaceSecPerKm", bestPaceSecPerKm],
    ["bestPacePer100mSec", bestPacePer100mSec]
  ].filter(([, value]) => value === undefined).map(([name]) => name);
  const qualityWarnings = normalizedSport === "swim"
    ? buildSwimQualityWarnings({
        subSportRaw,
        poolLengthM,
        lapSummaries,
        avgStrokeRateSpm,
        avgSwolf
      })
    : [];

  const end = new Date(start.getTime() + durationSec * 1000);
  const pauseCount = pauseSummary.count > 0 ? pauseSummary.count : undefined;
  const pausedDurationSec = typeof pauseSummary.totalPausedSec === "number" ? pauseSummary.totalPausedSec : undefined;
  const simplifiedLaps = lapSummaries.map((lap) => ({
    index: lap.index ?? null,
    duration_sec: lap.durationSec ?? null,
    distance_m: lap.distanceM ?? null,
    avg_hr: lap.avgHr ?? null,
    avg_power: lap.avgPower ?? null,
    normalized_power: lap.normalizedPower ?? null,
    avg_cadence: lap.avgCadence ?? null,
    trigger: lap.trigger ?? null
  }));

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
    bestPacePer100mSec,
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
        normalizedType: normalizedSport,
        sportProfileName: typeof session.sport_profile_name === "string" ? session.sport_profile_name : null
      },
      quality: {
        missing: qualityMissing,
        warnings: qualityWarnings
      },
      summary: {
        durationSec,
        movingDurationSec: movingDurationSec ?? null,
        elapsedDurationSec: elapsedDurationSec ?? null,
        distanceM: roundNumber(distanceM, 2) ?? null,
        avgPaceSecPerKm: avgPaceSecPerKm ?? null,
        avgPacePer100mSec: avgPacePer100mSec ?? null,
        recordsCount: Array.isArray(fit?.records) ? fit.records.length : 0,
        lapsCount: lapsCount ?? lapSummaries.length,
        pauseCount: pauseCount ?? 0,
        pausedDurationSec: pausedDurationSec ?? null
      },
      pace: {
        avgPaceSecPerKm: avgPaceSecPerKm ?? null,
        bestPaceSecPerKm: bestPaceSecPerKm ?? null,
        normalizedGradedPaceSecPerKm: normalizedGradedPaceSecPerKm ?? null,
        avgPacePer100mSec: avgPacePer100mSec ?? null,
        bestPacePer100mSec: bestPacePer100mSec ?? null
      },
      power: {
        avgPower: session.avg_power ? Number(session.avg_power) : null,
        normalizedPower: normalizedPower ?? null,
        maxPower: maxPower ?? null,
        thresholdPower: thresholdPower ?? null,
        variabilityIndex: variabilityIndex ?? null,
        intensityFactor: intensityFactor ?? null,
        totalWorkKj: totalWorkKj ?? null,
        leftRightBalance: leftRightBalanceSummary
      },
      load: {
        trainingStressScore: trainingStressScore ?? null,
        aerobicTrainingEffect: totalTrainingEffect ?? null,
        anaerobicTrainingEffect: anaerobicTrainingEffect ?? null,
        recoveryTimeSec: recoveryTimeSec ?? null,
        trainingLoadPeak: trainingLoadPeak ?? null,
        primaryBenefit: session.primary_benefit ?? null,
        vo2Max: vo2Max ?? null
      },
      heartRate: {
        avgHr: session.avg_heart_rate ? Number(session.avg_heart_rate) : null,
        maxHr: maxHr ?? null,
        thresholdHr: positiveInt(firstPositiveNumber([timeInZoneRecord?.threshold_heart_rate])) ?? null
      },
      cadence: {
        avgCadence: avgCadence ?? null,
        maxCadence: maxCadence ?? null,
        totalCycles: totalCycles ?? null
      },
      stroke: normalizedSport === "swim"
        ? {
            avgStrokeRateSpm: avgStrokeRateSpm ?? null,
            maxStrokeRateSpm: maxStrokeRateSpm ?? null,
            avgSwolf: avgSwolf ?? null,
            strokeType: subSportRaw ?? null
          }
        : null,
      elevation: {
        gainM: elevationGainM ?? null,
        lossM: elevationLossM ?? null
      },
      environment: {
        temperature: avgTemperature ?? null,
        avgTemperature: avgTemperature ?? null,
        minTemperature: minTemperature ?? null,
        maxTemperature: maxTemperature ?? null,
        avgRespirationRate: avgRespirationRate ?? null,
        minRespirationRate: minRespirationRate ?? null,
        maxRespirationRate: maxRespirationRate ?? null
      },
      pauses: {
        count: pauseCount ?? 0,
        totalPausedSec: pausedDurationSec ?? null
      },
      zones: {
        functionalThresholdPower: positiveInt(firstPositiveNumber([timeInZoneRecord?.functional_threshold_power, thresholdPower])) ?? null,
        thresholdHeartRate: positiveInt(firstPositiveNumber([timeInZoneRecord?.threshold_heart_rate])) ?? null,
        powerCalcType: typeof timeInZoneRecord?.pwr_calc_type === "string" ? timeInZoneRecord.pwr_calc_type : null,
        power: powerZoneSummaries,
        hr: hrZoneSummaries,
        heartRate: hrZoneSummaries,
        pace: paceZoneSummaries
      },
      pool: normalizedSport === "swim"
        ? {
            poolLengthM: poolLengthM ?? null,
            lengthCount: totalCycles ?? null
          }
        : null,
      splits: splitSummaries,
      halves: splitSummaries,
      laps: lapSummaries,
      events: pauseSummary.events
    },
    parseSummary: {
      records: Array.isArray(fit?.records) ? fit.records.length : 0,
      movingDurationSec,
      elapsedDurationSec,
      poolLengthMeters: poolLengthM,
      pauseCount: pauseCount ?? 0,
      pausedDurationSec: pausedDurationSec ?? null,
      laps: simplifiedLaps,
      ...buildPaceSummary(durationSec, distanceM)
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
  const maxCadence = cadenceValues.length ? Math.max(...cadenceValues) : undefined;

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
  const avgPaceSecPerKm = normalizedSport === "run" && durationSec > 0 && distanceM > 0
    ? roundNumber(durationSec / (distanceM / 1000), 2)
    : undefined;
  const lapSummaries = laps.map((lap, index) => {
    const lapTrackpoints = asArray(lap.Track?.Trackpoint);
    const lapCadenceValues = lapTrackpoints.map((trackpoint) => Number(trackpoint.Cadence ?? 0)).filter((value) => value > 0);
    const lapAltitudes = lapTrackpoints
      .map((trackpoint) => Number(trackpoint.AltitudeMeters ?? Number.NaN))
      .filter((value) => Number.isFinite(value));
    let lapGain = 0;
    let lapLoss = 0;
    for (let i = 1; i < lapAltitudes.length; i += 1) {
      const delta = lapAltitudes[i] - lapAltitudes[i - 1];
      if (delta > 0) lapGain += delta;
      if (delta < 0) lapLoss += Math.abs(delta);
    }

    const lapDurationSec = roundNumber(lap.TotalTimeSeconds, 3);
    const lapDistanceM = roundNumber(lap.DistanceMeters, 2);
    const lapPace = lapDurationSec && lapDistanceM && lapDistanceM > 0
      ? normalizedSport === "swim"
        ? roundNumber(lapDurationSec / (lapDistanceM / 100), 2)
        : roundNumber(lapDurationSec / (lapDistanceM / 1000), 2)
      : null;

    return {
      index: index + 1,
      startTime: typeof lap.StartTime === "string" ? lap.StartTime : null,
      durationSec: lapDurationSec ?? null,
      elapsedDurationSec: lapDurationSec ?? null,
      distanceM: lapDistanceM ?? null,
      avgHr: positiveInt(lap.AverageHeartRateBpm?.Value) ?? null,
      maxHr: positiveInt(lap.MaximumHeartRateBpm?.Value) ?? null,
      avgPower: null,
      normalizedPower: null,
      maxPower: null,
      avgCadence: lapCadenceValues.length ? Math.round(lapCadenceValues.reduce((sum, value) => sum + value, 0) / lapCadenceValues.length) : null,
      maxCadence: lapCadenceValues.length ? Math.max(...lapCadenceValues) : null,
      calories: positiveInt(lap.Calories) ?? null,
      workKj: null,
      intensity: null,
      trigger: index === laps.length - 1 ? "session_end" : "lap",
      avgPaceSecPerKm: normalizedSport === "run" ? lapPace : null,
      avgPacePer100mSec: normalizedSport === "swim" ? lapPace : null,
      elevationGainM: roundNumber(lapGain, 1) ?? null,
      elevationLossM: roundNumber(lapLoss, 1) ?? null
    };
  });
  const splitSummaries = buildHalfSummaries(lapSummaries, durationSec, normalizedSport);
  const paceZoneSummaries = buildPaceZoneSummaries(lapSummaries, normalizedSport, durationSec);
  const qualityWarnings = normalizedSport === "swim"
    ? buildSwimQualityWarnings({
        subSportRaw: undefined,
        poolLengthM,
        lapSummaries,
        avgStrokeRateSpm: undefined,
        avgSwolf: undefined
      })
    : (avgCadence === undefined ? ["cadenceSparseFromTcx"] : []);

  const missing = [
    ["movingDurationSec", movingDurationSec],
    ["poolLengthM", poolLengthM],
    ["avgCadence", avgCadence],
    ["maxCadence", maxCadence],
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
        warnings: [
          ...(movingDurationSec === undefined ? ["movingDurationUnavailableInTcx"] : []),
          ...qualityWarnings
        ]
      },
      summary: {
        durationSec,
        movingDurationSec: movingDurationSec ?? null,
        elapsedDurationSec: elapsedDurationSec ?? null,
        distanceM: roundNumber(distanceM, 2) ?? null,
        avgPaceSecPerKm: avgPaceSecPerKm ?? null,
        avgPacePer100mSec: avgPacePer100mSec ?? null,
        lapsCount: lapsCount ?? lapSummaries.length
      },
      pace: {
        avgPaceSecPerKm: avgPaceSecPerKm ?? null,
        bestPaceSecPerKm: lapSummaries
          .map((lap) => nonNegativeNumber(lap.avgPaceSecPerKm))
          .filter((value): value is number => value !== undefined)
          .reduce<number | null>((best, value) => best === null ? value : Math.min(best, value), null),
        avgPacePer100mSec: avgPacePer100mSec ?? null,
        bestPacePer100mSec: lapSummaries
          .map((lap) => nonNegativeNumber(lap.avgPacePer100mSec))
          .filter((value): value is number => value !== undefined)
          .reduce<number | null>((best, value) => best === null ? value : Math.min(best, value), null)
      },
      heartRate: {
        avgHr,
        maxHr: maxHr ?? null
      },
      cadence: {
        avgCadence: avgCadence ?? null,
        maxCadence: maxCadence ?? null
      },
      elevation: {
        gainM: elevationGainM ?? null,
        lossM: elevationLossM ?? null
      },
      environment: {
        temperature: null
      },
      zones: {
        hr: [],
        heartRate: [],
        pace: paceZoneSummaries
      },
      splits: splitSummaries,
      halves: splitSummaries,
      laps: lapSummaries,
      pool: normalizedSport === "swim"
        ? {
            poolLengthM: null,
            lengthCount: null
          }
        : null
    },
    parseSummary: {
      lapCount: laps.length,
      movingDurationSec,
      elapsedDurationSec,
      ...buildPaceSummary(durationSec, distanceM)
    }
  };
}
