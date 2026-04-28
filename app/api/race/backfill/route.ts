import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/security/request";
import { isRaceSession } from "@/lib/training/race-session";
import { attemptRaceBundle } from "@/lib/workouts/race-bundle";

/**
 * POST /api/race/backfill
 *
 * Idempotent backfill: scans the current user's race-flagged planned sessions in
 * the last 12 months and attempts to bundle same-day completed activities into
 * a race bundle. Designed to be triggered manually after the race feature ships.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date();
  const horizon = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);

  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name")
    .eq("user_id", user.id)
    .gte("date", horizon.toISOString().slice(0, 10))
    .lte("date", today.toISOString().slice(0, 10));

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 400 });
  }

  const raceDates: string[] = Array.from(
    new Set<string>(
      (sessions ?? [])
        .filter((s: any) => isRaceSession({ type: s.type, session_name: s.session_name }))
        .map((s: any) => String(s.date))
    )
  ).sort();

  const summary: Array<{ date: string; status: string; reason?: string; bundleId?: string }> = [];
  for (const date of raceDates) {
    try {
      const result = await attemptRaceBundle({
        supabase,
        userId: user.id,
        date,
        source: "strava_reconstructed"
      });
      if (result.status === "bundled") {
        summary.push({ date, status: "bundled", bundleId: result.bundleId });
      } else {
        summary.push({ date, status: "skipped", reason: result.reason });
      }
    } catch (err) {
      summary.push({
        date,
        status: "error",
        reason: err instanceof Error ? err.message : "unknown_error"
      });
    }
  }

  const bundled = summary.filter((s) => s.status === "bundled").length;
  return NextResponse.json({ scanned: raceDates.length, bundled, summary });
}
