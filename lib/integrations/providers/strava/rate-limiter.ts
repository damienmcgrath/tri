/**
 * Strava rate limit tracker.
 *
 * Parses `X-RateLimit-Limit` and `X-RateLimit-Usage` headers returned by
 * every Strava API response. Format: "15min_limit,daily_limit" and
 * "15min_usage,daily_usage".
 *
 * Stateless across serverless invocations by design — each invocation starts
 * fresh and updates from response headers on every call.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type RateLimitInfo = {
  /** Requests allowed per 15-minute window */
  limit15min: number;
  /** Requests allowed per day */
  limitDaily: number;
  /** Requests used in current 15-minute window */
  usage15min: number;
  /** Requests used today */
  usageDaily: number;
};

export class StravaRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "StravaRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse Strava rate limit headers into a structured object.
 * Returns null if headers are missing or malformed.
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  const limitHeader = headers.get("x-ratelimit-limit");
  const usageHeader = headers.get("x-ratelimit-usage");

  if (!limitHeader || !usageHeader) return null;

  const [limit15min, limitDaily] = limitHeader.split(",").map(Number);
  const [usage15min, usageDaily] = usageHeader.split(",").map(Number);

  if ([limit15min, limitDaily, usage15min, usageDaily].some(isNaN)) {
    return null;
  }

  return { limit15min, limitDaily, usage15min, usageDaily };
}

// ─── Throttle check ───────────────────────────────────────────────────────────

/** Threshold (fraction) at which we start throttling. 80% of 15-min limit. */
const THROTTLE_THRESHOLD = 0.8;

/**
 * Returns true if we should stop making requests to avoid hitting Strava's
 * rate limit. Checks the 15-minute window (more likely to be hit during
 * backfill) at 80% usage.
 */
export function shouldThrottle(info: RateLimitInfo): boolean {
  return info.usage15min >= Math.floor(info.limit15min * THROTTLE_THRESHOLD);
}
