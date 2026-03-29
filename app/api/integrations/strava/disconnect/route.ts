import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteConnection } from "@/lib/integrations/token-service";

/**
 * POST /api/integrations/strava/disconnect
 *
 * Removes the Strava connection for the authenticated user.
 * Previously imported activities (completed_activities rows) are preserved —
 * they belong to the user's training history.
 */
export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deleteConnection(user.id, "strava");
    console.log(`[STRAVA_DISCONNECT] Disconnected user ${user.id}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[STRAVA_DISCONNECT] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to disconnect." }, { status: 500 });
  }
}
