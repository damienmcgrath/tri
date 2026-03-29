/**
 * Strava API HTTP client.
 *
 * Pure HTTP — no Supabase, no application state.
 * All functions throw on non-2xx responses.
 */

import type { StravaActivitySummary } from "./normalizer";

const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const STRAVA_OAUTH_TOKEN_URL = "https://www.strava.com/oauth/token";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StravaAthleteProfile = {
  id: number;
  firstname: string;
  lastname: string;
  /** Avatar URL */
  profile: string;
  city?: string;
  country?: string;
  username?: string;
};

export type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  /** Unix timestamp when the access token expires */
  expires_at: number;
  athlete?: StravaAthleteProfile;
  scope?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function stravaFetch<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Strava API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ─── Activity endpoints ───────────────────────────────────────────────────────

/**
 * Fetch a single activity by ID.
 * GET /activities/{id}
 */
export async function fetchActivity(
  accessToken: string,
  activityId: string | number
): Promise<StravaActivitySummary> {
  return stravaFetch<StravaActivitySummary>(`${STRAVA_API_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

/**
 * Fetch the authenticated athlete's activities (paginated).
 * GET /athlete/activities
 *
 * @param after  Unix timestamp — only return activities after this time
 * @param page   1-based page number (default 1)
 * @param perPage Activities per page (default 50, max 200)
 */
export async function fetchRecentActivities(
  accessToken: string,
  options: { after: number; page?: number; perPage?: number }
): Promise<StravaActivitySummary[]> {
  const params = new URLSearchParams({
    after: String(options.after),
    page: String(options.page ?? 1),
    per_page: String(options.perPage ?? 50)
  });
  return stravaFetch<StravaActivitySummary[]>(
    `${STRAVA_API_BASE}/athlete/activities?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

// ─── OAuth endpoints ──────────────────────────────────────────────────────────

/**
 * Refresh an expired access token.
 * POST https://www.strava.com/oauth/token
 */
export async function refreshToken(
  currentRefreshToken: string
): Promise<{ access_token: string; refresh_token: string; expires_at: number }> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET not configured");
  }

  const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Strava token refresh ${res.status}: ${body}`);
  }

  const data = (await res.json()) as StravaTokenResponse;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at
  };
}

/**
 * Exchange an authorization code for tokens.
 * POST https://www.strava.com/oauth/token
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<StravaTokenResponse> {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET not configured");
  }

  const res = await fetch(STRAVA_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Strava code exchange ${res.status}: ${body}`);
  }

  return res.json() as Promise<StravaTokenResponse>;
}

/**
 * Build the Strava OAuth authorization URL.
 */
export function buildAuthorizationUrl(state: string, redirectUri: string): string {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    throw new Error("STRAVA_CLIENT_ID not configured");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read_all",
    state
  });

  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}
