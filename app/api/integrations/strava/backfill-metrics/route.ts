import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConnection, refreshIfExpired } from "@/lib/integrations/token-service";
import { backfillStravaMetrics } from "@/lib/integrations/strava-metrics-backfill";

// Allow up to 5 minutes — backfill may need to process many activities
// with 1.5s delay between each to respect Strava rate limits.
export const maxDuration = 300;

/**
 * POST /api/integrations/strava/backfill-metrics
 *
 * Re-fetches existing Strava activities from the detailed endpoint and
 * enriches them with metrics_v2 (normalized power, laps, pace, HR drift, etc.).
 *
 * By default only processes activities missing metrics_v2. Pass an optional
 * JSON body to target specific activities or force re-processing — useful
 * when the normalizer output shape has changed and historical rows need
 * to be rewritten.
 *
 * Body (all optional):
 *   { "force": true,
 *     "externalActivityIds": ["12345", "67890"] }
 *
 * Respects Strava rate limits and stops early if throttled.
 */
export async function POST(request: NextRequest): Promise<Response> {
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

  // Body is optional; tolerate empty / non-JSON bodies.
  let body: { force?: unknown; externalActivityIds?: unknown } = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const force = body.force === true;
  const externalActivityIds = Array.isArray(body.externalActivityIds)
    ? body.externalActivityIds.map((v) => String(v)).filter((v) => v.length > 0)
    : undefined;

  console.log(`[STRAVA_BACKFILL] Starting metrics backfill for user ${user.id}`, {
    force,
    targetCount: externalActivityIds?.length ?? "all"
  });

  try {
    const freshConnection = await refreshIfExpired(connection);
    const result = await backfillStravaMetrics(user.id, freshConnection, {
      force,
      externalActivityIds
    });

    console.log(`[STRAVA_BACKFILL] Done for user ${user.id}:`, result);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Backfill failed";
    console.error(`[STRAVA_BACKFILL] Error for user ${user.id}:`, msg);
    return NextResponse.json({ error: "Backfill failed. Please try again." }, { status: 500 });
  }
}
