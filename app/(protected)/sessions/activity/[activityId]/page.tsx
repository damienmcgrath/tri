import { notFound, redirect } from "next/navigation";
import { SessionReviewSurface } from "@/components/training/session-review-surface";
import { createClient } from "@/lib/supabase/server";
import { createReviewViewModel, durationLabel, type SessionReviewRow } from "@/lib/session-review";
import { getSessionDisplayName } from "@/lib/training/session";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { buildExecutionResultForSession } from "@/lib/workouts/session-execution";

type ActivityReviewRow = {
  id: string;
  user_id?: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec?: number | null;
  laps_count?: number | null;
  parse_summary?: Record<string, unknown> | null;
  metrics_v2?: Record<string, unknown> | null;
};

function isMissingActivityColumnError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "42703") return true;
  return /(schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

async function loadActivityReviewRow(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  activityId: string;
}) {
  const { supabase, userId, activityId } = params;

  const queries = [
    () =>
      supabase
        .from("completed_activities")
        .select("id,user_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
        .eq("id", activityId)
        .eq("user_id", userId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,user_id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power")
        .eq("id", activityId)
        .eq("user_id", userId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,laps_count,parse_summary,metrics_v2")
        .eq("id", activityId)
        .maybeSingle(),
    () =>
      supabase
        .from("completed_activities")
        .select("id,sport_type,start_time_utc,duration_sec,distance_m,avg_hr,avg_power")
        .eq("id", activityId)
        .maybeSingle()
  ];

  for (const runQuery of queries) {
    const { data, error } = await runQuery();
    if (data && !error) {
      return data as ActivityReviewRow;
    }
    if (error && !isMissingActivityColumnError(error)) {
      break;
    }
  }

  return null;
}

const reviewDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function ActivitySessionReviewPage({ params }: { params: { activityId: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const activity = await loadActivityReviewRow({ supabase, userId: user.id, activityId: params.activityId });
  if (!activity) notFound();

  const session: SessionReviewRow = {
    id: `activity:${activity.id}`,
    user_id: user.id,
    date: new Date(activity.start_time_utc).toISOString().slice(0, 10),
    sport: activity.sport_type,
    type: "Extra workout",
    session_name: "Extra workout",
    discipline: activity.sport_type,
    target: null,
    duration_minutes: activity.duration_sec ? Math.round(activity.duration_sec / 60) : null,
    status: "completed",
    is_extra: true,
    execution_result: buildExecutionResultForSession(
      {
        id: `activity:${activity.id}`,
        user_id: user.id,
        sport: activity.sport_type,
        type: "Extra workout",
        duration_minutes: activity.duration_sec ? Math.round(activity.duration_sec / 60) : null,
        target: null,
        intent_category: "extra workout",
        status: "completed"
      },
      {
        id: activity.id,
        sport_type: activity.sport_type,
        duration_sec: activity.duration_sec,
        distance_m: activity.distance_m,
        avg_hr: activity.avg_hr,
        avg_power: activity.avg_power,
        avg_pace_per_100m_sec: activity.avg_pace_per_100m_sec ?? null,
        laps_count: activity.laps_count ?? null,
        parse_summary: activity.parse_summary ?? null,
        metrics_v2: activity.metrics_v2 ?? null
      }
    ),
    has_linked_activity: true
  };

  const reviewVm = createReviewViewModel(session);
  const sessionTitle = getSessionDisplayName({
    sessionName: session.session_name ?? session.type,
    discipline: session.discipline ?? session.sport,
    subtype: session.subtype,
    workoutType: session.workout_type,
    intentCategory: session.intent_category
  });
  const disciplineLabel = getDisciplineMeta(session.sport).label;
  const sessionDateLabel = reviewDateFormatter.format(new Date(`${session.date}T00:00:00.000Z`));
  return (
    <SessionReviewSurface
      sessionTitle={sessionTitle}
      disciplineLabel={disciplineLabel}
      sessionDateLabel={sessionDateLabel}
      durationLabel={durationLabel(session.duration_minutes)}
      reviewVm={reviewVm}
    />
  );
}
