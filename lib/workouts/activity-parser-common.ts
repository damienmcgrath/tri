import { createHash } from "crypto";
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

export type RaceSegmentRole = "swim" | "t1" | "bike" | "t2" | "run";

export type ParsedMultisportSegment = ParsedActivity & {
  role: RaceSegmentRole;
  segmentIndex: number;
};

export type ParsedMultisportActivity = {
  kind: "multisport";
  bundle: {
    startedAt: string;
    endedAt: string;
    totalDurationSec: number;
    totalDistanceM: number;
    source: "garmin_multisport";
  };
  segments: ParsedMultisportSegment[];
};

export type ParsedFitFile = ParsedActivity | ParsedMultisportActivity;

export function isMultisportParseResult(result: ParsedFitFile): result is ParsedMultisportActivity {
  return (result as ParsedMultisportActivity).kind === "multisport";
}

export function sha256Hex(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

export const tcxParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: true,
  trimValues: true,
  processEntities: false,
  htmlEntities: false,
});

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function roundNumber(value: unknown, decimals = 2): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : undefined;
}

export function positiveInt(value: unknown): number | undefined {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function nonNegativeNumber(value: unknown): number | undefined {
  if (value === null || typeof value === "undefined" || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function firstPositiveNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = positiveNumber(value);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

export function normalizeSport(raw?: string) {
  const sport = (raw ?? "").toLowerCase();
  if (sport.includes("run")) return "run";
  if (sport.includes("bike") || sport.includes("cycl")) return "bike";
  if (sport.includes("swim")) return "swim";
  if (sport.includes("functional") || sport.includes("cross") || sport.includes("hiit")) return "functional_fitness";
  if (sport.includes("weight")) return "weightlifting";
  if (sport.includes("strength")) return "strength";
  return "other";
}

export function normalizeActivityType(rawType?: string, rawSubtype?: string) {
  const joined = `${rawType ?? ""} ${rawSubtype ?? ""}`.toLowerCase();
  if (joined.includes("swim")) return "swim";
  if (joined.includes("bike") || joined.includes("cycl")) return "bike";
  if (joined.includes("run") || joined.includes("trail") || joined.includes("treadmill")) return "run";
  if (joined.includes("functional") || joined.includes("cross") || joined.includes("hiit")) return "functional_fitness";
  if (joined.includes("weight")) return "weightlifting";
  if (joined.includes("strength")) return "strength";
  return normalizeSport(rawType);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function pickSessionTimeInZoneEntry(fit: Record<string, unknown>) {
  const entries = Array.isArray(fit.time_in_zone) ? fit.time_in_zone : [];
  return entries.find((entry) => asRecord(entry)?.reference_mesg === 18) ?? entries[0] ?? null;
}

export function buildPaceSummary(durationSec: number, distanceM: number) {
  if (durationSec <= 0 || distanceM <= 0) {
    return {};
  }

  return {
    avgPaceSecPerKm: Number((durationSec / (distanceM / 1000)).toFixed(2)),
    avgPaceSecPer100m: Number((durationSec / (distanceM / 100)).toFixed(2))
  };
}

export function paceFromSpeed(speedMetersPerSecond: number | undefined, unitMeters: number) {
  if (!speedMetersPerSecond || speedMetersPerSecond <= 0) return undefined;
  return roundNumber(unitMeters / speedMetersPerSecond, 2);
}

export function buildZoneSummaries(args: {
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

export function buildLapSummaries(laps: unknown[], sport: string) {
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

export function buildPauseSummary(events: unknown[], elapsedDurationSec?: number, movingDurationSec?: number) {
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

export function buildHalfSummaries(laps: Array<Record<string, unknown>>, durationSec: number, sport: string) {
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

export function buildPaceZoneSummaries(laps: Array<Record<string, unknown>>, sport: string, totalDurationSec: number) {
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

export function buildSwimQualityWarnings(args: {
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
