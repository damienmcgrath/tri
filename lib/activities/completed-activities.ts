import { cache } from "@/lib/shared/react-cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getNestedNumber } from "@/lib/workouts/metrics-v2";
import { classifyActivityStatus } from "@/lib/activities/activity-status";

export type SessionActivityLinkRecord = {
  planned_session_id?: string | null;
  completed_activity_id: string;
  confirmation_status?: "suggested" | "confirmed" | "rejected" | null;
};

export type CompletedActivityRecord = {
  id: string;
  upload_id: string | null;
  sport_type: string;
  swim_type?: "pool" | "open_water" | null;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  schedule_status: "scheduled" | "unscheduled";
  is_unplanned: boolean;
  race_bundle_id: string | null;
  race_segment_role: "swim" | "t1" | "bike" | "t2" | "run" | null;
  race_segment_index: number | null;
  metrics_v2?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export type ExtraCompletedActivity = {
  id: string;
  sport: string;
  swimType: "pool" | "open_water" | null;
  date: string;
  durationMinutes: number;
  avgHr: number | null;
  avgPower: number | null;
  normalizedPower: number | null;
  trainingStressScore: number | null;
  intensityFactor: number | null;
  totalWorkKj: number | null;
  avgCadence: number | null;
  elevationGainM: number | null;
  hrDriftPct: number | null;
  paceFadePct: number | null;
  avgPacePer100mSec: number | null;
  avgStrokeRateSpm: number | null;
  avgSwolf: number | null;
};

export function localIsoDate(utcIso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(utcIso));
}

export function isMissingCompletedActivityColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703" || /(swim_type|schedule_status|is_unplanned|race_bundle_id|race_segment_role|race_segment_index|schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

export function hasConfirmedPlannedSessionLink(link: {
  planned_session_id?: string | null;
  confirmation_status?: "suggested" | "confirmed" | "rejected" | null;
}) {
  return Boolean(link.planned_session_id) && (
    link.confirmation_status === "confirmed" ||
    link.confirmation_status === null ||
    typeof link.confirmation_status === "undefined"
  );
}

export function buildExtraCompletedActivities(params: {
  activities: Array<Pick<CompletedActivityRecord, "id" | "sport_type" | "swim_type" | "start_time_utc" | "duration_sec" | "avg_hr" | "avg_power" | "is_unplanned" | "metrics_v2">>;
  links: Array<Pick<SessionActivityLinkRecord, "completed_activity_id" | "planned_session_id" | "confirmation_status">>;
  timeZone: string;
  weekStart: string;
  weekEndExclusive: string;
}) {
  const { activities, links, timeZone, weekStart, weekEndExclusive } = params;

  const extraActivityIds = new Set(
    activities
      .filter((activity) => classifyActivityStatus({
        activityId: activity.id,
        isUnplanned: Boolean(activity.is_unplanned),
        links
      }) === "extra")
      .map((activity) => activity.id)
  );

  return activities
    .map((activity) => ({
      id: activity.id,
      sport: activity.sport_type,
      swimType: activity.swim_type ?? null,
      date: localIsoDate(activity.start_time_utc, timeZone),
      durationMinutes: Math.round((activity.duration_sec ?? 0) / 60),
      avgHr: activity.avg_hr ?? null,
      avgPower: activity.avg_power ?? null,
      normalizedPower: getNestedNumber(activity.metrics_v2, [["power", "normalizedPower"], ["power", "normalized_power"]]),
      trainingStressScore: getNestedNumber(activity.metrics_v2, [["load", "trainingStressScore"], ["load", "training_stress_score"]]),
      intensityFactor: getNestedNumber(activity.metrics_v2, [["power", "intensityFactor"], ["power", "intensity_factor"]]),
      totalWorkKj: getNestedNumber(activity.metrics_v2, [["power", "totalWorkKj"], ["power", "total_work_kj"]]),
      avgCadence: getNestedNumber(activity.metrics_v2, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]]),
      elevationGainM: getNestedNumber(activity.metrics_v2, [["elevation", "gainM"], ["elevation", "gain_m"]]),
      hrDriftPct: getNestedNumber(activity.metrics_v2, [["splits", "hrDriftPct"], ["halves", "hrDriftPct"], ["splits", "hr_drift_pct"]]),
      paceFadePct: getNestedNumber(activity.metrics_v2, [["splits", "paceFadePct"], ["halves", "paceFadePct"], ["splits", "pace_fade_pct"]]),
      avgPacePer100mSec: getNestedNumber(activity.metrics_v2, [["pace", "avgPacePer100mSec"], ["pace", "avg_pace_per_100m_sec"]]),
      avgStrokeRateSpm: getNestedNumber(activity.metrics_v2, [["stroke", "avgStrokeRateSpm"], ["stroke", "avg_stroke_rate_spm"]]),
      avgSwolf: getNestedNumber(activity.metrics_v2, [["stroke", "avgSwolf"], ["stroke", "avg_swolf"]])
    }))
    .filter((activity) => activity.date >= weekStart && activity.date < weekEndExclusive)
    .filter((activity) => extraActivityIds.has(activity.id));
}

