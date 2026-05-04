import FitParser from "fit-file-parser";

import {
  asArray,
  asRecord,
  buildHalfSummaries,
  buildLapSummaries,
  buildPaceSummary,
  buildPaceZoneSummaries,
  buildPauseSummary,
  buildSwimQualityWarnings,
  buildZoneSummaries,
  firstPositiveNumber,
  normalizeActivityType,
  paceFromSpeed,
  pickSessionTimeInZoneEntry,
  positiveInt,
  positiveNumber,
  roundNumber,
  type ParsedActivity,
  type ParsedFitFile,
  type ParsedMultisportActivity,
  type ParsedMultisportSegment,
  type RaceSegmentRole
} from "./activity-parser-common";

function deriveElapsedFromLaps(laps: unknown): number | undefined {
  const arr = asArray(laps as unknown[]);
  if (arr.length === 0) return undefined;
  let sum = 0;
  for (const lap of arr) {
    const record = asRecord(lap);
    const lapSec = record
      ? positiveNumber(record.total_elapsed_time) ?? positiveNumber(record.total_timer_time)
      : undefined;
    if (lapSec === undefined) return undefined;
    sum += lapSec;
  }
  return positiveInt(sum);
}

function deriveElapsedFromRecords(records: unknown): number | undefined {
  const arr = asArray(records as unknown[]);
  if (arr.length < 2) return undefined;
  const firstRecord = asRecord(arr[0]);
  const lastRecord = asRecord(arr[arr.length - 1]);
  if (!firstRecord || !lastRecord) return undefined;
  const firstMs = new Date(firstRecord.timestamp as string | number | Date).getTime();
  const lastMs = new Date(lastRecord.timestamp as string | number | Date).getTime();
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return undefined;
  return positiveInt((lastMs - firstMs) / 1000);
}

function deriveElapsedFromSessionSpan(session: Record<string, unknown>): number | undefined {
  const startMs = new Date(session.start_time as string | number | Date).getTime();
  const endMs = new Date(session.timestamp as string | number | Date).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return undefined;
  return positiveInt((endMs - startMs) / 1000);
}

function deriveElapsedFromActivity(activity: unknown): number | undefined {
  const record = asRecord(Array.isArray(activity) ? activity[0] : activity);
  if (!record) return undefined;
  return positiveInt(firstPositiveNumber([record.total_timer_time, record.total_elapsed_time]));
}

function deriveElapsedFromDistanceSpeed(session: Record<string, unknown>): number | undefined {
  const distance = positiveNumber(session.total_distance);
  const speed = positiveNumber(session.avg_speed) ?? positiveNumber(session.enhanced_avg_speed);
  if (!distance || !speed) return undefined;
  return positiveInt(distance / speed);
}

export async function parseFitFile(buffer: Buffer): Promise<ParsedFitFile> {
  const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m", temperatureUnit: "celsius" });

  const fit = await new Promise<any>((resolve, reject) => {
    parser.parse(buffer as any, (error: unknown, data: unknown) => {
      if (error) reject(error);
      else resolve(data);
    });
  });

  const sessions = Array.isArray(fit?.sessions) ? fit.sessions : [];
  if (sessions.length === 0 || !sessions[0]?.start_time) {
    throw new Error("FIT file missing session start time.");
  }

  const isMultisport = fit?.activity?.type === "auto_multi_sport" || sessions.length > 1;
  if (isMultisport) {
    return buildMultisportFromFit(fit, sessions);
  }

  return buildParsedActivityFromSession(sessions[0], fit);
}

