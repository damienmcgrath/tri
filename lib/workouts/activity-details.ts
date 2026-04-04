import { createClient } from "@/lib/supabase/server";
import { scoreCandidate } from "@/lib/workouts/activity-matching";

export type ActivityDetails = {
  id: string;
  user_id: string;
  upload_id: string | null;
  sport_type: string;
  start_time_utc: string;
  end_time_utc: string | null;
  duration_sec: number;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  calories: number | null;
  moving_duration_sec: number | null;
  elapsed_duration_sec: number | null;
  pool_length_m: number | null;
  laps_count: number | null;
  avg_pace_per_100m_sec: number | null;
  avg_stroke_rate_spm: number | null;
  avg_swolf: number | null;
  avg_cadence: number | null;
  max_hr: number | null;
  max_power: number | null;
  elevation_gain_m: number | null;
  elevation_loss_m: number | null;
  activity_vendor: string | null;
  activity_type_raw: string | null;
  activity_subtype_raw: string | null;
  source: string;
  external_provider: string | null;
  external_activity_id: string | null;
  external_title: string | null;
  parse_summary: { laps?: Array<Record<string, unknown>> } | null;
  metrics_v2: Record<string, unknown> | null;
  notes: string | null;
  is_unplanned: boolean;
  is_race: boolean;
};

export type SessionCandidate = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  distance_m?: number | null;
  start_time_utc?: string | null;
  confidence: number;
  isRecommended: boolean;
};

type ActivityDetailsPayload = {
  activity: ActivityDetails;
  linkedSession: SessionCandidate | null;
  candidates: SessionCandidate[];
};

function toIsoDay(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function toCandidateStartTime(session: { date: string; start_time_utc?: string | null }) {
  return session.start_time_utc ?? `${session.date}T06:00:00.000Z`;
}

function isMissingActivityDetailsColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703" || /(notes|is_unplanned|is_race|schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

export async function loadActivityDetails(activityId: string): Promise<ActivityDetailsPayload | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const selectVariants = [
    "id,user_id,upload_id,sport_type,start_time_utc,end_time_utc,duration_sec,distance_m,avg_hr,avg_power,calories,moving_duration_sec,elapsed_duration_sec,pool_length_m,laps_count,avg_pace_per_100m_sec,avg_stroke_rate_spm,avg_swolf,avg_cadence,max_hr,max_power,elevation_gain_m,elevation_loss_m,activity_vendor,activity_type_raw,activity_subtype_raw,source,external_provider,external_activity_id,external_title,parse_summary,metrics_v2,notes,is_unplanned,is_race",
    "id,user_id,upload_id,sport_type,start_time_utc,end_time_utc,duration_sec,distance_m,avg_hr,avg_power,calories,moving_duration_sec,elapsed_duration_sec,pool_length_m,laps_count,avg_pace_per_100m_sec,avg_stroke_rate_spm,avg_swolf,avg_cadence,max_hr,max_power,elevation_gain_m,elevation_loss_m,activity_vendor,activity_type_raw,activity_subtype_raw,source,external_provider,external_activity_id,external_title,parse_summary,metrics_v2,is_unplanned,is_race",
    "id,user_id,upload_id,sport_type,start_time_utc,end_time_utc,duration_sec,distance_m,avg_hr,avg_power,calories,moving_duration_sec,elapsed_duration_sec,pool_length_m,laps_count,avg_pace_per_100m_sec,avg_stroke_rate_spm,avg_swolf,avg_cadence,max_hr,max_power,elevation_gain_m,elevation_loss_m,activity_vendor,activity_type_raw,activity_subtype_raw,source,external_provider,external_activity_id,external_title,parse_summary,metrics_v2,is_race",
    "id,user_id,upload_id,sport_type,start_time_utc,end_time_utc,duration_sec,distance_m,avg_hr,avg_power,calories,moving_duration_sec,elapsed_duration_sec,pool_length_m,laps_count,avg_pace_per_100m_sec,avg_stroke_rate_spm,avg_swolf,avg_cadence,max_hr,max_power,elevation_gain_m,elevation_loss_m,activity_vendor,activity_type_raw,activity_subtype_raw,source,external_provider,external_activity_id,external_title,parse_summary,metrics_v2"
  ] as const;

  let activity: ActivityDetails | null = null;

  for (const selectClause of selectVariants) {
    const query = await supabase
      .from("completed_activities")
      .select(selectClause)
      .eq("id", activityId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!query.error) {
      if (!query.data) return null;

      const record = query.data as unknown as Record<string, unknown>;
      activity = {
        ...(record as unknown as ActivityDetails),
        external_provider: typeof record.external_provider === "string" ? record.external_provider : null,
        external_activity_id: typeof record.external_activity_id === "string" ? record.external_activity_id : null,
        external_title: typeof record.external_title === "string" ? record.external_title : null,
        notes: typeof record.notes === "string" ? record.notes : null,
        is_unplanned: typeof record.is_unplanned === "boolean" ? record.is_unplanned : false,
        is_race: typeof record.is_race === "boolean" ? record.is_race : false
      };
      break;
    }

    if (!isMissingActivityDetailsColumnError(query.error)) {
      return null;
    }
  }

  if (!activity) return null;

  const { data: existingLinks } = await supabase
    .from("session_activity_links")
    .select("planned_session_id,confidence,confirmation_status")
    .eq("user_id", user.id)
    .eq("completed_activity_id", activity.id)
    .limit(1);

  const link = existingLinks?.find((item: any) => item.confirmation_status === "confirmed") ?? null;
  const activityStart = new Date(activity.start_time_utc);
  const windowStart = new Date(activityStart.getTime() - 6 * 3600 * 1000).toISOString();
  const windowEnd = new Date(activityStart.getTime() + 6 * 3600 * 1000).toISOString();
  const dayIso = toIsoDay(activity.start_time_utc);

  const { data: rawSessions } = await supabase
    .from("sessions")
    .select("id,date,sport,type,duration_minutes,distance_m,start_time_utc")
    .eq("user_id", user.id)
    .or(`and(date.eq.${dayIso}),and(start_time_utc.gte.${windowStart},start_time_utc.lte.${windowEnd})`)
    .order("date", { ascending: true })
    .limit(12);

  const scored = ((rawSessions ?? []) as Array<any>).map((session) => {
    const scoredCandidate = scoreCandidate(
      {
        sportType: activity.sport_type,
        startTimeUtc: activity.start_time_utc,
        durationSec: activity.duration_sec,
        distanceM: Number(activity.distance_m ?? 0)
      },
      {
        id: session.id,
        sport: session.sport,
        startTimeUtc: toCandidateStartTime(session),
        targetDurationSec: session.duration_minutes ? session.duration_minutes * 60 : null,
        targetDistanceM: Number(session.distance_m ?? 0) || null
      }
    );

    return {
      id: session.id,
      date: session.date,
      sport: session.sport,
      type: session.type,
      duration_minutes: session.duration_minutes,
      distance_m: session.distance_m,
      start_time_utc: session.start_time_utc,
      confidence: scoredCandidate.confidence,
      isRecommended: scoredCandidate.confidence >= 0.75
    } satisfies SessionCandidate;
  });

  const candidates = scored.sort((a, b) => b.confidence - a.confidence);
  const linkedSession = link ? candidates.find((candidate) => candidate.id === link.planned_session_id) ?? null : null;

  return {
    activity: activity as ActivityDetails,
    linkedSession,
    candidates
  };
}