const selectVariants = [
  // Swim-type-aware variants. Tried first; on missing-column error we fall through.
  "id,upload_id,sport_type,swim_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,race_bundle_id,race_segment_role,race_segment_index,metrics_v2,created_at,updated_at",
  "id,upload_id,sport_type,swim_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,race_bundle_id,race_segment_role,race_segment_index,metrics_v2,created_at",
  // Race-column-aware variants (most complete first). Each pair tries with then without updated_at.
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,race_bundle_id,race_segment_role,race_segment_index,metrics_v2,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,race_bundle_id,race_segment_role,race_segment_index,metrics_v2,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,is_unplanned,race_bundle_id,race_segment_role,race_segment_index,metrics_v2,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,race_bundle_id,race_segment_role,race_segment_index,metrics_v2,created_at",
  // Pre-race-columns fallbacks (kept for envs where the migration hasn't landed).
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,metrics_v2,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,metrics_v2,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,is_unplanned,metrics_v2,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,metrics_v2,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,is_unplanned,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,created_at,updated_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,metrics_v2,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,is_unplanned,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,metrics_v2,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,is_unplanned,metrics_v2,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,metrics_v2,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,schedule_status,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,is_unplanned,created_at",
  "id,upload_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,created_at"
] as const;

function mapActivityRow(activity: Record<string, unknown>): CompletedActivityRecord {
  return {
    id: String(activity.id),
    upload_id: typeof activity.upload_id === "string" ? activity.upload_id : null,
    sport_type: String(activity.sport_type),
    swim_type: activity.swim_type === "pool" || activity.swim_type === "open_water" ? activity.swim_type : null,
    start_time_utc: String(activity.start_time_utc),
    duration_sec: typeof activity.duration_sec === "number" ? activity.duration_sec : null,
    distance_m: typeof activity.distance_m === "number" ? activity.distance_m : null,
    avg_hr: typeof activity.avg_hr === "number" ? activity.avg_hr : null,
    avg_power: typeof activity.avg_power === "number" ? activity.avg_power : null,
    schedule_status: activity.schedule_status === "scheduled" ? "scheduled" : "unscheduled",
    is_unplanned: typeof activity.is_unplanned === "boolean" ? activity.is_unplanned : false,
    race_bundle_id: typeof activity.race_bundle_id === "string" ? activity.race_bundle_id : null,
    race_segment_role:
      activity.race_segment_role === "swim" ||
      activity.race_segment_role === "t1" ||
      activity.race_segment_role === "bike" ||
      activity.race_segment_role === "t2" ||
      activity.race_segment_role === "run"
        ? activity.race_segment_role
        : null,
    race_segment_index:
      typeof activity.race_segment_index === "number" ? activity.race_segment_index : null,
    metrics_v2:
      activity.metrics_v2 && typeof activity.metrics_v2 === "object" && !Array.isArray(activity.metrics_v2)
        ? activity.metrics_v2 as Record<string, unknown>
        : null,
    created_at: typeof activity.created_at === "string" ? activity.created_at : undefined,
    updated_at: typeof activity.updated_at === "string" ? activity.updated_at : undefined
  };
}

export const loadCompletedActivities = cache(async function loadCompletedActivities(params: {
  supabase: SupabaseClient;
  userId: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<CompletedActivityRecord[]> {
  const { supabase, userId, rangeStart, rangeEnd } = params;

  // Always start at the most-complete variant (index 0). The module-level cache
  // we used to keep here got poisoned when columns were added: it would pin a
  // fallback variant that lacked the new column, then keep returning rows
  // without that column even after the migration ran. The cost of always
  // starting at 0 is at most one extra query per request when a column is
  // genuinely missing, which is negligible.
  let lastError: { code?: string; message?: string } | null = null;

  for (let i = 0; i < selectVariants.length; i++) {
    const query = await supabase
      .from("completed_activities")
      .select(selectVariants[i])
      .eq("user_id", userId)
      .gte("start_time_utc", rangeStart)
      .lt("start_time_utc", rangeEnd);

    if (!query.error) {
      return ((query.data ?? []) as unknown as Array<Record<string, unknown>>).map(mapActivityRow);
    }

    lastError = query.error;
    if (!isMissingCompletedActivityColumnError(query.error)) {
      break;
    }
  }

  throw new Error(lastError?.message ?? "Failed to load completed activities.");
});
