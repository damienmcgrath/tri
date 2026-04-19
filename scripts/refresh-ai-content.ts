#!/usr/bin/env npx tsx
/**
 * scripts/refresh-ai-content.ts
 *
 * Regenerate AI-generated content for a single user. Primary use case is
 * developer prompt iteration: after changing prompts or signal inputs, run
 * this against your own account to see fresh output without waiting for new
 * activity uploads.
 *
 * Uses the service-role key so it bypasses RLS — keep off user-facing paths.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/refresh-ai-content.ts --user=<uuid> [flags]
 *   npm run refresh-ai -- --user=<uuid> [flags]
 *
 * Flags:
 *   --user=<uuid>         Required. User / athlete id to refresh.
 *   --scope=<list>        Comma-separated: sessions,extras,weekly,patterns,all
 *                         (default: all). `sessions` regenerates both the
 *                         execution review and the session verdict.
 *   --since=<iso-date>    Only refresh content dated on/after this date
 *   --until=<iso-date>    Only refresh content dated on/before this date
 *   --concurrency=<n>     Parallel regens per scope (default 3)
 *   --dry-run             Print the plan without calling AI
 *
 * Notes:
 * - `sessions` scope covers planned sessions with a linked activity. Each one
 *   costs ~2 AI calls (execution review + session verdict).
 * - `extras` scope covers unlinked completed activities (~1 AI call each).
 * - `weekly` enumerates distinct weeks touched by completed work in the
 *   range and runs one weekly debrief refresh per week (~1 AI call each).
 * - `patterns` is a single deterministic aggregation pass (no AI call).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { syncSessionExecutionFromActivityLink, syncExtraActivityExecution } from "@/lib/workouts/session-execution";
import { refreshObservedPatterns } from "@/lib/execution-review-persistence";
import { refreshWeeklyDebrief } from "@/lib/weekly-debrief";
import { postSessionSyncSideEffects } from "@/lib/workouts/post-sync-effects";

type Scope = "sessions" | "extras" | "weekly" | "patterns";

type Args = {
  userId: string;
  scopes: Set<Scope>;
  since: string | null;
  until: string | null;
  concurrency: number;
  dryRun: boolean;
};

function die(message: string, code = 1): never {
  process.stderr.write(`refresh-ai-content: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    map.set(key, rest.length > 0 ? rest.join("=") : "true");
  }

  const userId = map.get("user");
  if (!userId) die("missing --user=<uuid>");
  if (!/^[0-9a-f-]{36}$/i.test(userId!)) die(`--user=${userId} does not look like a UUID`);

  const scopeRaw = (map.get("scope") ?? "all").toLowerCase();
  const allScopes: Scope[] = ["sessions", "extras", "weekly", "patterns"];
  const scopes = scopeRaw === "all"
    ? new Set(allScopes)
    : new Set(scopeRaw.split(",").map((s) => s.trim()).filter(Boolean) as Scope[]);
  for (const s of scopes) {
    if (!allScopes.includes(s)) die(`unknown scope "${s}" — allowed: ${allScopes.join(",")},all`);
  }

  const concurrency = Number(map.get("concurrency") ?? 3);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    die(`--concurrency must be an integer 1-10 (got ${map.get("concurrency")})`);
  }

  const isoDate = (v: string | undefined, flag: string) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) die(`${flag} must be YYYY-MM-DD (got ${v})`);
    return v;
  };

  return {
    userId: userId!,
    scopes,
    since: isoDate(map.get("since"), "--since"),
    until: isoDate(map.get("until"), "--until"),
    concurrency,
    dryRun: map.get("dry-run") === "true"
  };
}

function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set (try: npx tsx --env-file=.env.local ...)");
  return createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/** Run tasks with a simple concurrency cap. Rejections are reported but never throw. */
