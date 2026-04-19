/**
 * One-off: force re-fetch & re-normalize Strava activities for a user,
 * bypassing the "already backfilled" skip check in backfillStravaMetrics.
 *
 * Use when the Strava normalizer shape changes and historical rows need
 * to be rewritten (e.g. the split-halves fix that added firstHalfAvgHr /
 * lastHalfAvgHr / firstHalfPaceSPerKm / lastHalfPaceSPerKm to metrics_v2).
 *
 * Requires env vars (pulled from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (for token refresh)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/strava-resync.ts <email> [externalActivityId ...]
 *
 * Examples:
 *   # Re-sync ALL Strava activities for the user
 *   npx tsx --env-file=.env.local scripts/strava-resync.ts damien.mcgrath7@gmail.com
 *
 *   # Re-sync a single Strava activity by its Strava ID
 *   npx tsx --env-file=.env.local scripts/strava-resync.ts damien.mcgrath7@gmail.com 12345678901
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getConnection, refreshIfExpired } from "../lib/integrations/token-service";
import { backfillStravaMetrics } from "../lib/integrations/strava-metrics-backfill";

async function main() {
  const [email, ...externalIds] = process.argv.slice(2);

  if (!email) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/strava-resync.ts <email> [externalActivityId ...]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const admin = createSupabaseClient(url, key);

  // Default listUsers page size is 50 — bump it so we don't miss the target
  // user in a larger DB. 1000 is the Supabase per-page ceiling.
  const { data: userRow, error: userErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (userErr) {
    console.error("Failed to list users:", userErr.message);
    process.exit(1);
  }
  const user = userRow.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  console.log(`[RESYNC] user ${email} → ${user.id}`);

  const connection = await getConnection(user.id, "strava");
  if (!connection) {
    console.error("No Strava connection for this user.");
    process.exit(1);
  }

  const fresh = await refreshIfExpired(connection);

  const result = await backfillStravaMetrics(user.id, fresh, {
    force: true,
    externalActivityIds: externalIds.length > 0 ? externalIds : undefined,
    onProgress: (p) => {
      console.log(`[RESYNC] ${p.current}/${p.total} — updated=${p.updated} failed=${p.failed}`);
    }
  });

  console.log("[RESYNC] done", result);
}

main().catch((err) => {
  console.error("[RESYNC] fatal:", err);
  process.exit(1);
});
