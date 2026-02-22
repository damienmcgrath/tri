import { createClient } from "@/lib/supabase/server";
import { ActivityUploadsPanel } from "./activity-uploads-panel";

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: uploads } = await supabase
    .from("activity_uploads")
    .select("id,filename,file_type,file_size,status,error_message,created_at,completed_activities(id,sport_type,duration_sec,distance_m),session_activity_links(planned_session_id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: plannedSessions } = await supabase
    .from("planned_sessions")
    .select("id,date,sport,type,duration")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(30);

  return (
    <section className="space-y-4">
      <header className="surface p-6">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">Settings → Integrations / Uploads</p>
        <h1 className="mt-2 text-2xl font-semibold">Garmin file uploads</h1>
        <p className="mt-1 text-sm text-muted">Upload .fit or .tcx activities, then review and attach them to planned sessions.</p>
      </header>

      <article className="surface p-5">
        <ActivityUploadsPanel initialUploads={(uploads as any[]) ?? []} plannedSessions={(plannedSessions as any[]) ?? []} />
      </article>
    </section>
  );
}