async function pool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<{ ok: number; failed: number }> {
  let cursor = 0;
  let ok = 0;
  let failed = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    try {
      await worker(items[i], i);
      ok += 1;
    } catch (e) {
      failed += 1;
      console.error(`  [item ${i}] failed:`, e instanceof Error ? e.message : e);
    }
    await next();
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(runners);
  return { ok, failed };
}

/** Monday-anchored ISO week start for a given YYYY-MM-DD. */
function weekStartFor(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Scope runners
// ---------------------------------------------------------------------------

async function refreshSessions(supabase: SupabaseClient, args: Args): Promise<void> {
  let query = supabase
    .from("sessions")
    .select("id,date,session_name,type,sport,athlete_id,user_id")
    .or(`athlete_id.eq.${args.userId},user_id.eq.${args.userId}`)
    .eq("status", "completed")
    .order("date", { ascending: true });
  if (args.since) query = query.gte("date", args.since);
  if (args.until) query = query.lte("date", args.until);

  const { data: sessions, error } = await query;
  if (error) die(`failed to list sessions: ${error.message}`);
  if (!sessions || sessions.length === 0) {
    console.log("[sessions] no completed sessions in range.");
    return;
  }

  // Filter to sessions that have a confirmed activity link — the review path
  // needs both rows to run. Unlinked completions would fall through to
  // deterministic anyway.
  const { data: links } = await supabase
    .from("session_activity_links")
    .select("planned_session_id,completed_activity_id,confirmation_status")
    .in("planned_session_id", sessions.map((s) => s.id))
    .in("confirmation_status", ["confirmed"]);
  const linkBySession = new Map((links ?? []).map((l) => [l.planned_session_id, l.completed_activity_id]));
  const eligible = sessions.filter((s) => linkBySession.has(s.id));

  console.log(`[sessions] ${eligible.length} linked sessions to refresh (of ${sessions.length} completed).`);
  if (args.dryRun) {
    for (const s of eligible) console.log(`  would refresh ${s.date}  ${s.sport.padEnd(8)} ${s.session_name ?? s.type} (${s.id})`);
    return;
  }

  const { ok, failed } = await pool(eligible, args.concurrency, async (session) => {
    const activityId = linkBySession.get(session.id)!;
    console.log(`  ↺ ${session.date}  ${session.sport.padEnd(8)} ${session.session_name ?? session.type}`);
    await syncSessionExecutionFromActivityLink({
      supabase,
      userId: args.userId,
      sessionId: session.id,
      activityId
    });
    // Verdict chain (session verdict + rationale + comparison). Weekly debrief
    // is refreshed separately in the weekly scope to avoid N refreshes per week.
    await postSessionSyncSideEffects({
      supabase,
      userId: args.userId,
      sessionId: session.id,
      activityId,
      sessionDate: session.date,
      skipDebriefRefresh: true
    });
  });
  console.log(`[sessions] ${ok} refreshed, ${failed} failed.`);
}

async function refreshExtras(supabase: SupabaseClient, args: Args): Promise<void> {
  let query = supabase
    .from("completed_activities")
    .select("id,start_time_utc,sport_type")
    .eq("user_id", args.userId)
    .order("start_time_utc", { ascending: true });
  if (args.since) query = query.gte("start_time_utc", `${args.since}T00:00:00Z`);
  if (args.until) query = query.lte("start_time_utc", `${args.until}T23:59:59Z`);

  const { data: activities, error } = await query;
  if (error) die(`failed to list activities: ${error.message}`);
  if (!activities || activities.length === 0) {
    console.log("[extras] no activities in range.");
    return;
  }

  // Extras = activities NOT confirmed-linked to a planned session.
  const { data: links } = await supabase
    .from("session_activity_links")
    .select("completed_activity_id,confirmation_status")
    .in("completed_activity_id", activities.map((a) => a.id));
  const linkedIds = new Set((links ?? []).filter((l) => l.confirmation_status === "confirmed").map((l) => l.completed_activity_id));
  const extras = activities.filter((a) => !linkedIds.has(a.id));

  console.log(`[extras] ${extras.length} unlinked activities to refresh (of ${activities.length} in range).`);
  if (args.dryRun) {
    for (const a of extras) console.log(`  would refresh ${a.start_time_utc.slice(0, 10)}  ${a.sport_type} (${a.id})`);
    return;
  }

  const { ok, failed } = await pool(extras, args.concurrency, async (activity) => {
    console.log(`  ↺ ${activity.start_time_utc.slice(0, 10)}  ${activity.sport_type} (${activity.id})`);
    await syncExtraActivityExecution({ supabase, userId: args.userId, activityId: activity.id });
  });
  console.log(`[extras] ${ok} refreshed, ${failed} failed.`);
}

async function refreshWeeklies(supabase: SupabaseClient, args: Args): Promise<void> {
  // Build the set of distinct week-starts touched by completed sessions OR
  // activities in the range. This matches what the weekly debrief normally
  // aggregates so we don't refresh empty weeks.
  const weekStarts = new Set<string>();
  let sessionsQ = supabase
    .from("sessions")
    .select("date")
    .or(`athlete_id.eq.${args.userId},user_id.eq.${args.userId}`)
    .eq("status", "completed");
  if (args.since) sessionsQ = sessionsQ.gte("date", args.since);
  if (args.until) sessionsQ = sessionsQ.lte("date", args.until);
  const { data: sRows } = await sessionsQ;
  for (const row of sRows ?? []) weekStarts.add(weekStartFor(row.date));

  let actsQ = supabase
    .from("completed_activities")
    .select("start_time_utc")
    .eq("user_id", args.userId);
  if (args.since) actsQ = actsQ.gte("start_time_utc", `${args.since}T00:00:00Z`);
  if (args.until) actsQ = actsQ.lte("start_time_utc", `${args.until}T23:59:59Z`);
  const { data: aRows } = await actsQ;
  for (const row of aRows ?? []) weekStarts.add(weekStartFor(row.start_time_utc.slice(0, 10)));

  const weeks = [...weekStarts].sort();
  console.log(`[weekly] ${weeks.length} distinct weeks to refresh.`);
  if (args.dryRun) {
    for (const w of weeks) console.log(`  would refresh week ${w}`);
    return;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const { ok, failed } = await pool(weeks, args.concurrency, async (weekStart) => {
    console.log(`  ↺ week ${weekStart}`);
    const result = await refreshWeeklyDebrief({
      supabase,
      athleteId: args.userId,
      weekStart,
      timeZone: "UTC",
      todayIso
    });
    if (!result.artifact) console.log(`    (week ${weekStart} not ready — ${result.readiness.reason})`);
  });
  console.log(`[weekly] ${ok} refreshed, ${failed} failed.`);
}

async function refreshPatterns(supabase: SupabaseClient, args: Args): Promise<void> {
  console.log("[patterns] recomputing observed patterns…");
  if (args.dryRun) return;
  await refreshObservedPatterns(supabase, args.userId);
  console.log("[patterns] done.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const supabase = createServiceClient();

  console.log(`Refreshing AI content for user=${args.userId}`);
  console.log(`  scopes:      ${[...args.scopes].join(", ")}`);
  console.log(`  range:       ${args.since ?? "∞"} → ${args.until ?? "today"}`);
  console.log(`  concurrency: ${args.concurrency}${args.dryRun ? "  (DRY RUN)" : ""}`);
  console.log();

  // Order matters: sessions → extras → weekly → patterns. Weekly aggregates
  // the upstream work, so it runs last to capture refreshed reviews.
  if (args.scopes.has("sessions")) await refreshSessions(supabase, args);
  if (args.scopes.has("extras")) await refreshExtras(supabase, args);
  if (args.scopes.has("weekly")) await refreshWeeklies(supabase, args);
  if (args.scopes.has("patterns")) await refreshPatterns(supabase, args);

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
