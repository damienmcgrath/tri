import type { SupabaseClient } from "@supabase/supabase-js";
import { getNestedNumber } from "@/lib/workouts/metrics-v2";

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
  activities: Array<Pick<CompletedActivityRecord, "id" | "sport_type" | "start_time_utc" | "duration_sec" | "avg_hr" | "avg_power" | "metrics_v2">>;
  links: Array<Pick<SessionActivityLinkRecord, "completed_activity_id" | "planned_session_id" | "confirmation_status">>;
  timeZone: string;
  weekStart: string;
  weekEndExclusive: string;
}) {
  const { activities, links, timeZone, weekStart, weekEndExclusive } = params;
  const confirmedLinkedActivityIds = new Set(
    links
      .filter(hasConfirmedPlannedSessionLink)
      .map((link) => link.completed_activity_id)
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
      totalWorkKj: getNestedNumber(activity.metrics_v2, [["power", "totalWorkKj"], ["power", "total_work_kj"]])
    }))
    .filter((activity) => activity.date >= weekStart && activity.date < weekEndExclusive)
    .filter((activity) => !confirmedLinkedActivityIds.has(activity.id));
}

export async function loadCompletedActivities(params: {
  supabase: SupabaseClient;
  userId: string;
  rangeStart: string;
  rangeEnd: string;
}): Promise<CompletedActivityRecord[]> {
  const { supabase, userId, rangeStart, rangeEnd } = params;
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

  let lastError: { code?: string; message?: string } | null = null;

  for (const selectClause of selectVariants) {
    const query = await supabase
      .from("completed_activities")
      .select(selectClause)
      .eq("user_id", userId)
      .gte("start_time_utc", rangeStart)
      .lt("start_time_utc", rangeEnd);

    if (!query.error) {
      return ((query.data ?? []) as unknown as Array<Record<string, unknown>>).map((activity) => ({
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
      }));
    }

    lastError = query.error;
    if (!isMissingCompletedActivityColumnError(query.error)) {
      break;
    }
  }

  throw new Error(lastError?.message ?? "Failed to load completed activities.");
}
