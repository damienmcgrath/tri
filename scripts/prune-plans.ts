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
 *   # Preserve sessions attached to victim plans by re-parenting them into
 *   # the keeper plan (picks the covering week by date). Activity links
 *   # stay intact. Sessions become "extras" alongside seeded ones.
 *   --migrate-sessions
 *
 *   # Allow cascade-delete even when victim plans still have sessions
 *   # (sessions and their activity links go with the plan). Mutually
 *   # exclusive with --migrate-sessions in spirit — pick one.
 *   --force
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
  force: boolean;
  migrateSessions: boolean;
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
    force: flags.has("force"),
    migrateSessions: flags.has("migrate-sessions"),
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
  sessionCount: number;       // sessions with plan_id = this plan → blocker (unless --force)
  orphanedSessionCount: number; // sessions whose week belongs to this plan → soft warning
  weekCount: number;
  blockCount: number;
  blockedSessions: BlockedSession[];
};

type BlockedSession = {
  id: string;
  date: string;
  sport: string;
  session_name: string | null;
  duration_minutes: number | null;
  linkCount: number;
};

type KeeperWeek = { id: string; week_start_date: string; plan_id: string };

async function loadKeeperWeeks(db: SupabaseClient, keeperPlanId: string): Promise<KeeperWeek[]> {
  const { data, error } = await db
    .from("training_weeks")
    .select("id, week_start_date, plan_id")
    .eq("plan_id", keeperPlanId)
    .order("week_start_date", { ascending: true });
  if (error) die(`failed to load keeper weeks: ${error.message}`);
  return (data ?? []) as KeeperWeek[];
}

function weekForDate(weeks: KeeperWeek[], date: string): KeeperWeek | null {
  // Each week covers [week_start_date, week_start_date + 6 days]. Pick the one
  // whose window contains `date`. Fall back to nearest week if slightly outside.
  for (const w of weeks) {
    const start = new Date(`${w.week_start_date}T00:00:00Z`).getTime();
    const end = start + 6 * 86_400_000;
    const t = new Date(`${date}T00:00:00Z`).getTime();
    if (t >= start && t <= end) return w;
  }
  return null;
}

async function migrateBlockedSessions(
  db: SupabaseClient,
  userId: string,
  keeperPlanId: string,
  blocked: PruneCheck[],
  dry: boolean,
): Promise<{ migrated: number; skipped: number }> {
  if (blocked.length === 0) return { migrated: 0, skipped: 0 };

  const weeks = await loadKeeperWeeks(db, keeperPlanId);

  let migrated = 0;
  let skipped = 0;

  for (const c of blocked) {
    console.log(`  Migrating sessions from "${c.plan.name}" → keeper:`);
    for (const s of c.blockedSessions) {
      const week = weekForDate(weeks, s.date);
      if (!week) {
        console.log(`    SKIP ${s.date} ${s.sport} — no keeper week covers this date`);
        skipped++;
        continue;
      }

      // day_order: put after existing sessions for that day to avoid collision.
      const { data: existing } = await db
        .from("sessions")
        .select("day_order")
        .eq("user_id", userId)
        .eq("date", s.date)
        .eq("plan_id", keeperPlanId)
        .order("day_order", { ascending: false })
        .limit(1);
      const nextDayOrder = existing && existing.length > 0 ? ((existing[0].day_order ?? 0) + 1) : 0;

      if (!dry) {
        const { error } = await db
          .from("sessions")
          .update({
            plan_id: keeperPlanId,
            week_id: week.id,
            day_order: nextDayOrder,
            source_metadata: {
              migrated_from_plan: c.plan.name,
              migrated_from_plan_id: c.plan.id,
              migrated_at: new Date().toISOString(),
            },
          })
          .eq("id", s.id)
          .eq("user_id", userId);
        if (error) die(`session migrate failed (${s.id}): ${error.message}`);
      }
      const linkNote = s.linkCount > 0 ? `  (keeps ${s.linkCount} activity link)` : "";
      console.log(`    ${dry ? "would move" : "moved"}  ${s.date}  ${s.sport.padEnd(8)} ${String(s.duration_minutes ?? "—").padStart(3)}m  ${s.session_name ?? "(unnamed)"}${linkNote}`);
      migrated++;
    }
  }

  return { migrated, skipped };
}

