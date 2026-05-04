/**
 * Strava activity normalizer.
 *
 * Maps a Strava API activity summary (from GET /activities/{id} or
 * GET /athlete/activities) into the shape expected by the
 * completed_activities INSERT. Pure function — no I/O, no Supabase.
 */

// Strava activity summary shape (subset of fields we use)
export type StravaActivitySummary = {
  id: number;
  name: string;
  /** New field (2022+) — prefer over `type` */
  sport_type?: string;
  /** Legacy field — fallback when sport_type absent */
  type?: string;
  /** ISO 8601 UTC */
  start_date: string;
  /** Total elapsed time including pauses, seconds */
  elapsed_time: number;
  /** Moving time excluding pauses, seconds */
  moving_time: number;
  /** Meters */
  distance: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  max_watts?: number;
  /** Normalized power (Strava's equivalent) */
  weighted_average_watts?: number;
  average_cadence?: number;
  calories?: number;
  /** Detailed activity fields (present on GET /activities/{id}) */
  average_temp?: number;
  /** Strava's relative effort / training load */
  suffer_score?: number;
  device_name?: string;
  description?: string;
  /** Laps (from detailed endpoint) */
  laps?: StravaLap[];
  /** Per-km splits (from detailed endpoint) */
  splits_metric?: StravaSplit[];
  /** Best efforts (from detailed endpoint, e.g. best 1km, 1mi) */
  best_efforts?: StravaBestEffort[];
};

export type StravaLap = {
  lap_index: number;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  average_cadence?: number;
  total_elevation_gain?: number;
};

export type StravaSplit = {
  split: number;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  elevation_difference?: number;
  average_heartrate?: number;
  average_speed?: number;
  pace_zone?: number;
};

export type StravaBestEffort = {
  name: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
};

// Shape compatible with completed_activities INSERT
export type NormalizedStravaActivity = {
  user_id: string;
  sport_type: string;
  swim_type: "pool" | "open_water" | null;
  start_time_utc: string;
  end_time_utc: string;
  duration_sec: number;
  moving_duration_sec: number;
  elapsed_duration_sec: number;
  distance_m: number;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  max_power: number | null;
  avg_cadence: number | null;
  avg_pace_per_100m_sec: number | null;
  laps_count: number | null;
  calories: number | null;
  activity_type_raw: string | null;
  external_provider: "strava";
  external_activity_id: string;
  external_title: string;
  source: "strava";
  activity_vendor: "strava";
  schedule_status: "unscheduled";
  is_unplanned: boolean;
  metrics_v2: Record<string, unknown>;
};

/**
 * Maps a Strava sport_type/type string to our internal sport enum.
 * Exported for testing.
 */
export function mapStravaSportType(raw: string): string {
  switch (raw) {
    case "Run":
    case "TrailRun":
    case "VirtualRun":
      return "run";
    case "Ride":
    case "VirtualRide":
    case "GravelRide":
    case "EBikeRide":
    case "MountainBikeRide":
    case "Handcycle":
      return "bike";
    case "Swim":
    case "OpenWaterSwim":
      return "swim";
    case "WeightTraining":
    case "Yoga":
    case "Crossfit":
    case "Workout":
    case "Elliptical":
    case "StairStepper":
    case "RockClimbing":
    case "Pilates":
      return "strength";
    default:
      return "other";
  }
}

/**
 * Maps a Strava sport_type/type string to a swim sub-classification.
 * Returns null for non-swim activities. Exported for testing.
 */
export function mapStravaSwimType(raw: string): "pool" | "open_water" | null {
  if (raw === "OpenWaterSwim") return "open_water";
  if (raw === "Swim") return "pool";
  return null;
}

function nullIfZero(val: number | undefined | null): number | null {
  if (val === undefined || val === null || val === 0) return null;
  return val;
}

function roundOrNull(val: number | undefined | null): number | null {
  if (val === undefined || val === null || val === 0) return null;
  return Math.round(val);
}

function computePacePer100m(movingTimeSec: number, distanceM: number): number | null {
  if (movingTimeSec <= 0 || distanceM <= 0) return null;
  return Number((movingTimeSec / (distanceM / 100)).toFixed(2));
}

function computePacePerKm(movingTimeSec: number, distanceM: number): number | null {
  if (movingTimeSec <= 0 || distanceM <= 0) return null;
  return Number((movingTimeSec / (distanceM / 1000)).toFixed(2));
}

