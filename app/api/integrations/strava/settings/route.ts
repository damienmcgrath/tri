import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/integrations/strava/settings
 *
 * Update Strava connection settings (e.g. sync_window_days).
 */
export async function PATCH(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { syncWindowDays?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { syncWindowDays } = body;
  if (typeof syncWindowDays !== "number" || syncWindowDays < 1 || syncWindowDays > 90) {
    return NextResponse.json({ error: "syncWindowDays must be between 1 and 90" }, { status: 400 });
  }

  const { error } = await supabase
    .from("external_account_connections")
    .update({ sync_window_days: syncWindowDays })
    .eq("user_id", user.id)
    .eq("provider", "strava");

  if (error) {
    console.error("[STRAVA_SETTINGS] Update error:", error.message);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }

  return NextResponse.json({ syncWindowDays });
}
