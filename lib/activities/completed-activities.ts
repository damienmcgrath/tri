import { cache } from "react";
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
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  schedule_status: "scheduled" | "unscheduled";
  is_unplanned: boolean;
  metrics_v2?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export type ExtraCompletedActivity = {
  id: string;
  sport: string;
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
  return error.code === "42703" || /(schedule_status|is_unplanned|schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
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
  activities: Array<Pick<CompletedActivityRecord, "id" | "sport_type" | "start_time_utc" | "duration_sec" | "avg_hr" | "avg_power" | "is_unplanned" | "metrics_v2">>;
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

let cachedSelectVariantIndex = 0;

function mapActivityRow(activity: Record<string, unknown>): CompletedActivityRecord {
  return {
    id: String(activity.id),
    upload_id: typeof activity.upload_id === "string" ? activity.upload_id : null,
    sport_type: String(activity.sport_type),
    start_time_utc: String(activity.start_time_utc),
    duration_sec: typeof activity.duration_sec === "number" ? activity.duration_sec : null,
    distance_m: typeof activity.distance_m === "number" ? activity.distance_m : null,
    avg_hr: typeof activity.avg_hr === "number" ? activity.avg_hr : null,
    avg_power: typeof activity.avg_power === "number" ? activity.avg_power : null,
    schedule_status: activity.schedule_status === "scheduled" ? "scheduled" : "unscheduled",
    is_unplanned: typeof activity.is_unplanned === "boolean" ? activity.is_unplanned : false,
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

  // Try the cached successful variant first to avoid retrying all 16 on every call
  const cachedQuery = await supabase
    .from("completed_activities")
    .select(selectVariants[cachedSelectVariantIndex])
    .eq("user_id", userId)
    .gte("start_time_utc", rangeStart)
    .lt("start_time_utc", rangeEnd);

  if (!cachedQuery.error) {
    return ((cachedQuery.data ?? []) as unknown as Array<Record<string, unknown>>).map(mapActivityRow);
  }

  if (!isMissingCompletedActivityColumnError(cachedQuery.error)) {
    throw new Error(cachedQuery.error.message ?? "Failed to load completed activities.");
  }

  // Cached variant failed due to schema change — find new working variant
  let lastError: { code?: string; message?: string } | null = cachedQuery.error;

  for (let i = 0; i < selectVariants.length; i++) {
    if (i === cachedSelectVariantIndex) continue;

    const query = await supabase
      .from("completed_activities")
      .select(selectVariants[i])
      .eq("user_id", userId)
      .gte("start_time_utc", rangeStart)
      .lt("start_time_utc", rangeEnd);

    if (!query.error) {
      cachedSelectVariantIndex = i;
      return ((query.data ?? []) as unknown as Array<Record<string, unknown>>).map(mapActivityRow);
    }

    lastError = query.error;
    if (!isMissingCompletedActivityColumnError(query.error)) {
      break;
    }
  }

  throw new Error(lastError?.message ?? "Failed to load completed activities.");
});