function buildParsedActivityFromSession(session: any, fit: any): ParsedActivity {
  const start = new Date(session.start_time);
  const movingDurationSec = positiveInt(firstPositiveNumber([session.total_timer_time, session.total_moving_time]));
  const elapsedDurationSec =
    positiveInt(firstPositiveNumber([session.total_elapsed_time, session.total_time, movingDurationSec]))
    ?? deriveElapsedFromLaps(fit?.laps)
    ?? deriveElapsedFromRecords(fit?.records)
    ?? deriveElapsedFromSessionSpan(session)
    ?? deriveElapsedFromActivity(fit?.activity)
    ?? deriveElapsedFromDistanceSpeed(session);
  const durationSec = movingDurationSec ?? elapsedDurationSec ?? 0;
  const poolLengthM = firstPositiveNumber([session.pool_length, session.pool_length_m]);

  if (durationSec <= 0) {
    const sportLower = `${session.sport ?? ""}`.toLowerCase();
    const subSportLower = `${session.sub_sport ?? ""}`.toLowerCase();
    const isManualEntryCandidate =
      sportLower === "training" ||
      subSportLower.includes("strength") ||
      subSportLower.includes("cardio") ||
      sportLower === "fitness_equipment" ||
      sportLower === "generic";
    if (!isManualEntryCandidate) {
      throw new Error("FIT file missing usable duration.");
    }
    console.warn("[UPLOAD_PARSE] FIT duration fallbacks exhausted — accepting 0-duration manual-entry activity", {
      sport: session.sport ?? null,
      subSport: session.sub_sport ?? null
    });
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

function sessionTimeWindow(session: any): { startMs: number; endMs: number } {
  const startMs = new Date(session.start_time).getTime();
  const elapsed = Number(
    firstPositiveNumber([session.total_elapsed_time, session.total_timer_time]) ?? 0
  );
  const endMs = startMs + Math.max(0, elapsed) * 1000;
  return { startMs, endMs };
}

function withinWindow(timestamp: unknown, startMs: number, endMs: number): boolean {
  if (typeof timestamp !== "string" && !(timestamp instanceof Date)) return false;
  const ms = new Date(timestamp as string | Date).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms >= startMs && ms <= endMs;
}

function sliceFitForSession(fit: any, session: any, sessionIndex: number) {
  const { startMs, endMs } = sessionTimeWindow(session);

  const sliceByTimestamp = (rows: unknown) =>
    Array.isArray(rows)
      ? rows.filter((row) => {
          const r = asRecord(row);
          if (!r) return false;
          return withinWindow(r.timestamp ?? r.start_time, startMs, endMs);
        })
      : [];

  const allTimeInZone = Array.isArray(fit?.time_in_zone) ? fit.time_in_zone : [];
  // Each `time_in_zone` entry corresponds to a session message; for multisport we pick
  // the entry whose ordinal index matches this session.
  const sessionTizEntries = allTimeInZone.filter((entry: unknown) => {
    const r = asRecord(entry);
    return r?.reference_mesg === 18 || r?.reference_mesg === "session";
  });
  const tizForSession = sessionTizEntries[sessionIndex] ?? sessionTizEntries[0] ?? null;

  return {
    laps: sliceByTimestamp(fit?.laps),
    records: sliceByTimestamp(fit?.records),
    events: sliceByTimestamp(fit?.events),
    lengths: sliceByTimestamp(fit?.lengths),
    time_in_zone: tizForSession ? [tizForSession] : [],
    activity: fit?.activity,
    activity_metrics: fit?.activity_metrics
  };
}

function determineSegmentRole(sportRaw: unknown, transitionsSoFar: number): RaceSegmentRole {
  const sport = `${sportRaw ?? ""}`.toLowerCase();
  if (sport.includes("swim")) return "swim";
  if (sport.includes("cycl") || sport.includes("bike")) return "bike";
  if (sport.includes("run")) return "run";
  if (sport === "transition") return transitionsSoFar === 0 ? "t1" : "t2";
  // Fallback for unexpected sports inside a multisport file: treat as a transition slot.
  return transitionsSoFar === 0 ? "t1" : "t2";
}

function buildMultisportFromFit(fit: any, sessions: any[]): ParsedMultisportActivity {
  const segments: ParsedMultisportSegment[] = [];
  let transitionsSeen = 0;

  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    if (!session?.start_time) {
      throw new Error(`FIT multisport session ${i} missing start time.`);
    }
    const slicedFit = sliceFitForSession(fit, session, i);
    const parsed = buildParsedActivityFromSession(session, slicedFit);
    const role = determineSegmentRole(session.sport, transitionsSeen);
    if (`${session.sport ?? ""}`.toLowerCase() === "transition") transitionsSeen += 1;
    segments.push({ ...parsed, role, segmentIndex: i });
  }

  segments.sort((a, b) => a.segmentIndex - b.segmentIndex);

  const startedAt = segments[0].startTimeUtc;
  const endedAt = segments[segments.length - 1].endTimeUtc;
  const totalDurationSec = segments.reduce((sum, s) => sum + (s.durationSec || 0), 0);
  const totalDistanceM = segments.reduce((sum, s) => sum + (s.distanceM || 0), 0);

  return {
    kind: "multisport",
    bundle: {
      startedAt,
      endedAt,
      totalDurationSec,
      totalDistanceM,
      source: "garmin_multisport"
    },
    segments
  };
}
