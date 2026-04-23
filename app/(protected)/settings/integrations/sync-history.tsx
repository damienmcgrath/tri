import { createClient } from "@/lib/supabase/server";

type SyncLogRow = {
  id: string;
  event_type: string;
  external_activity_id: string | null;
  status: "ok" | "skipped" | "error";
  error_message: string | null;
  created_at: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function eventLabel(eventType: string): string {
  switch (eventType) {
    case "activity_imported": return "Imported";
    case "activity_skipped": return "Skipped";
    case "activity_merged": return "Merged";
    case "activity_filtered": return "Filtered (non-triathlon)";
    case "activity_fetched": return "Fetched";
    case "activity_fetch_error": return "Fetch error";
    case "activity_insert_error": return "Insert error";
    default: return eventType.replace(/_/g, " ");
  }
}

function statusDot(status: string): string {
  if (status === "ok") return "bg-success";
  if (status === "error") return "bg-danger";
  return "bg-muted";
}

export async function SyncHistory() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: logs } = await supabase
    .from("external_sync_log")
    .select("id,event_type,external_activity_id,status,error_message,created_at")
    .eq("user_id", user.id)
    .eq("provider", "strava")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!logs || logs.length === 0) return null;

  return (
    <section className="surface p-5 space-y-3">
      <h3 className="text-body font-medium">Sync history</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-ui-label">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="pb-2 pr-3 font-medium">Time</th>
              <th className="pb-2 pr-3 font-medium">Event</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {(logs as SyncLogRow[]).map((log) => (
              <tr key={log.id} className="border-b border-border/50">
                <td className="py-1.5 pr-3 font-mono text-muted whitespace-nowrap">
                  {formatTime(log.created_at)}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {eventLabel(log.event_type)}
                </td>
                <td className="py-1.5 pr-3">
                  <span className="inline-flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot(log.status)}`} />
                    {log.status}
                  </span>
                </td>
                <td className="py-1.5 text-muted truncate max-w-[200px]">
                  {log.error_message ?? log.external_activity_id ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