function computeEndTimeUtc(startDate: string, elapsedTimeSec: number): string {
  const startMs = new Date(startDate).getTime();
  return new Date(startMs + elapsedTimeSec * 1000).toISOString();
}

function buildLapSummaries(laps: StravaLap[] | undefined, sport: string): Record<string, unknown>[] | null {
  if (!laps || laps.length === 0) return null;
  const isSwim = sport === "swim";

  // For swim: compute median distance to detect rest laps (distance = 0 or < 20% of median)
  let medianDistance = 0;
  if (isSwim) {
    const distances = laps.map((l) => l.distance).filter((d) => d > 0).sort((a, b) => a - b);
    if (distances.length > 0) {
      medianDistance = distances[Math.floor(distances.length / 2)];
    }
  }

  return laps.map((lap) => {
    const base: Record<string, unknown> = {
      index: lap.lap_index,
      durationSec: lap.elapsed_time,
      movingDurationSec: lap.moving_time,
      distanceM: lap.distance,
      avgHr: roundOrNull(lap.average_heartrate),
      maxHr: roundOrNull(lap.max_heartrate),
      avgPower: roundOrNull(lap.average_watts),
      elevationGainM: nullIfZero(lap.total_elevation_gain),
    };

    if (isSwim) {
      // Map cadence → stroke rate for swim (Strava reports strokes/min as cadence)
      base.avgStrokeRateSpm = roundOrNull(lap.average_cadence);
      // Derive per-lap pace
      if (lap.distance > 0 && lap.elapsed_time > 0) {
        base.avgPacePer100mSec = Math.round(lap.elapsed_time / (lap.distance / 100));
      }
      // Infer rest laps: distance is 0 or very small relative to other laps
      const isRest = lap.distance === 0 || (medianDistance > 0 && lap.distance < medianDistance * 0.2);
      if (isRest) {
        base.isRest = true;
        base.restSec = lap.elapsed_time;
      }
    } else {
      base.avgCadence = roundOrNull(lap.average_cadence);
      // Per-lap pace for run (sec/km) so halves-from-laps and lap-level
      // pacing analyses can compute. Strava stops short of providing a
      // pace field — derive it from elapsed_time / distance when both are
      // present and non-zero. Bike doesn't get a pace field; bike halves
      // come from avgPower (already on `base` above).
      if (sport === "run" && lap.distance > 0 && lap.elapsed_time > 0) {
        base.avgPaceSecPerKm = Math.round(lap.elapsed_time / (lap.distance / 1000));
      }
    }

    return base;
  });
}

type SplitHalves = {
  firstHalfAvgHr: number | null;
  lastHalfAvgHr: number | null;
  firstHalfPaceSPerKm: number | null;
  lastHalfPaceSPerKm: number | null;
  hrDriftPct: number | null;
  paceFadePct: number | null;
};

const EMPTY_SPLIT_HALVES: SplitHalves = {
  firstHalfAvgHr: null,
  lastHalfAvgHr: null,
  firstHalfPaceSPerKm: null,
  lastHalfPaceSPerKm: null,
  hrDriftPct: null,
  paceFadePct: null
};

