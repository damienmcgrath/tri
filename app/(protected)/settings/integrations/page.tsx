import { createClient } from "@/lib/supabase/server";
import { ActivityUploadsPanel } from "./activity-uploads-panel";

type UploadRow = {
  id: string;
  filename: string;
  file_type: "fit" | "tcx";
  created_at: string;
  status: "uploaded" | "parsed" | "matched" | "error";
  error_message: string | null;
  completed_activities: { id: string; sport_type: string; duration_sec: number; distance_m: number | null }[];
  session_activity_links: { planned_session_id: string }[];
};

type PlannedCandidate = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration: number;
};

function isMissingTableError(error: { code?: string; message?: string } | null, tableName: string) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes(`could not find the table '${tableName.toLowerCase()}' in the schema cache`);
}

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: uploadRows } = await supabase
    .from("activity_uploads")
    .select("id,filename,file_type,status,error_message,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const uploadIds = (uploadRows ?? []).map((item) => item.id);

  const [{ data: activities }, { data: links }, sessionsQuery] = await Promise.all([
    uploadIds.length
      ? supabase
          .from("completed_activities")
          .select("id,upload_id,sport_type,duration_sec,distance_m")
          .eq("user_id", user.id)
          .in("upload_id", uploadIds)
      : Promise.resolve({ data: [] as any[] }),
    uploadIds.length
      ? supabase
          .from("session_activity_links")
          .select("planned_session_id,completed_activity_id")
          .eq("user_id", user.id)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("sessions")
      .select("id,date,sport,type,duration_minutes")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(60)
  ]);

  let plannedSessions: PlannedCandidate[] = [];
  if (!sessionsQuery.error) {
    plannedSessions = ((sessionsQuery.data ?? []) as any[]).map((session) => ({
      id: session.id,
      date: session.date,
      sport: session.sport,
      type: session.type,
      duration: session.duration_minutes
    }));
  } else if (isMissingTableError(sessionsQuery.error, "public.sessions")) {
    const { data: legacyPlanned } = await supabase
      .from("planned_sessions")
      .select("id,date,sport,type,duration")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(60);

    plannedSessions = (legacyPlanned ?? []) as PlannedCandidate[];
  }

  const activityByUpload = new Map<string, UploadRow["completed_activities"]>();
  (activities ?? []).forEach((activity: any) => {
    const list = activityByUpload.get(activity.upload_id) ?? [];
    list.push(activity);
    activityByUpload.set(activity.upload_id, list);
  });

  const linksByActivityId = new Map<string, UploadRow["session_activity_links"]>();
  (links ?? []).forEach((link: any) => {
    const list = linksByActivityId.get(link.completed_activity_id) ?? [];
    list.push({ planned_session_id: link.planned_session_id });
    linksByActivityId.set(link.completed_activity_id, list);
  });

  const uploads: UploadRow[] = (uploadRows ?? []).map((upload: any) => {
    const relatedActivities = activityByUpload.get(upload.id) ?? [];
    const relatedLinks = relatedActivities.flatMap((activity) => linksByActivityId.get(activity.id) ?? []);

    return {
      ...upload,
      completed_activities: relatedActivities,
      session_activity_links: relatedLinks
    };
  });

  return (
    <section className="space-y-4">
      <header className="surface p-6">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">Settings → Integrations / Uploads</p>
        <h1 className="mt-2 text-2xl font-semibold">Garmin file uploads</h1>
        <p className="mt-1 text-sm text-muted">Upload .fit or .tcx activities, then review and attach them to planned sessions.</p>
      </header>

      <article className="surface p-5">
        <ActivityUploadsPanel initialUploads={uploads} plannedSessions={plannedSessions} />
      </article>
    </section>
  );
}
