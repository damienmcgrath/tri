import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// ── In-memory fallback (local dev / missing Redis env vars) ──────────────

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(bucket: string) {
  let store = stores.get(bucket);
  if (!store) {
    store = new Map<string, RateLimitEntry>();
    stores.set(bucket, store);
  }

  return store;
}

function cleanupExpired(store: Map<string, RateLimitEntry>, now: number) {
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) {
      store.delete(key);
    }
  }
}

function checkRateLimitMemory(
  bucket: string,
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const store = getStore(bucket);

  cleanupExpired(store, now);

  const existing = store.get(key);

  if (!existing) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(config.maxRequests - 1, 0), resetAt };
  }

  if (existing.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  store.set(key, existing);

  return {
    allowed: true,
    remaining: Math.max(config.maxRequests - existing.count, 0),
    resetAt: existing.resetAt
  };
}

// ── Redis-backed rate limiting (production / serverless) ─────────────────

const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!
    });
  }
  return redis;
}

const ratelimiters = new Map<string, Ratelimit>();

function getRatelimiter(bucket: string, config: RateLimitConfig): Ratelimit {
  const cacheKey = `${bucket}:${config.maxRequests}:${config.windowMs}`;
  let rl = ratelimiters.get(cacheKey);
  if (!rl) {
    rl = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.fixedWindow(config.maxRequests, `${config.windowMs} ms`),
      prefix: `rl:${bucket}`
    });
    ratelimiters.set(cacheKey, rl);
  }
  return rl;
}

async function checkRateLimitRedis(
  bucket: string,
  key: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const rl = getRatelimiter(bucket, config);
  const result = await rl.limit(key);
  return {
    allowed: result.success,
    remaining: result.remaining,
    resetAt: result.reset
  };
}

// ── Public API (unchanged surface) ───────────────────────────────────────

export function checkRateLimit(
  bucket: string,
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } | Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  if (hasRedis) {
    return checkRateLimitRedis(bucket, key, config);
  }
  return checkRateLimitMemory(bucket, key, config);
}

export function rateLimitHeaders(input: { remaining: number; resetAt: number }) {
  return {
    "X-RateLimit-Remaining": String(input.remaining),
    "X-RateLimit-Reset": String(Math.floor(input.resetAt / 1000))
  };
}

export function resetRateLimits() {
  stores.clear();
}
