import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TcxUploadForm } from "../../dashboard/tcx-upload-form";

type IngestionEvent = {
  id: string;
  file_name: string | null;
  status: "success" | "partial" | "failed";
  created_at: string;
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data } = await supabase
    .from("ingestion_events")
    .select("id,file_name,status,created_at")
    .eq("user_id", user.id)
    .eq("source", "tcx_import")
    .order("created_at", { ascending: false })
    .limit(8);

  const events = (data ?? []) as IngestionEvent[];

  return (
    <section className="space-y-4">
      <header className="surface p-6">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">Settings → Integrations</p>
        <h1 className="mt-2 text-2xl font-semibold">Garmin</h1>
        <p className="mt-1 text-sm text-muted">Manually upload Garmin TCX exports and review recent imports.</p>
      </header>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Manual TCX upload</h2>
        <p className="mt-1 text-sm text-muted">Upload a Garmin-exported .tcx file. Existing importer logic is unchanged.</p>
        <div className="mt-4 md:max-w-lg">
          <TcxUploadForm />
        </div>
      </article>

      <article className="surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent imports</h2>
          <Link href="/calendar" className="text-xs text-cyan-300 underline-offset-2 hover:underline">
            Open Calendar
          </Link>
        </div>

        {events.length === 0 ? (
          <p className="surface-subtle p-3 text-sm text-muted">No imports yet.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((event) => (
              <li key={event.id} className="surface-subtle flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <p className="font-medium text-[hsl(var(--fg))]">{event.file_name ?? "Unnamed file"}</p>
                  <p className="text-xs text-muted">{dateTimeFormatter.format(new Date(event.created_at))}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      event.status === "success"
                        ? "border border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                        : event.status === "partial"
                          ? "border border-amber-400/40 bg-amber-500/15 text-amber-200"
                          : "border border-rose-400/40 bg-rose-500/15 text-rose-200"
                    }`}
                  >
                    {event.status}
                  </span>
                  <Link href="/calendar" className="text-xs text-cyan-300 underline-offset-2 hover:underline">
                    View sessions
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
