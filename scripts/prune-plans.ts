#!/usr/bin/env npx tsx
/**
 * scripts/prune-plans.ts
 *
 * Delete all training plans for a user *except* the keeper (by default, the
 * plan referenced by profiles.active_plan_id). Safe to run after seed-plan.ts
 * has re-parented historical sessions into the new plan.
 *
 * Uses the service-role key — bypasses RLS. Keep off user-facing paths.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/prune-plans.ts --user=<uuid> --inspect
 *   npx tsx --env-file=.env.local scripts/prune-plans.ts --user=<uuid> --dry-run
 *   npx tsx --env-file=.env.local scripts/prune-plans.ts --user=<uuid> --apply
 *
 *   # Pin the keeper explicitly instead of relying on active_plan_id
 *   --keep=<plan-uuid>
 *   --keep-name="Ironman Warsaw 70.3 2026"
 *
 * Safety checks (every non-keeper plan must pass before it's deleted):
 *   1. No sessions with plan_id pointing at it (would be cascade-deleted).
 *   2. No sessions whose week_id belongs to one of its weeks. (week_id is
 *      ON DELETE SET NULL, so this is a soft warning — sessions would survive
 *      but lose their week anchor.)
 *
 * Cascade summary on delete:
 *   training_plans (deleted)
 *     → training_weeks.plan_id          CASCADE (weeks deleted)
 *     → sessions.plan_id                CASCADE (would be a bug — we bail)
 *     → training_blocks.plan_id         SET NULL (blocks survive)
 *     → sessions.week_id (via weeks)    SET NULL (sessions survive)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Mode = "inspect" | "dry-run" | "apply";

type Args = {
  userId: string;
  mode: Mode;
  keepId: string | null;
  keepName: string | null;
};

type PlanRow = {
  id: string;
  name: string;
  start_date: string | null;
  duration_weeks: number | null;
  created_at: string | null;
};

function die(message: string, code = 1): never {
  process.stderr.write(`prune-plans: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  const flags = new Set<string>();
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    if (rest.length === 0) flags.add(key);
    else map.set(key, rest.join("="));
  }

  const userId = map.get("user");
  if (!userId) die("missing required --user=<uuid>");

  let mode: Mode = "dry-run";
  if (flags.has("inspect")) mode = "inspect";
  else if (flags.has("apply")) mode = "apply";
  else if (flags.has("dry-run")) mode = "dry-run";

  return {
    userId: userId!,
    mode,
    keepId: map.get("keep") ?? null,
    keepName: map.get("keep-name") ?? null,
  };
}

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  return createClient(url!, key!, { auth: { persistSession: false } });
}

async function resolveKeeper(
  db: SupabaseClient,
  userId: string,
  plans: PlanRow[],
  args: Args,
): Promise<PlanRow> {
  if (args.keepId) {
    const hit = plans.find((p) => p.id === args.keepId);
    if (!hit) die(`--keep=${args.keepId} not found among user's plans`);
    return hit;
  }
  if (args.keepName) {
    const hit = plans.find((p) => p.name === args.keepName);
    if (!hit) die(`--keep-name="${args.keepName}" not found among user's plans`);
    return hit;
  }

  const { data: profile } = await db.from("profiles").select("active_plan_id").eq("id", userId).maybeSingle();
  const activeId = profile?.active_plan_id ?? null;
  if (!activeId) die("no --keep / --keep-name specified and profiles.active_plan_id is null");

  const hit = plans.find((p) => p.id === activeId);
  if (!hit) die(`profiles.active_plan_id (${activeId}) doesn't match any of the user's plans`);
  return hit;
}

type PruneCheck = {
  plan: PlanRow;
  sessionCount: number;       // sessions with plan_id = this plan → blocker
  orphanedSessionCount: number; // sessions whose week belongs to this plan → soft warning
  weekCount: number;
  blockCount: number;
};

async function checkPlan(db: SupabaseClient, userId: string, plan: PlanRow): Promise<PruneCheck> {
  const { count: sessionCount } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("plan_id", plan.id);

  const { data: weeks } = await db
    .from("training_weeks")
    .select("id")
    .eq("plan_id", plan.id);
  const weekIds = (weeks ?? []).map((w: { id: string }) => w.id);

  let orphanedSessionCount = 0;
  if (weekIds.length > 0) {
    const { count } = await db
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("week_id", weekIds);
    orphanedSessionCount = count ?? 0;
  }

  const { count: blockCount } = await db
    .from("training_blocks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("plan_id", plan.id);

  return {
    plan,
    sessionCount: sessionCount ?? 0,
    orphanedSessionCount,
    weekCount: weekIds.length,
    blockCount: blockCount ?? 0,
  };
}

async function run(args: Args): Promise<void> {
  const db = client();

  const { data: plans, error: planErr } = await db
    .from("training_plans")
    .select("id, name, start_date, duration_weeks, created_at")
    .eq("user_id", args.userId)
    .order("created_at", { ascending: true });
  if (planErr) die(`failed to list plans: ${planErr.message}`);

  const planRows = (plans ?? []) as PlanRow[];
  if (planRows.length === 0) die(`user ${args.userId} has no training_plans`);

  const keeper = await resolveKeeper(db, args.userId, planRows, args);
  const victims = planRows.filter((p) => p.id !== keeper.id);

  console.log(`\nPrune plans for user ${args.userId}`);
  console.log(`Mode: ${args.mode}\n`);
  console.log(`All plans (${planRows.length}):`);
  for (const p of planRows) {
    const tag = p.id === keeper.id ? "  KEEP →" : "  prune  ";
    console.log(`${tag} ${p.id}  ${p.start_date ?? "—"}  ${String(p.duration_weeks ?? "—").padStart(2)}w  ${p.name}`);
  }

  if (victims.length === 0) {
    console.log("\nOnly the keeper exists — nothing to prune.");
    return;
  }

  console.log(`\nSafety checks:`);
  const checks: PruneCheck[] = [];
  for (const plan of victims) {
    const c = await checkPlan(db, args.userId, plan);
    checks.push(c);
    const blockerLabel = c.sessionCount > 0 ? "  BLOCKED" : c.orphanedSessionCount > 0 ? "  warn   " : "  ok     ";
    console.log(`${blockerLabel} "${plan.name}"  sessions=${c.sessionCount}  weeks=${c.weekCount}  session-via-week=${c.orphanedSessionCount}  blocks=${c.blockCount}`);
  }

  const blocked = checks.filter((c) => c.sessionCount > 0);
  const deletable = checks.filter((c) => c.sessionCount === 0);

  if (blocked.length > 0) {
    console.log(`\n${blocked.length} plan(s) BLOCKED — sessions still reference them via plan_id.`);
    console.log(`Re-run scripts/seed-plan.ts --apply (or manually re-parent) before pruning.`);
    for (const c of blocked) {
      console.log(`  "${c.plan.name}" has ${c.sessionCount} sessions that would be CASCADE-DELETED.`);
    }
  }

  if (args.mode === "inspect") {
    console.log(`\n(inspect only — no writes.)`);
    return;
  }

  if (deletable.length === 0) {
    console.log(`\nNothing safe to delete. Exiting.`);
    return;
  }

  if (args.mode === "dry-run") {
    console.log(`\nWould delete ${deletable.length} plan(s):`);
    for (const c of deletable) {
      console.log(`  "${c.plan.name}" (+ ${c.weekCount} week(s) via cascade)`);
      if (c.orphanedSessionCount > 0) {
        console.log(`    WARNING: ${c.orphanedSessionCount} session(s) will lose their week_id (set to null).`);
      }
      if (c.blockCount > 0) {
        console.log(`    NOTE: ${c.blockCount} training_block(s) will have plan_id cleared to null (blocks survive).`);
      }
    }
    console.log(`\n(dry-run — no writes. Re-run with --apply to delete.)`);
    return;
  }

  // apply
  console.log(`\nDeleting ${deletable.length} plan(s)...`);
  for (const c of deletable) {
    const { error } = await db.from("training_plans").delete().eq("id", c.plan.id).eq("user_id", args.userId);
    if (error) die(`delete failed for "${c.plan.name}" (${c.plan.id}): ${error.message}`);
    console.log(`  deleted "${c.plan.name}"`);
  }
  console.log(`\nDone.`);
}

run(parseArgs(process.argv)).catch((err) => die(err instanceof Error ? err.message : String(err)));
