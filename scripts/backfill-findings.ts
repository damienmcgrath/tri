/**
 * Findings backfill — spec §1.5 final step.
 *
 * Iterates the last 30 days of completed sessions, builds the analyzer
 * context, runs the registry, and upserts the resulting findings.
 *
 * Idempotent: `upsertFindings` is keyed on (session_id, finding_id,
 * analyzer_version), so re-running rewrites in place rather than duplicating.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-findings.ts [--days=30] [--user=<uuid>]
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { assembleAnalyzerContext } from "../lib/execution-review";
import { analyzerRegistry } from "../lib/findings/registry";
import { upsertFindings } from "../lib/findings/persist";

function parseFlag(name: string, fallback?: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const days = Number.parseInt(parseFlag("days", "30") ?? "30", 10);
  const userFilter = parseFlag("user");

  const supabase = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  console.info("[findings-backfill] starting", {
    days,
    cutoff,
    userFilter: userFilter ?? "(all)"
  });

  let query = supabase
    .from("sessions")
    .select("id,user_id,athlete_id,date,status")
    .eq("status", "completed")
    .gte("date", cutoff)
    .order("date", { ascending: false });

  if (userFilter) {
    query = query.eq("user_id", userFilter);
  }

  const { data: sessions, error } = await query;
  if (error) {
    console.error("[findings-backfill] session load failed", error.message);
    process.exit(1);
  }

  const rows = sessions ?? [];
  console.info(`[findings-backfill] loaded ${rows.length} session(s)`);

  let processed = 0;
  let withFindings = 0;
  let failed = 0;
  const t0 = Date.now();

  for (const row of rows) {
    const sessionId = row.id as string;
    const userId = (row.user_id ?? row.athlete_id) as string | null;
    if (!userId) {
      failed += 1;
      continue;
    }

    try {
      const ctx = await assembleAnalyzerContext(sessionId, supabase);
      if (ctx) {
        const findings = analyzerRegistry.run(ctx);
        if (findings.length > 0) {
          await upsertFindings(sessionId, userId, findings, supabase);
          withFindings += 1;
        }
      }
    } catch (err) {
      failed += 1;
      console.warn("[findings-backfill] session failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err)
      });
    }

    processed += 1;
    if (processed % 100 === 0) {
      const rate = processed / Math.max(1, (Date.now() - t0) / 1000);
      console.info("[findings-backfill] progress", {
        processed,
        withFindings,
        failed,
        rate: `${rate.toFixed(1)}/s`
      });
    }
  }

  console.info("[findings-backfill] done", {
    total: rows.length,
    processed,
    withFindings,
    failed,
    elapsedMs: Date.now() - t0
  });
}

main().catch((err) => {
  console.error("[findings-backfill] fatal", err);
  process.exit(1);
});