async function checkPlan(db: SupabaseClient, userId: string, plan: PlanRow): Promise<PruneCheck> {
  const { data: sessions } = await db
    .from("sessions")
    .select("id, date, sport, session_name, duration_minutes")
    .eq("user_id", userId)
    .eq("plan_id", plan.id)
    .order("date", { ascending: true });
  const sessionRows = (sessions ?? []) as Array<Omit<BlockedSession, "linkCount">>;

  // Count confirmed links per session (ones that will be cascade-deleted with
  // the session). Completed_activities survive, but lose their planned link.
  const blockedSessions: BlockedSession[] = [];
  if (sessionRows.length > 0) {
    const sessionIds = sessionRows.map((s) => s.id);
    const { data: links } = await db
      .from("session_activity_links")
      .select("planned_session_id")
      .eq("user_id", userId)
      .in("planned_session_id", sessionIds);
    const linkCountBySession = new Map<string, number>();
    for (const l of (links ?? []) as Array<{ planned_session_id: string }>) {
      linkCountBySession.set(l.planned_session_id, (linkCountBySession.get(l.planned_session_id) ?? 0) + 1);
    }
    for (const s of sessionRows) {
      blockedSessions.push({ ...s, linkCount: linkCountBySession.get(s.id) ?? 0 });
    }
  }

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
    sessionCount: sessionRows.length,
    orphanedSessionCount,
    weekCount: weekIds.length,
    blockCount: blockCount ?? 0,
    blockedSessions,
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

  const { data: profileRow } = await db.from("profiles").select("active_plan_id").eq("id", args.userId).maybeSingle();
  const currentActiveId = profileRow?.active_plan_id ?? null;
  const activeMismatch = currentActiveId !== null && currentActiveId !== keeper.id;

  console.log(`\nPrune plans for user ${args.userId}`);
  console.log(`Mode: ${args.mode}\n`);
  console.log(`All plans (${planRows.length}):`);
  for (const p of planRows) {
    const tag = p.id === keeper.id ? "  KEEP →" : "  prune  ";
    console.log(`${tag} ${p.id}  ${p.start_date ?? "—"}  ${String(p.duration_weeks ?? "—").padStart(2)}w  ${p.name}`);
  }

  if (activeMismatch) {
    const activeName = planRows.find((p) => p.id === currentActiveId)?.name ?? "(unknown)";
    console.log(`\nNote: profiles.active_plan_id currently points at "${activeName}" (${currentActiveId}).`);
    console.log(`      Will be updated to the keeper on --apply.`);
  }

  if (victims.length === 0) {
    console.log("\nOnly the keeper exists — nothing to prune.");
    return;
  }

  console.log(`\nSafety checks:`);
  let checks: PruneCheck[] = [];
  for (const plan of victims) {
    const c = await checkPlan(db, args.userId, plan);
    checks.push(c);
    const blockerLabel = c.sessionCount > 0 ? "  BLOCKED" : c.orphanedSessionCount > 0 ? "  warn   " : "  ok     ";
    console.log(`${blockerLabel} "${plan.name}"  sessions=${c.sessionCount}  weeks=${c.weekCount}  session-via-week=${c.orphanedSessionCount}  blocks=${c.blockCount}`);
  }

  // --migrate-sessions: re-parent victim sessions into the keeper plan before
  // the safety check. After migration, re-compute checks so the blocked plans
  // show 0 sessions and become safely deletable.
  if (args.migrateSessions) {
    const blockedForMigration = checks.filter((c) => c.sessionCount > 0);
    if (blockedForMigration.length > 0) {
      const label = args.mode === "apply" ? "\nMigrating sessions:" : "\nWould migrate sessions (dry-run / inspect):";
      console.log(label);
      const dry = args.mode !== "apply";
      const { migrated, skipped } = await migrateBlockedSessions(db, args.userId, keeper.id, blockedForMigration, dry);
      console.log(`  total: ${dry ? "would move" : "moved"} ${migrated}, skipped ${skipped}`);
      if (args.mode === "apply" && migrated > 0) {
        // Recompute checks — migrated plans should now have 0 sessions
        console.log(`\nRe-running safety checks after migration:`);
        checks = [];
        for (const plan of victims) {
          const c = await checkPlan(db, args.userId, plan);
          checks.push(c);
          const blockerLabel = c.sessionCount > 0 ? "  BLOCKED" : c.orphanedSessionCount > 0 ? "  warn   " : "  ok     ";
          console.log(`${blockerLabel} "${plan.name}"  sessions=${c.sessionCount}  weeks=${c.weekCount}  session-via-week=${c.orphanedSessionCount}  blocks=${c.blockCount}`);
        }
      }
    }
  }

  const blocked = checks.filter((c) => c.sessionCount > 0);
  const deletable = args.force ? checks : checks.filter((c) => c.sessionCount === 0);

  if (blocked.length > 0) {
    console.log(`\n${blocked.length} plan(s) with ${blocked.reduce((s, c) => s + c.sessionCount, 0)} session(s) attached:`);
    for (const c of blocked) {
      const linkedSessions = c.blockedSessions.filter((s) => s.linkCount > 0).length;
      console.log(`  "${c.plan.name}" — ${c.sessionCount} sessions (${linkedSessions} with activity links)`);
      for (const s of c.blockedSessions) {
        const linkTag = s.linkCount > 0 ? `  ⚠ ${s.linkCount} link(s)` : "";
        console.log(`    ${s.date}  ${s.sport.padEnd(8)} ${String(s.duration_minutes ?? "—").padStart(3)}m  ${s.session_name ?? "(unnamed)"}${linkTag}`);
      }
    }

    if (!args.force) {
      console.log(`\nBLOCKED — pass --force to cascade-delete these sessions along with the plan.`);
      console.log(`Activity links pointing at them will also be deleted (completed_activities survive).`);
    } else {
      console.log(`\n--force set — these sessions will be CASCADE-DELETED with the plan.`);
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

  // apply — fix active_plan_id first so there's never a window where it
  // points at a row we're about to delete.
  if (activeMismatch) {
    const { error } = await db
      .from("profiles")
      .update({ active_plan_id: keeper.id })
      .eq("id", args.userId);
    if (error) die(`active_plan_id update failed: ${error.message}`);
    console.log(`\nUpdated profiles.active_plan_id → "${keeper.name}".`);
  }

  console.log(`\nDeleting ${deletable.length} plan(s)...`);
  for (const c of deletable) {
    const { error } = await db.from("training_plans").delete().eq("id", c.plan.id).eq("user_id", args.userId);
    if (error) die(`delete failed for "${c.plan.name}" (${c.plan.id}): ${error.message}`);
    console.log(`  deleted "${c.plan.name}"`);
  }
  console.log(`\nDone.`);
}

run(parseArgs(process.argv)).catch((err) => die(err instanceof Error ? err.message : String(err)));