function buildSplitSummaries(
  splits: StravaSplit[] | undefined,
  sport: string
): SplitHalves {
  if (!splits || splits.length < 4) return EMPTY_SPLIT_HALVES;

  const mid = Math.floor(splits.length / 2);
  const firstHalf = splits.slice(0, mid);
  const lastHalf = splits.slice(mid);

  // HR drift: average HR second half vs first half
  const firstHalfHrs = firstHalf.map((s) => s.average_heartrate).filter((v): v is number => v != null && v > 0);
  const lastHalfHrs = lastHalf.map((s) => s.average_heartrate).filter((v): v is number => v != null && v > 0);
  let firstHalfAvgHr: number | null = null;
  let lastHalfAvgHr: number | null = null;
  let hrDriftPct: number | null = null;
  if (firstHalfHrs.length > 0 && lastHalfHrs.length > 0) {
    const firstAvg = firstHalfHrs.reduce((a, b) => a + b, 0) / firstHalfHrs.length;
    const lastAvg = lastHalfHrs.reduce((a, b) => a + b, 0) / lastHalfHrs.length;
    firstHalfAvgHr = Math.round(firstAvg);
    lastHalfAvgHr = Math.round(lastAvg);
    if (firstAvg > 0) {
      hrDriftPct = Number((((lastAvg - firstAvg) / firstAvg) * 100).toFixed(1));
    }
  }

  // Pace fade: average speed second half vs first half. Pace halves only
  // populated for run (same gate as top-level avg_pace_sec_per_km) — swim pace
  // comes from stroke telemetry, bike doesn't use pace.
  const firstHalfSpeeds = firstHalf.map((s) => s.average_speed).filter((v): v is number => v != null && v > 0);
  const lastHalfSpeeds = lastHalf.map((s) => s.average_speed).filter((v): v is number => v != null && v > 0);
  let firstHalfPaceSPerKm: number | null = null;
  let lastHalfPaceSPerKm: number | null = null;
  let paceFadePct: number | null = null;
  if (firstHalfSpeeds.length > 0 && lastHalfSpeeds.length > 0) {
    const firstAvgSpeed = firstHalfSpeeds.reduce((a, b) => a + b, 0) / firstHalfSpeeds.length;
    const lastAvgSpeed = lastHalfSpeeds.reduce((a, b) => a + b, 0) / lastHalfSpeeds.length;
    if (sport === "run") {
      if (firstAvgSpeed > 0) firstHalfPaceSPerKm = Number((1000 / firstAvgSpeed).toFixed(2));
      if (lastAvgSpeed > 0) lastHalfPaceSPerKm = Number((1000 / lastAvgSpeed).toFixed(2));
    }
    if (firstAvgSpeed > 0) {
      // Negative means slowed down (higher pace = slower)
      paceFadePct = Number((((firstAvgSpeed - lastAvgSpeed) / firstAvgSpeed) * 100).toFixed(1));
    }
  }

  return {
    firstHalfAvgHr,
    lastHalfAvgHr,
    firstHalfPaceSPerKm,
    lastHalfPaceSPerKm,
    hrDriftPct,
    paceFadePct
  };
}

