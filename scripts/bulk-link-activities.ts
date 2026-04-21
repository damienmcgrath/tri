#!/usr/bin/env npx tsx
/**
 * scripts/bulk-link-activities.ts
 *
 * Bulk-link unlinked completed_activities (Strava, upload, etc.) to the planned
 * session that shares its date + sport. Mirrors the manual "Assign" click from
 * the activity detail page, just done in batch.
 *
 * Uses the service-role key so it bypasses RLS — keep off user-facing paths.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/bulk-link-activities.ts --user=<uuid> --inspect
 *   npx tsx --env-file=.env.local scripts/bulk-link-activities.ts --user=<uuid> --dry-run
 *   npx tsx --env-file=.env.local scripts/bulk-link-activities.ts --user=<uuid> --apply
 *
 *   # optional date window (inclusive, UTC date of start_time_utc)
 *   --from=2025-11-03 --to=2026-06-07
 *
 * Link semantics (matches app/(protected)/activities/[activityId]/actions.ts
 * linkActivityAction):
 *   link_type            = 'manual'
 *   match_method         = 'manual_override'
 *   confirmation_status  = 'confirmed'
 *   confidence           = 1.00
 *   matched_by           = userId
 *   matched_at           = now()
 *   match_reason         = { source: 'bulk-link-activities' }
 *
 * Also updates completed_activities.schedule_status = 'scheduled' and
 * is_unplanned = false, so the activity shows as attached in the UI.
 *
 * Match rule:
 *   For each completed_activity with no existing link row, find planned
 *   sessions where (user_id, date, sport) matches. Sport is normalised from
 *   completed_activities.sport_type (e.g. 'swimming' → 'swim'). Date is the
 *   UTC date of start_time_utc.
 *
 * Outcomes:
 *   exactly 1 candidate → link
 *   0 candidates        → skip (no planned session that day for that sport)
 *   >1 candidates       → skip (ambiguous — needs manual assignment)
 *
 * Post-link side effects (execution review, debrief refresh, load sync) are
 * NOT triggered here. Run scripts/refresh-ai-content.ts afterwards to fill
 * those in for the full history.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Mode = "inspect" | "dry-run" | "apply";
type Sport = "swim" | "bike" | "run" | "strength" | "other";

type Args = {
  userId: string;
  mode: Mode;
  from: string | null;
  to: string | null;
};

type ActivityRow = {
  id: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number;
  distance_m: number | null;
  schedule_status: string | null;
};

type SessionRow = {
  id: string;
  date: string;
  sport: string;
  session_name: string | null;
  duration_minutes: number | null;
};

type LinkOutcome = "linked" | "skipped-no-candidate" | "skipped-ambiguous" | "skipped-already-linked";

type PerActivityReport = {
  activityId: string;
  date: string;
  sport: Sport;
  durationMin: number;
  outcome: LinkOutcome;
  chosenSessionId?: string;
  chosenSessionName?: string;
  candidateCount: number;
};

function die(message: string, code = 1): never {
  process.stderr.write(`bulk-link: ${message}\n`);
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
    from: map.get("from") ?? null,
    to: map.get("to") ?? null,
  };
}

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) die("missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  return createClient(url!, key!, { auth: { persistSession: false } });
}

function normalizeSport(raw: string | null | undefined): Sport {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("swim") || s === "pool_swim" || s === "open_water") return "swim";
  if (s.includes("bike") || s.includes("cycl") || s === "virtual_ride") return "bike";
  if (s.includes("run") || s === "trail_running" || s === "treadmill") return "run";
  if (s.includes("strength") || s.includes("weight") || s.includes("functional")) return "strength";
  return "other";
}

function utcDate(iso: string): string {
  // start_time_utc is ISO; take the UTC day portion.
  return iso.slice(0, 10);
}

async function loadUnlinkedActivities(
  db: SupabaseClient,
  userId: string,
  from: string | null,
  to: string | null,
): Promise<ActivityRow[]> {
  let query = db
    .from("completed_activities")
    .select("id, sport_type, start_time_utc, duration_sec, distance_m, schedule_status")
    .eq("user_id", userId)
    .order("start_time_utc", { ascending: true });

  if (from) query = query.gte("start_time_utc", `${from}T00:00:00Z`);
  if (to) query = query.lte("start_time_utc", `${to}T23:59:59Z`);

  const { data, error } = await query;
  if (error) die(`failed to load completed_activities: ${error.message}`);

  const activities = (data ?? []) as ActivityRow[];
  if (activities.length === 0) return [];

  const ids = activities.map((a) => a.id);
  const { data: links, error: linkErr } = await db
    .from("session_activity_links")
    .select("completed_activity_id")
    .eq("user_id", userId)
    .in("completed_activity_id", ids);
  if (linkErr) die(`failed to load session_activity_links: ${linkErr.message}`);

  const linkedIds = new Set((links ?? []).map((l: { completed_activity_id: string }) => l.completed_activity_id));
  return activities.filter((a) => !linkedIds.has(a.id));
}

async function findCandidateSessions(
  db: SupabaseClient,
  userId: string,
  date: string,
  sport: Sport,
): Promise<SessionRow[]> {
  const { data, error } = await db
    .from("sessions")
    .select("id, date, sport, session_name, duration_minutes")
    .eq("user_id", userId)
    .eq("date", date)
    .eq("sport", sport)
    .order("day_order", { ascending: true });
  if (error) die(`failed to load candidate sessions (${date} ${sport}): ${error.message}`);
  return (data ?? []) as SessionRow[];
}

async function linkActivity(
  db: SupabaseClient,
  userId: string,
  activityId: string,
  plannedSessionId: string,
): Promise<void> {
  const { error: insertErr } = await db.from("session_activity_links").insert({
    user_id: userId,
    planned_session_id: plannedSessionId,
    completed_activity_id: activityId,
    link_type: "manual",
    confidence: 1,
    match_reason: { source: "bulk-link-activities" },
    confirmation_status: "confirmed",
    matched_by: userId,
    matched_at: new Date().toISOString(),
    match_method: "manual_override",
  });
  if (insertErr) die(`link insert failed (activity=${activityId} session=${plannedSessionId}): ${insertErr.message}`);

  const { error: updErr } = await db
    .from("completed_activities")
    .update({ schedule_status: "scheduled", is_unplanned: false })
    .eq("id", activityId)
    .eq("user_id", userId);
  if (updErr) die(`schedule_status update failed (${activityId}): ${updErr.message}`);
}

async function run(args: Args): Promise<void> {
  const db = client();
  const { userId, mode, from, to } = args;

  const { data: profile } = await db.from("profiles").select("id, display_name").eq("id", userId).maybeSingle();
  if (!profile) die(`profile not found for user ${userId}`);

  const rangeLabel = from || to ? `${from ?? "−∞"} → ${to ?? "+∞"}` : "(all time)";
  console.log(`\nBulk-link activities for ${profile!.display_name ?? userId} in ${rangeLabel}`);
  console.log(`Mode: ${mode}\n`);

  const activities = await loadUnlinkedActivities(db, userId, from, to);
  console.log(`Unlinked completed_activities: ${activities.length}`);
  if (activities.length === 0) return;

  const reports: PerActivityReport[] = [];

  for (const activity of activities) {
    const date = utcDate(activity.start_time_utc);
    const sport = normalizeSport(activity.sport_type);
    const durationMin = Math.round(activity.duration_sec / 60);

    if (sport === "other") {
      reports.push({
        activityId: activity.id,
        date,
        sport,
        durationMin,
        outcome: "skipped-no-candidate",
        candidateCount: 0,
      });
      continue;
    }

    const candidates = await findCandidateSessions(db, userId, date, sport);

    if (candidates.length === 0) {
      reports.push({
        activityId: activity.id,
        date,
        sport,
        durationMin,
        outcome: "skipped-no-candidate",
        candidateCount: 0,
      });
      continue;
    }

    if (candidates.length > 1) {
      reports.push({
        activityId: activity.id,
        date,
        sport,
        durationMin,
        outcome: "skipped-ambiguous",
        candidateCount: candidates.length,
      });
      continue;
    }

    const chosen = candidates[0];
    if (mode === "apply") {
      await linkActivity(db, userId, activity.id, chosen.id);
    }
    reports.push({
      activityId: activity.id,
      date,
      sport,
      durationMin,
      outcome: "linked",
      chosenSessionId: chosen.id,
      chosenSessionName: chosen.session_name ?? undefined,
      candidateCount: 1,
    });
  }

  const linked = reports.filter((r) => r.outcome === "linked");
  const noCandidate = reports.filter((r) => r.outcome === "skipped-no-candidate");
  const ambiguous = reports.filter((r) => r.outcome === "skipped-ambiguous");

  console.log(`\nSummary:`);
  console.log(`  ${mode === "apply" ? "linked" : "would link"}:    ${linked.length}`);
  console.log(`  no planned session: ${noCandidate.length}`);
  console.log(`  ambiguous (>1):     ${ambiguous.length}`);

  if (mode === "inspect" || linked.length > 0) {
    console.log(`\n${mode === "apply" ? "Linked" : "Would link"}:`);
    for (const r of linked) {
      console.log(`  ${r.date}  ${r.sport.padEnd(8)} ${String(r.durationMin).padStart(3)}m → ${r.chosenSessionName ?? r.chosenSessionId}`);
    }
  }
  if (noCandidate.length > 0) {
    console.log(`\nNo planned session (activity kept as unscheduled):`);
    for (const r of noCandidate) {
      console.log(`  ${r.date}  ${r.sport.padEnd(8)} ${String(r.durationMin).padStart(3)}m`);
    }
  }
  if (ambiguous.length > 0) {
    console.log(`\nAmbiguous (>1 planned session, needs manual assignment):`);
    for (const r of ambiguous) {
      console.log(`  ${r.date}  ${r.sport.padEnd(8)} ${String(r.durationMin).padStart(3)}m  candidates=${r.candidateCount}`);
    }
  }

  if (mode !== "apply") {
    console.log(`\n(dry-run — no writes. Re-run with --apply to link.)`);
  } else {
    console.log(`\nRun scripts/refresh-ai-content.ts next to backfill session reviews + weekly debriefs.`);
  }
}

run(parseArgs(process.argv)).catch((err) => die(err instanceof Error ? err.message : String(err)));
