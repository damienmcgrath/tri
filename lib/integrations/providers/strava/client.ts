/**
 * Strava API HTTP client.
 *
 * Pure HTTP — no Supabase, no application state.
 * All functions throw on non-2xx responses.
 */

import type { StravaActivitySummary } from "./normalizer";
import { parseRateLimitHeaders, StravaRateLimitError, type RateLimitInfo } from "./rate-limiter";

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

export type FetchWithRateLimit<T> = {
  data: T;
  rateLimit: RateLimitInfo | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extended fetch that returns both the parsed body and rate limit headers.
 * Throws StravaRateLimitError on 429 responses.
 */
async function stravaFetchWithHeaders<T>(
  url: string,
  options: RequestInit
): Promise<FetchWithRateLimit<T>> {
  const res = await fetch(url, options);
  const rateLimit = parseRateLimitHeaders(res.headers);

  if (res.status === 429) {
    // Default retry after 15 minutes if no header
    const retryAfterMs = 15 * 60 * 1000;
    throw new StravaRateLimitError(
      `Strava rate limit exceeded (429)`,
      retryAfterMs
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Strava API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as T;
  return { data, rateLimit };
}

/** Simple fetch wrapper (backward compat). */
async function stravaFetch<T>(url: string, options: RequestInit): Promise<T> {
  const { data } = await stravaFetchWithHeaders<T>(url, options);
  return data;
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
 * Fetch the authenticated athlete's activities (paginated) with rate-limit info.
 * GET /athlete/activities — used by backfill to check throttle status between pages.
 *
 * @param after  Unix timestamp — only return activities after this time
 * @param page   1-based page number (default 1)
 * @param perPage Activities per page (default 50, max 200)
 */
export async function fetchRecentActivitiesWithRateLimit(
  accessToken: string,
  options: { after: number; page?: number; perPage?: number }
): Promise<FetchWithRateLimit<StravaActivitySummary[]>> {
  const params = new URLSearchParams({
    after: String(options.after),
    page: String(options.page ?? 1),
    per_page: String(options.perPage ?? 50)
  });
  return stravaFetchWithHeaders<StravaActivitySummary[]>(
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
