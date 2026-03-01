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
  source: string;
  parse_summary: { laps?: Array<Record<string, unknown>> } | null;
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

export type ActivityDetailsPayload = {
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

export async function loadActivityDetails(activityId: string): Promise<ActivityDetailsPayload | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: activity } = await supabase
    .from("completed_activities")
    .select("id,user_id,upload_id,sport_type,start_time_utc,end_time_utc,duration_sec,distance_m,avg_hr,avg_power,calories,source,parse_summary,notes,is_unplanned,is_race")
    .eq("id", activityId)
    .eq("user_id", user.id)
    .maybeSingle();

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
