#!/usr/bin/env npx tsx
/**
 * scripts/seed-plan.ts
 *
 * Seed a user account with the historical training plan defined in
 * scripts/seed-data/plan-2026.ts. Creates season → plan → blocks → weeks →
 * sessions, merging with any existing data in the date range.
 *
 * Uses the service-role key so it bypasses RLS — keep off user-facing paths.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/seed-plan.ts --user=<uuid> --inspect
 *   npx tsx --env-file=.env.local scripts/seed-plan.ts --user=<uuid> --dry-run
 *   npx tsx --env-file=.env.local scripts/seed-plan.ts --user=<uuid> --apply
 *   npx tsx --env-file=.env.local scripts/seed-plan.ts --user=<uuid> --apply --set-active
 *
 * Modes:
 *   --inspect     Report existing data in the plan's date range and exit
 *   --dry-run     Show what would change without writing (default)
 *   --apply       Write changes
 *   --set-active  On --apply, also set profiles.active_plan_id to the seeded plan
 *
 * Merge semantics:
 *   - Season / plan / blocks / weeks: upserted by natural keys (user_id + name,
 *     plan_id + week_index, etc). Safe to re-run.
 *   - Sessions: match existing rows by (user_id, date, sport). Matched rows
 *     are UPDATED — plan_id/week_id/day_order/source_metadata are re-parented,
 *     session_name/duration/notes are filled in only if NULL/empty. Unmatched
 *     seed sessions are INSERTED.
 *   - completed_activities and session_activity_links are NEVER touched.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PLAN_2026 } from "./seed-data/plan-2026";
import type { SeedBlock, SeedPlan, SeedSession, SeedWeek } from "./seed-data/types";

type Mode = "inspect" | "dry-run" | "apply";

type Args = {
  userId: string;
  mode: Mode;
  setActive: boolean;
};

function die(message: string, code = 1): never {
  process.stderr.write(`seed-plan: ${message}\n`);
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
    setActive: flags.has("set-active"),
  };
}

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  return createClient(url!, key!, { auth: { persistSession: false } });
}

function planDateRange(plan: SeedPlan): { start: string; end: string } {
  const starts = plan.blocks.map((b) => b.startDate).sort();
  const ends = plan.blocks.map((b) => b.endDate).sort();
  return { start: starts[0], end: ends[ends.length - 1] };
}

async function inspect(db: SupabaseClient, userId: string, plan: SeedPlan): Promise<void> {
  const { start, end } = planDateRange(plan);
  console.log(`\nInspecting user ${userId} for plan date range ${start} → ${end}\n`);

  const { data: profile } = await db.from("profiles").select("id, display_name, active_plan_id, race_name, race_date").eq("id", userId).maybeSingle();
  if (!profile) die(`profile not found for user ${userId}`);
  console.log(`Profile: ${profile!.display_name ?? "(no name)"} — active_plan_id=${profile!.active_plan_id ?? "(none)"}`);
  console.log(`         race_name=${profile!.race_name ?? "(none)"} race_date=${profile!.race_date ?? "(none)"}\n`);

  const { data: plans } = await db
    .from("training_plans")
    .select("id, name, start_date, duration_weeks")
    .eq("user_id", userId)
    .order("start_date", { ascending: true });
  console.log(`training_plans (${plans?.length ?? 0}):`);
  for (const p of plans ?? []) {
    console.log(`  ${p.id}  ${p.start_date}  ${p.duration_weeks}w  ${p.name}`);
  }

  const { data: seasons } = await db
    .from("seasons")
    .select("id, name, start_date, end_date, status")
    .eq("user_id", userId);
  console.log(`\nseasons (${seasons?.length ?? 0}):`);
  for (const s of seasons ?? []) {
    console.log(`  ${s.id}  ${s.start_date}→${s.end_date}  ${s.status}  ${s.name}`);
  }

  const { data: blocks } = await db
    .from("training_blocks")
    .select("id, name, block_type, start_date, end_date, plan_id, season_id")
    .eq("user_id", userId)
    .order("start_date", { ascending: true });
  console.log(`\ntraining_blocks (${blocks?.length ?? 0}):`);
  for (const b of blocks ?? []) {
    console.log(`  ${b.start_date}→${b.end_date}  ${b.block_type.padEnd(11)}  ${b.name}`);
  }

  const { count: unlinkedWeekCount } = await db
    .from("training_weeks")
    .select("id", { count: "exact", head: true })
    .in("plan_id", (plans ?? []).map((p) => p.id))
    .is("block_id", null);
  console.log(`\ntraining_weeks without block_id: ${unlinkedWeekCount ?? 0}`);

  const { count: sessionCount } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", end);

  const { count: linkedCount } = await db
    .from("session_activity_links")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const { data: linkedSessions } = await db
    .from("sessions")
    .select("id, date, sport, session_name, session_activity_links!inner(id)")
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", end);

  const { count: reviewCount } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", end)
    .not("execution_result", "is", null);

  const { count: completedActivityCount } = await db
    .from("completed_activities")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("start_time_utc", `${start}T00:00:00Z`)
    .lte("start_time_utc", `${end}T23:59:59Z`);

  console.log(`\nIn plan date range ${start} → ${end}:`);
  console.log(`  sessions:             ${sessionCount ?? 0}`);
  console.log(`    with activity link: ${linkedSessions?.length ?? 0}`);
  console.log(`    with execution review: ${reviewCount ?? 0}`);
  console.log(`  completed_activities: ${completedActivityCount ?? 0}`);
  console.log(`  session_activity_links (user total): ${linkedCount ?? 0}`);

  const seedSessionCount = plan.blocks.reduce(
    (sum, b) => sum + b.weeks.reduce((s, w) => s + w.sessions.length, 0),
    0,
  );
  const seedWeekCount = plan.blocks.reduce((sum, b) => sum + b.weeks.length, 0);
  console.log(`\nSeed plan "${plan.planName}":`);
  console.log(`  blocks:   ${plan.blocks.length}`);
  console.log(`  weeks:    ${seedWeekCount}`);
  console.log(`  sessions: ${seedSessionCount}`);
}

type ApplyStats = {
  seasonAction: "insert" | "update" | "skip";
  planAction: "insert" | "update" | "skip";
  blocksInserted: number;
  blocksUpdated: number;
  weeksInserted: number;
  weeksUpdated: number;
  sessionsInserted: number;
  sessionsUpdated: number;
  sessionsSkipped: number;
};

async function apply(db: SupabaseClient, userId: string, plan: SeedPlan, mode: Mode, setActive: boolean): Promise<ApplyStats> {
  const dry = mode === "dry-run";
  const stats: ApplyStats = {
    seasonAction: "skip",
    planAction: "skip",
    blocksInserted: 0,
    blocksUpdated: 0,
    weeksInserted: 0,
    weeksUpdated: 0,
    sessionsInserted: 0,
    sessionsUpdated: 0,
    sessionsSkipped: 0,
  };

  const { data: profile } = await db.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!profile) die(`profile not found for user ${userId}`);
  const athleteId = userId;

  // --- Season (upsert by user_id + name) ---------------------------------
  const { start: planStart, end: planEnd } = planDateRange(plan);
  const { data: existingSeason } = await db
    .from("seasons")
    .select("id, start_date, end_date")
    .eq("user_id", userId)
    .eq("name", plan.seasonName)
    .maybeSingle();

  let seasonId = existingSeason?.id as string | undefined;
  if (!seasonId) {
    if (!dry) {
      const { data, error } = await db
        .from("seasons")
        .insert({
          user_id: userId,
          athlete_id: athleteId,
          name: plan.seasonName,
          start_date: planStart,
          end_date: planEnd,
          primary_goal: plan.raceName,
          status: "active",
        })
        .select("id")
        .single();
      if (error) die(`season insert failed: ${error.message}`);
      seasonId = data!.id;
    }
    stats.seasonAction = "insert";
  } else {
    stats.seasonAction = "skip";
  }

  // --- Training plan (upsert by user_id + name) --------------------------
  const { data: existingPlan } = await db
    .from("training_plans")
    .select("id")
    .eq("user_id", userId)
    .eq("name", plan.planName)
    .maybeSingle();

  let planId = existingPlan?.id as string | undefined;
  if (!planId) {
    if (!dry) {
      const { data, error } = await db
        .from("training_plans")
        .insert({
          user_id: userId,
          athlete_id: athleteId,
          name: plan.planName,
          start_date: plan.planStartDate,
          duration_weeks: plan.durationWeeks,
        })
        .select("id")
        .single();
      if (error) die(`plan insert failed: ${error.message}`);
      planId = data!.id;
    }
    stats.planAction = "insert";
  } else {
    if (!dry) {
      const { error } = await db
        .from("training_plans")
        .update({ start_date: plan.planStartDate, duration_weeks: plan.durationWeeks })
        .eq("id", planId);
      if (error) die(`plan update failed: ${error.message}`);
    }
    stats.planAction = "update";
  }

  // --- Blocks (upsert by plan_id + name) ---------------------------------
  const blockIdByName = new Map<string, string>();
  for (let i = 0; i < plan.blocks.length; i++) {
    const block = plan.blocks[i];
    const { data: existingBlock } = await db
      .from("training_blocks")
      .select("id")
      .eq("user_id", userId)
      .eq("name", block.name)
      .maybeSingle();

    if (!existingBlock) {
      if (!dry && planId && seasonId) {
        const { data, error } = await db
          .from("training_blocks")
          .insert({
            season_id: seasonId,
            plan_id: planId,
            user_id: userId,
            name: block.name,
            block_type: block.blockType,
            start_date: block.startDate,
            end_date: block.endDate,
            emphasis: { focus: block.emphasis },
            sort_order: i,
          })
          .select("id")
          .single();
        if (error) die(`block insert failed (${block.name}): ${error.message}`);
        blockIdByName.set(block.name, data!.id);
      }
      stats.blocksInserted++;
    } else {
      blockIdByName.set(block.name, existingBlock.id as string);
      if (!dry && planId && seasonId) {
        const { error } = await db
          .from("training_blocks")
          .update({
            season_id: seasonId,
            plan_id: planId,
            block_type: block.blockType,
            start_date: block.startDate,
            end_date: block.endDate,
            emphasis: { focus: block.emphasis },
            sort_order: i,
          })
          .eq("id", existingBlock.id);
        if (error) die(`block update failed (${block.name}): ${error.message}`);
      }
      stats.blocksUpdated++;
    }
  }

  // --- Weeks + Sessions --------------------------------------------------
  for (const block of plan.blocks) {
    const blockId = blockIdByName.get(block.name) ?? null;
    for (const week of block.weeks) {
      // Upsert week by (plan_id, week_index)
      const { data: existingWeek } = planId
        ? await db
            .from("training_weeks")
            .select("id")
            .eq("plan_id", planId)
            .eq("week_index", week.weekIndex)
            .maybeSingle()
        : { data: null };

      let weekId = existingWeek?.id as string | undefined;
      if (!weekId) {
        if (!dry && planId) {
          const { data, error } = await db
            .from("training_weeks")
            .insert({
              plan_id: planId,
              block_id: blockId,
              week_index: week.weekIndex,
              week_start_date: week.weekStartDate,
              focus: week.focus,
              notes: week.notes ?? null,
            })
            .select("id")
            .single();
          if (error) die(`week insert failed (${week.weekIndex}): ${error.message}`);
          weekId = data!.id;
        }
        stats.weeksInserted++;
      } else {
        if (!dry) {
          const { error } = await db
            .from("training_weeks")
            .update({
              block_id: blockId,
              week_start_date: week.weekStartDate,
              focus: week.focus,
              notes: week.notes ?? null,
            })
            .eq("id", weekId);
          if (error) die(`week update failed (${week.weekIndex}): ${error.message}`);
        }
        stats.weeksUpdated++;
      }

      // Sessions
      await upsertWeekSessions(db, {
        userId,
        athleteId,
        planId: planId ?? "dry-run",
        weekId: weekId ?? "dry-run",
        week,
        dry,
        stats,
      });
    }
  }

  // --- Set active plan ---------------------------------------------------
  if (setActive && mode === "apply" && planId) {
    const { error } = await db.from("profiles").update({ active_plan_id: planId }).eq("id", userId);
    if (error) die(`active_plan_id update failed: ${error.message}`);
  }

  return stats;
}

async function upsertWeekSessions(
  db: SupabaseClient,
  ctx: {
    userId: string;
    athleteId: string;
    planId: string;
    weekId: string;
    week: SeedWeek;
    dry: boolean;
    stats: ApplyStats;
  },
): Promise<void> {
  const { userId, athleteId, planId, weekId, week, dry, stats } = ctx;

  // Compute per-day ordering
  const dayCounters = new Map<string, number>();
  const seedRows = week.sessions.map((s) => {
    const currentOrder = dayCounters.get(s.date) ?? 0;
    dayCounters.set(s.date, currentOrder + 1);
    return { ...s, dayOrder: s.dayOrder ?? currentOrder };
  });

  for (const seed of seedRows) {
    // Match by (user_id, date, sport). If multiple exist (rare), prefer the one
    // without an existing plan_id match, then the oldest.
    const { data: candidates } = await db
      .from("sessions")
      .select("id, session_name, duration_minutes, notes, plan_id, week_id, day_order")
      .eq("user_id", userId)
      .eq("date", seed.date)
      .eq("sport", seed.sport)
      .order("created_at", { ascending: true });

    const existing = (candidates ?? [])[0];

    const sourceMetadata = {
      seed: "plan-2026",
      seed_week: week.weekIndex,
      seed_label: seed.notes ?? seed.sessionName,
      ...(seed.reconstructed ? { reconstructed: true } : {}),
    };

    if (existing) {
      // Preserve curated values; re-parent plan/week.
      const update: Record<string, unknown> = {
        plan_id: planId,
        week_id: weekId,
        day_order: seed.dayOrder,
        source_metadata: sourceMetadata,
      };
      if (!existing.session_name) update.session_name = seed.sessionName;
      if (!existing.duration_minutes) update.duration_minutes = seed.durationMinutes;
      if (!existing.notes && seed.notes) update.notes = seed.notes;

      if (!dry) {
        const { error } = await db.from("sessions").update(update).eq("id", existing.id);
        if (error) die(`session update failed (${seed.date} ${seed.sport}): ${error.message}`);
      }
      stats.sessionsUpdated++;
    } else {
      if (!dry) {
        const { error } = await db.from("sessions").insert({
          plan_id: planId,
          week_id: weekId,
          user_id: userId,
          athlete_id: athleteId,
          date: seed.date,
          sport: seed.sport,
          type: seed.sessionName,
          session_name: seed.sessionName,
          discipline: seed.discipline ?? seed.sport,
          subtype: seed.subtype ?? seed.sessionName,
          duration_minutes: seed.durationMinutes,
          notes: seed.notes ?? null,
          target: seed.target ?? null,
          day_order: seed.dayOrder,
          status: "planned",
          source_metadata: sourceMetadata,
        });
        if (error) die(`session insert failed (${seed.date} ${seed.sport}): ${error.message}`);
      }
      stats.sessionsInserted++;
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const db = client();
  const plan = PLAN_2026;

  if (args.mode === "inspect") {
    await inspect(db, args.userId, plan);
    return;
  }

  const stats = await apply(db, args.userId, plan, args.mode, args.setActive);
  const label = args.mode === "dry-run" ? "[DRY RUN] " : "";
  console.log(`\n${label}Seed complete.`);
  console.log(`  season:   ${stats.seasonAction}`);
  console.log(`  plan:     ${stats.planAction}`);
  console.log(`  blocks:   +${stats.blocksInserted} / ~${stats.blocksUpdated}`);
  console.log(`  weeks:    +${stats.weeksInserted} / ~${stats.weeksUpdated}`);
  console.log(`  sessions: +${stats.sessionsInserted} / ~${stats.sessionsUpdated}`);
  if (args.mode === "apply" && args.setActive) {
    console.log(`  profiles.active_plan_id: set`);
  }
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
