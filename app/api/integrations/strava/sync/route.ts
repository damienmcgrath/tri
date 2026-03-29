import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConnection, updateSyncStatus, refreshIfExpired } from "@/lib/integrations/token-service";
import { backfillRecentActivities } from "@/lib/integrations/ingestion-service";

// Allow up to 60s for the sync operation (Vercel Pro)
export const maxDuration = 60;

/**
 * POST /api/integrations/strava/sync
 *
 * Triggers a manual sync of recent Strava activities for the authenticated user.
 * Fetches the last 7 days of activities and imports any that haven't been seen.
 * Returns a summary: { imported, skipped, matched }.
 */
export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connection = await getConnection(user.id, "strava");
  if (!connection) {
    return NextResponse.json({ error: "No Strava account connected." }, { status: 404 });
  }

  console.log(`[STRAVA_SYNC] Starting sync for user ${user.id}`);
  await updateSyncStatus(user.id, "strava", "running");

  try {
    const freshConnection = await refreshIfExpired(connection);
    const result = await backfillRecentActivities(user.id, freshConnection, connection.syncWindowDays);

    console.log(`[STRAVA_SYNC] Done for user ${user.id}:`, result);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    console.error(`[STRAVA_SYNC] Error for user ${user.id}:`, msg);
    await updateSyncStatus(user.id, "strava", "error", msg);
    return NextResponse.json({ error: "Sync failed. Please try again." }, { status: 500 });
  }
}
