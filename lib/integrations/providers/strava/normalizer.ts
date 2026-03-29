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
  weighted_average_watts?: number;
  average_cadence?: number;
  calories?: number;
};

// Shape compatible with completed_activities INSERT
export type NormalizedStravaActivity = {
  user_id: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number;
  moving_duration_sec: number;
  distance_m: number;
  elevation_gain_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  max_power: number | null;
  avg_cadence: number | null;
  calories: number | null;
  external_provider: "strava";
  external_activity_id: string;
  external_title: string;
  source: "strava";
  activity_vendor: "strava";
  schedule_status: "unscheduled";
  is_unplanned: boolean;
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

export function normalizeStravaActivity(
  raw: StravaActivitySummary,
  userId: string
): NormalizedStravaActivity {
  // Prefer sport_type (new field), fall back to type (legacy)
  const rawSportType = raw.sport_type ?? raw.type ?? "Workout";

  const nullIfZero = (val: number | undefined): number | null => {
    if (val === undefined || val === null || val === 0) return null;
    return val;
  };

  return {
    user_id: userId,
    sport_type: mapStravaSportType(rawSportType),
    start_time_utc: raw.start_date,
    duration_sec: raw.elapsed_time,
    moving_duration_sec: raw.moving_time,
    distance_m: raw.distance ?? 0,
    elevation_gain_m: nullIfZero(raw.total_elevation_gain),
    avg_hr: nullIfZero(raw.average_heartrate ? Math.round(raw.average_heartrate) : undefined),
    max_hr: nullIfZero(raw.max_heartrate ? Math.round(raw.max_heartrate) : undefined),
    avg_power: nullIfZero(raw.average_watts ? Math.round(raw.average_watts) : undefined),
    max_power: nullIfZero(raw.max_watts ? Math.round(raw.max_watts) : undefined),
    avg_cadence: nullIfZero(raw.average_cadence ? Math.round(raw.average_cadence) : undefined),
    calories: nullIfZero(raw.calories),
    external_provider: "strava",
    external_activity_id: String(raw.id),
    external_title: raw.name ?? "",
    source: "strava",
    activity_vendor: "strava",
    schedule_status: "unscheduled",
    is_unplanned: false
  };
}
