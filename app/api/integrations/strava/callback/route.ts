import { createHmac } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCodeForTokens } from "@/lib/integrations/providers/strava/client";
import { upsertConnection } from "@/lib/integrations/token-service";

/**
 * GET /api/integrations/strava/callback
 *
 * Handles the OAuth callback from Strava:
 * 1. Validates the state param and nonce cookie (CSRF protection)
 * 2. Exchanges the authorization code for tokens
 * 3. Stores the connection server-side
 * 4. Redirects to the integrations page
 *
 * Note: no initial backfill on connect — the user triggers sync via button.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  // User denied access on Strava
  if (errorParam === "access_denied") {
    return NextResponse.redirect(`${baseUrl}/settings/integrations?error=strava_denied`);
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(`${baseUrl}/settings/integrations?error=strava_invalid`);
  }

  // Validate CSRF nonce from cookie
  const cookieHeader = request.headers.get("cookie") ?? "";
  const nonceCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("strava_oauth_nonce="))
    ?.split("=")[1];

  // Parse and verify HMAC-signed state parameter
  let stateData: { userId: string; nonce: string } | null = null;
  try {
    const stateOuter = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8"));
    if (stateOuter.payload && stateOuter.signature) {
      // New HMAC-signed format
      const hmacSecret = process.env.STRAVA_CLIENT_SECRET ?? process.env.STRAVA_CLIENT_ID ?? "";
      const expectedSignature = createHmac("sha256", hmacSecret).update(stateOuter.payload).digest("hex");
      if (stateOuter.signature !== expectedSignature) {
        console.error("[STRAVA_CALLBACK] HMAC signature mismatch — possible state tampering");
        return NextResponse.redirect(`${baseUrl}/settings/integrations?error=strava_invalid`);
      }
      stateData = JSON.parse(stateOuter.payload);
    } else {
      // Legacy format (userId + nonce directly in state) — accept but log warning
      stateData = stateOuter;
      console.warn("[STRAVA_CALLBACK] Legacy unsigned state format detected");
    }
  } catch {
    console.error("[STRAVA_CALLBACK] Failed to parse state param");
  }

  if (!stateData || !nonceCookie || stateData.nonce !== nonceCookie) {
    console.error("[STRAVA_CALLBACK] Invalid or missing nonce");
    return NextResponse.redirect(`${baseUrl}/settings/integrations?error=strava_invalid`);
  }

  // Verify the authenticated user matches the state
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || user.id !== stateData.userId) {
    console.error("[STRAVA_CALLBACK] User mismatch");
    return NextResponse.redirect(`${baseUrl}/settings/integrations?error=strava_invalid`);
  }

  // Exchange code for tokens — redirect_uri must match the one used in the connect step
  const redirectUri = process.env.STRAVA_REDIRECT_URI ?? `${baseUrl}/api/integrations/strava/callback`;
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, redirectUri);
  } catch (err) {
    console.error("[STRAVA_CALLBACK] Token exchange failed:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${baseUrl}/settings/integrations?error=strava_exchange`);
  }

  if (!tokens.athlete) {
    console.error("[STRAVA_CALLBACK] No athlete profile in token response");
    return NextResponse.redirect(`${baseUrl}/settings/integrations?error=strava_exchange`);
  }

  // Store connection (service-role insert)
  try {
    await upsertConnection(user.id, {
      provider: "strava",
      providerAthleteId: String(tokens.athlete.id),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(tokens.expires_at * 1000),
      scope: tokens.scope ?? "",
      providerDisplayName: `${tokens.athlete.firstname} ${tokens.athlete.lastname}`.trim(),
      providerProfile: tokens.athlete as unknown as Record<string, unknown>
    });
    console.log(`[STRAVA_CALLBACK] Connection stored for user ${user.id}`);
  } catch (err) {
    console.error("[STRAVA_CALLBACK] Failed to store connection:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${baseUrl}/settings/integrations?error=strava_save`);
  }

  // Clear nonce cookie and redirect to integrations page
  const response = NextResponse.redirect(`${baseUrl}/settings/integrations?connected=strava`);
  response.cookies.set("strava_oauth_nonce", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/"
  });

  return response;
}
