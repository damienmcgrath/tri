import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizationUrl } from "@/lib/integrations/providers/strava/client";

/**
 * GET /api/integrations/strava/connect
 *
 * Starts the Strava OAuth flow. Generates a nonce stored in an httpOnly
 * cookie and redirects the user to Strava's authorization page.
 */
export async function GET(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Strava integration not configured." }, { status: 503 });
  }

  // Build redirect URI from request host (works for both localhost and production)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const redirectUri = `${protocol}://${host}/api/integrations/strava/callback`;

  // Generate a nonce to prevent CSRF
  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ userId: user.id, nonce })).toString("base64url");

  const stravaUrl = buildAuthorizationUrl(state, redirectUri);

  const response = NextResponse.redirect(stravaUrl);

  // Store nonce in httpOnly cookie for validation in callback
  // sameSite: 'lax' required — Strava's redirect is a cross-origin GET
  response.cookies.set("strava_oauth_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/"
  });

  return response;
}
