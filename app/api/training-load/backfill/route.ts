import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncSessionLoad } from "@/lib/training/load-sync";
import { rebuildFitnessHistory } from "@/lib/training/fitness-model";

/**
 * POST /api/training-load/backfill
 *
 * Backfills session_load, daily_load, and athlete_fitness for all
 * completed activities belonging to the authenticated user.
 *
 * This is an idempotent operation — safe to re-run.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = user.id;

  // Fetch all completed activities for this user
  const { data: activities, error } = await supabase
    .from("completed_activities")
    .select("id, schedule_status")
    .eq("user_id", userId)
    .order("start_time_utc", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!activities?.length) {
    return NextResponse.json({ message: "No activities to backfill", count: 0 });
  }

  // Fetch session links for these activities
  const activityIds = activities.map((a: { id: string }) => a.id);
  const { data: links, error: linksError } = await supabase
    .from("session_activity_links")
    .select("completed_activity_id, planned_session_id")
    .in("completed_activity_id", activityIds);

  if (linksError) {
    return NextResponse.json({ error: linksError.message }, { status: 500 });
  }

  const linkMap = new Map<string, string>();
  for (const link of links ?? []) {
    if (link.completed_activity_id && link.planned_session_id) {
      linkMap.set(link.completed_activity_id, link.planned_session_id);
    }
  }

  // Fetch intent_category for linked sessions
  const sessionIds = Array.from(new Set(linkMap.values()));

  const sessionIntents: Record<string, string | null> = {};
  if (sessionIds.length > 0) {
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, intent_category")
      .in("id", sessionIds);

    for (const s of sessions ?? []) {
      sessionIntents[s.id] = s.intent_category;
    }

    const missingSessionIds = sessionIds.filter((id) => !(id in sessionIntents));
    if (missingSessionIds.length > 0) {
      const { data: legacySessions } = await supabase
        .from("planned_sessions")
        .select("id, intent_category")
        .in("id", missingSessionIds);

      for (const s of legacySessions ?? []) {
        sessionIntents[s.id] = s.intent_category;
      }
    }
  }

  // Sync each activity's load
  let synced = 0;
  let errors = 0;

  for (const activity of activities) {
    try {
      const linkedSessionId = linkMap.get(activity.id) ?? null;
      const intentCategory = linkedSessionId ? (sessionIntents[linkedSessionId] ?? null) : null;

      await syncSessionLoad(supabase, userId, activity.id, linkedSessionId, intentCategory);
      synced++;
    } catch {
      errors++;
    }
  }

  // Rebuild fitness history from scratch (full recalc)
  try {
    await rebuildFitnessHistory(supabase, userId);
  } catch (e) {
    return NextResponse.json(
      {
        message: "Partial backfill — load synced but fitness rebuild failed",
        synced,
        errors,
        fitnessError: e instanceof Error ? e.message : "Unknown error"
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: "Backfill complete",
    synced,
    errors,
    total: activities.length
  });
}
