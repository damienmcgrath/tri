import { NextResponse } from "next/server";
import {
  getConnectionByProviderAthleteId,
  refreshIfExpired,
  softDisconnect
} from "@/lib/integrations/token-service";
import { ingestStravaActivity } from "@/lib/integrations/ingestion-service";

/**
 * GET /api/integrations/strava/webhook
 *
 * Strava subscription verification (hub challenge).
 * Strava sends this when you create a webhook subscription to verify ownership.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!expectedToken) {
    console.error("[STRAVA_WEBHOOK] STRAVA_WEBHOOK_VERIFY_TOKEN not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (mode !== "subscribe" || verifyToken !== expectedToken || !challenge) {
    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  }

  // Return the challenge to confirm the subscription
  return NextResponse.json({ "hub.challenge": challenge });
}

// ─── Webhook event types ─────────────────────────────────────────────────────

type StravaWebhookEvent = {
  /** "activity" | "athlete" */
  object_type: string;
  /** Strava resource ID (activity ID or athlete ID) */
  object_id: number;
  /** "create" | "update" | "delete" */
  aspect_type: string;
  /** Strava athlete ID of the event owner */
  owner_id: number;
  /** Subscription ID */
  subscription_id: number;
  /** Additional data for certain events */
  updates?: Record<string, string>;
  /** Event timestamp */
  event_time: number;
};

/**
 * POST /api/integrations/strava/webhook
 *
 * Receives Strava webhook events. Must return 200 quickly (Strava expects <2s).
 *
 * Handles:
 * - activity create/update → fetch + ingest the activity
 * - athlete deauthorize → soft-disconnect the connection
 */
export async function POST(request: Request): Promise<Response> {
  let event: StravaWebhookEvent;
  try {
    event = (await request.json()) as StravaWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { object_type, object_id, aspect_type, owner_id, updates } = event;
  console.log(`[STRAVA_WEBHOOK] ${object_type}:${aspect_type} object=${object_id} owner=${owner_id}`);

  // ─── Athlete deauthorization ─────────────────────────────────────────
  if (object_type === "athlete" && updates?.authorized === "false") {
    console.log(`[STRAVA_WEBHOOK] Deauthorization for athlete ${owner_id}`);
    await softDisconnect("strava", String(owner_id));
    return NextResponse.json({ ok: true });
  }

  // ─── Activity create/update ──────────────────────────────────────────
  if (object_type === "activity" && (aspect_type === "create" || aspect_type === "update")) {
    const connection = await getConnectionByProviderAthleteId("strava", String(owner_id));

    if (!connection) {
      console.log(`[STRAVA_WEBHOOK] No connection found for athlete ${owner_id}, ignoring`);
      return NextResponse.json({ ok: true });
    }

    try {
      const freshConnection = await refreshIfExpired(connection);
      const result = await ingestStravaActivity(connection.userId, object_id, freshConnection);
      console.log(`[STRAVA_WEBHOOK] Ingest result: ${result.status} for activity ${object_id}`);
    } catch (err) {
      // Log but don't fail — Strava expects 200
      console.error(`[STRAVA_WEBHOOK] Ingest error for activity ${object_id}:`, err);
    }

    return NextResponse.json({ ok: true });
  }

  // Ignore other event types (activity delete, etc.)
  return NextResponse.json({ ok: true });
}