export function normalizeStravaActivity(
  raw: StravaActivitySummary,
  userId: string
): NormalizedStravaActivity {
  // Prefer sport_type (new field), fall back to type (legacy)
  const rawSportType = raw.sport_type ?? raw.type ?? "Workout";
  const normalizedSport = mapStravaSportType(rawSportType);
  const swimType = mapStravaSwimType(rawSportType);

  const avgHr = roundOrNull(raw.average_heartrate);
  const maxHr = roundOrNull(raw.max_heartrate);
  const avgPower = roundOrNull(raw.average_watts);
  const maxPower = roundOrNull(raw.max_watts);
  const normalizedPower = roundOrNull(raw.weighted_average_watts);
  const avgCadence = roundOrNull(raw.average_cadence);
  const distanceM = raw.distance ?? 0;
  const movingTimeSec = raw.moving_time;
  const elapsedTimeSec = raw.elapsed_time;

  const avgPacePer100mSec = (normalizedSport === "swim" || normalizedSport === "run")
    ? computePacePer100m(movingTimeSec, distanceM)
    : null;
  const avgPaceSecPerKm = (normalizedSport === "run")
    ? computePacePerKm(movingTimeSec, distanceM)
    : null;

  const lapsCount = raw.laps?.length ?? null;
  const lapSummaries = buildLapSummaries(raw.laps, normalizedSport);
  const splitHalves = buildSplitSummaries(raw.splits_metric, normalizedSport);
  const hasSplitData = Object.values(splitHalves).some((v) => v !== null);

  // Pause duration from elapsed vs moving time
  const pausedDurationSec = elapsedTimeSec > movingTimeSec
    ? elapsedTimeSec - movingTimeSec
    : null;

  // Build metrics_v2 matching the FIT parser schema for downstream compatibility
  const metricsV2: Record<string, unknown> = {
    schemaVersion: 1,
    sourceFormat: "strava",
    activity: {
      vendor: "strava",
      rawType: rawSportType,
      rawSubType: null,
      normalizedType: normalizedSport,
      swimType,
      sportProfileName: null
    },
    quality: {
      missing: buildMissingFields(raw),
      warnings: []
    },
    summary: {
      durationSec: elapsedTimeSec,
      movingDurationSec: movingTimeSec,
      elapsedDurationSec: elapsedTimeSec,
      distanceM,
      avgPaceSecPerKm: avgPaceSecPerKm ?? null,
      avgPacePer100mSec: avgPacePer100mSec ?? null,
      lapsCount: lapsCount ?? 0,
      pauseCount: pausedDurationSec != null && pausedDurationSec > 0 ? 1 : 0,
      pausedDurationSec: pausedDurationSec ?? null
    },
    pace: {
      avgPaceSecPerKm: avgPaceSecPerKm ?? null,
      bestPaceSecPerKm: null, // not available from Strava summary
      avgPacePer100mSec: avgPacePer100mSec ?? null,
      bestPacePer100mSec: null
    },
    power: {
      avgPower: avgPower,
      normalizedPower: normalizedPower,
      maxPower: maxPower,
      thresholdPower: null, // not available from Strava
      variabilityIndex: normalizedPower && avgPower ? Number((normalizedPower / avgPower).toFixed(2)) : null,
      intensityFactor: null, // needs threshold power
      totalWorkKj: avgPower && movingTimeSec > 0
        ? Number(((avgPower * movingTimeSec) / 1000).toFixed(1))
        : null,
      leftRightBalance: null
    },
    load: {
      trainingStressScore: null, // needs threshold power
      aerobicTrainingEffect: null,
      anaerobicTrainingEffect: null,
      recoveryTimeSec: null,
      trainingLoadPeak: null,
      primaryBenefit: null,
      vo2Max: null,
      sufferScore: nullIfZero(raw.suffer_score)
    },
    heartRate: {
      avgHr,
      maxHr,
      thresholdHr: null
    },
    cadence: {
      avgCadence,
      maxCadence: null,
      totalCycles: null
    },
    stroke: normalizedSport === "swim"
      ? {
          // Strava reports swim cadence as strokes/min in average_cadence
          avgStrokeRateSpm: avgCadence,
          maxStrokeRateSpm: null,
          avgSwolf: null, // not available from summary API
          strokeType: null
        }
      : null,
    elevation: {
      gainM: nullIfZero(raw.total_elevation_gain),
      lossM: null // not available from Strava
    },
    environment: {
      temperature: nullIfZero(raw.average_temp),
      avgTemperature: nullIfZero(raw.average_temp),
      minTemperature: null,
      maxTemperature: null,
      avgRespirationRate: null,
      minRespirationRate: null,
      maxRespirationRate: null
    },
    pauses: {
      count: pausedDurationSec != null && pausedDurationSec > 0 ? 1 : 0,
      totalPausedSec: pausedDurationSec ?? null
    },
    splits: hasSplitData ? { ...splitHalves } : null,
    halves: hasSplitData ? { ...splitHalves } : null,
    laps: lapSummaries,
    events: null
  };

  return {
    user_id: userId,
    sport_type: normalizedSport,
    swim_type: swimType,
    start_time_utc: raw.start_date,
    end_time_utc: computeEndTimeUtc(raw.start_date, elapsedTimeSec),
    duration_sec: elapsedTimeSec,
    moving_duration_sec: movingTimeSec,
    elapsed_duration_sec: elapsedTimeSec,
    distance_m: distanceM,
    elevation_gain_m: nullIfZero(raw.total_elevation_gain),
    avg_hr: avgHr,
    max_hr: maxHr,
    avg_power: avgPower,
    max_power: maxPower,
    avg_cadence: normalizedSport === "swim" ? null : avgCadence, // swim cadence → stroke rate in metrics_v2
    avg_pace_per_100m_sec: avgPacePer100mSec != null ? Math.round(avgPacePer100mSec) : null,
    laps_count: lapsCount,
    calories: nullIfZero(raw.calories),
    activity_type_raw: rawSportType,
    external_provider: "strava",
    external_activity_id: String(raw.id),
    external_title: raw.name ?? "",
    source: "strava",
    activity_vendor: "strava",
    schedule_status: "unscheduled",
    is_unplanned: false,
    metrics_v2: metricsV2
  };
}

/** Track which fields Strava didn't provide, for quality reporting. */
function buildMissingFields(raw: StravaActivitySummary): string[] {
  const missing: string[] = [];
  if (raw.average_heartrate == null) missing.push("heartRate");
  if (raw.average_watts == null) missing.push("power");
  if (raw.average_cadence == null) missing.push("cadence");
  if (raw.calories == null) missing.push("calories");
  if (raw.total_elevation_gain == null) missing.push("elevation");
  if (raw.average_temp == null) missing.push("temperature");
  if (!raw.laps || raw.laps.length === 0) missing.push("laps");
  if (!raw.splits_metric || raw.splits_metric.length === 0) missing.push("splits");
  // Always missing from Strava
  missing.push("zones", "trainingEffect", "recoveryTime");
  return missing;
}
