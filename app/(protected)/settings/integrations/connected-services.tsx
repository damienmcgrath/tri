import { createClient } from "@/lib/supabase/server";
import { StravaConnectionCard } from "./strava-connection-card";

export type StravaConnectionRow = {
  provider_display_name: string | null;
  last_synced_at: string | null;
  last_sync_status: "ok" | "error" | "running" | null;
  last_sync_error: string | null;
  sync_window_days: number | null;
  last_sync_metadata: { importedCount?: number; skippedCount?: number; errorCount?: number } | null;
} | null;

/**
 * Server component that queries the user's external connections and renders
 * connection cards for each provider.
 */
export async function ConnectedServices() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Try with new columns first, fall back to base columns if migration hasn't been applied yet
  let connection: StravaConnectionRow = null;
  const baseSelect = "provider_display_name,last_synced_at,last_sync_status,last_sync_error";
  const extendedSelect = `${baseSelect},sync_window_days,last_sync_metadata`;

  const extended = await supabase
    .from("external_account_connections")
    .select(extendedSelect)
    .eq("user_id", user.id)
    .eq("provider", "strava")
    .is("disconnected_at", null)
    .maybeSingle();

  if (!extended.error) {
    connection = extended.data as StravaConnectionRow;
  } else {
    // Fallback: columns may not exist yet
    const base = await supabase
      .from("external_account_connections")
      .select(baseSelect)
      .eq("user_id", user.id)
      .eq("provider", "strava")
      .is("disconnected_at", null)
      .maybeSingle();
    if (base.data) {
      connection = { ...base.data, sync_window_days: null, last_sync_metadata: null } as StravaConnectionRow;
    }
  }

  return (
    <section className="surface p-6 space-y-4">
      <header>
        <h2 className="text-lg font-semibold">Connected services</h2>
        <p className="mt-1 text-sm text-muted">
          Connect third-party accounts to import your completed workouts automatically.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StravaConnectionCard connection={connection as StravaConnectionRow} />
      </div>
    </section>
  );
}
