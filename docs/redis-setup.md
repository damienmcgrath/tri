# Upstash Redis Setup (Rate Limiting)

The app uses Upstash Redis for production-grade rate limiting in serverless environments. When the env vars are missing, it falls back to in-memory rate limiting (fine for local dev, ineffective in production since each serverless invocation gets a fresh store).

## Setup via Vercel Integration (Recommended)

1. Go to your Vercel project dashboard
2. Navigate to **Storage** tab
3. Click **Create Database** > **Upstash Redis**
4. Follow the prompts — Vercel auto-provisions the database and injects the env vars

## Setup via Upstash Console

1. Go to [console.upstash.com](https://console.upstash.com) and create a new Redis database
2. Select the region closest to your Vercel deployment (e.g. `us-east-1`)
3. Copy the **REST URL** and **REST Token** from the database details page
4. Add them to your Vercel project environment variables:

```
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxx...
```

## Local Development

No setup needed. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are missing, rate limiting falls back to an in-memory Map store automatically.

If you want to test against a real Redis instance locally, add the two env vars to `.env.local`.

## Cost

Upstash has a free tier with 10,000 commands/day, which is more than enough for typical rate limiting traffic.

## Implementation Details

- Packages: `@upstash/ratelimit`, `@upstash/redis`
- Source: `lib/security/rate-limit.ts`
- All API routes call `await checkRateLimit(bucket, key, config)` which routes to Redis or in-memory automatically
