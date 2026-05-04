import {
  asArray,
  buildHalfSummaries,
  buildPaceSummary,
  buildPaceZoneSummaries,
  buildSwimQualityWarnings,
  classifySwimType,
  nonNegativeNumber,
  normalizeActivityType,
  positiveInt,
  roundNumber,
  tcxParser,
  type ParsedActivity
} from "./activity-parser-common";

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
  const swimType = classifySwimType({ normalizedSport, subSportRaw: null, typeRaw: sportRaw });
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
    swimType,
    metricsV2: {
      schemaVersion: 1,
      sourceFormat: "tcx",
      activity: {
        vendor: "garmin",
        rawType: sportRaw ?? null,
        rawSubType: null,
        normalizedType: normalizedSport,
        swimType
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
