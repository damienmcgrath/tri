"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { syncSessionLoad } from "@/lib/training/load-sync";
import { syncSessionExecutionAfterUnlink, syncSessionExecutionFromActivityLink } from "@/lib/workouts/session-execution";
import { postSessionSyncSideEffects } from "@/lib/workouts/post-sync-effects";
import { updateUploadStatusForActivity } from "@/lib/workouts/upload-status";

export async function linkActivityAction(activityId: string, plannedSessionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: session } = await supabase.from("sessions").select("id,intent_category,date").eq("id", plannedSessionId).eq("user_id", user.id).maybeSingle();
  if (!session) return { error: "Session not found" };

  await supabase.from("session_activity_links").delete().eq("user_id", user.id).eq("completed_activity_id", activityId);

  const { error } = await supabase.from("session_activity_links").insert({
    user_id: user.id,
    planned_session_id: plannedSessionId,
    completed_activity_id: activityId,
    link_type: "manual",
    confidence: 1,
    match_reason: { source: "activity_details" },
    confirmation_status: "confirmed",
    matched_by: user.id,
    matched_at: new Date().toISOString(),
    match_method: "manual_override"
  });

  if (error) return { error: error.message };

  await supabase.from("completed_activities").update({ schedule_status: "scheduled", is_unplanned: false }).eq("id", activityId).eq("user_id", user.id);
  await updateUploadStatusForActivity({ supabase, userId: user.id, activityId, status: "matched" });
  await syncSessionExecutionFromActivityLink({
    supabase,
    userId: user.id,
    sessionId: plannedSessionId,
    activityId
  });
  try {
    await syncSessionLoad(supabase, user.id, activityId, plannedSessionId, session.intent_category ?? null);
  } catch (syncError) {
    console.error("[training-load] Failed to sync linked activity load:", syncError);
  }

  // Fire-and-forget: verdict generation, debrief refresh, comparison, adaptation rationale
  postSessionSyncSideEffects({
    supabase,
    userId: user.id,
    sessionId: plannedSessionId,
    activityId,
    sessionDate: session.date ?? null,
  }).catch((e) => console.error("[post-sync] Side effects failed:", e));

  revalidatePath(`/activities/${activityId}`);
  revalidatePath(`/sessions/${plannedSessionId}`);
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/debrief");
  return { ok: true };
}

export async function unlinkActivityAction(activityId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: existingLinks } = await supabase
    .from("session_activity_links")
    .select("planned_session_id,confirmation_status")
    .eq("user_id", user.id)
    .eq("completed_activity_id", activityId)
    .limit(5);

  const affectedSessionIds = (existingLinks ?? [])
    .filter((link: any) => link.planned_session_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null))
    .map((link: any) => link.planned_session_id as string);

  const { error } = await supabase.from("session_activity_links").delete().eq("user_id", user.id).eq("completed_activity_id", activityId);
  if (error) return { error: error.message };

  await supabase.from("completed_activities").update({ schedule_status: "unscheduled" }).eq("id", activityId).eq("user_id", user.id);
  await updateUploadStatusForActivity({ supabase, userId: user.id, activityId, status: "parsed" });
  for (const sessionId of affectedSessionIds) {
    await syncSessionExecutionAfterUnlink({
      supabase,
      userId: user.id,
      sessionId
    });
    revalidatePath(`/sessions/${sessionId}`);
  }
  try {
    await syncSessionLoad(supabase, user.id, activityId, null, null);
  } catch (syncError) {
    console.error("[training-load] Failed to resync unlinked activity load:", syncError);
  }

  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function markUnplannedAction(activityId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: existingLinks } = await supabase
    .from("session_activity_links")
    .select("planned_session_id,confirmation_status")
    .eq("user_id", user.id)
    .eq("completed_activity_id", activityId)
    .limit(5);

  const affectedSessionIds = (existingLinks ?? [])
    .filter((link: any) => link.planned_session_id && (link.confirmation_status === "confirmed" || link.confirmation_status === null))
    .map((link: any) => link.planned_session_id as string);

  // Mark links as rejected instead of deleting — preserves audit trail and
  // provides a fallback signal for classifyActivityStatus (mirrors the
  // persistExtraActivityMarker logic in calendar/actions.ts).
  if (existingLinks && existingLinks.length > 0) {
    await supabase
      .from("session_activity_links")
      .update({
        confirmation_status: "rejected",
        matched_by: user.id,
        matched_at: new Date().toISOString(),
        match_method: "unmatched"
      })
      .eq("user_id", user.id)
      .eq("completed_activity_id", activityId);
  }

  const { error } = await supabase.from("completed_activities").update({ is_unplanned: true, schedule_status: "unscheduled" }).eq("id", activityId).eq("user_id", user.id);
  if (error) return { error: error.message };
  await updateUploadStatusForActivity({ supabase, userId: user.id, activityId, status: "matched" });

  for (const sessionId of affectedSessionIds) {
    await syncSessionExecutionAfterUnlink({
      supabase,
      userId: user.id,
      sessionId
    });
    revalidatePath(`/sessions/${sessionId}`);
  }
  try {
    await syncSessionLoad(supabase, user.id, activityId, null, null);
  } catch (syncError) {
    console.error("[training-load] Failed to resync unplanned activity load:", syncError);
  }

  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidatePath("/debrief");
  return { ok: true };
}

export async function updateActivityNotesAction(activityId: string, notes: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("completed_activities")
    .update({ notes: notes.trim() ? notes.trim() : null })
    .eq("id", activityId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath(`/activities/${activityId}`);
  return { ok: true };
}

export async function toggleRaceAction(activityId: string, isRace: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase.from("completed_activities").update({ is_race: isRace }).eq("id", activityId).eq("user_id", user.id);
  if (error) return { error: error.message };

  revalidatePath(`/activities/${activityId}`);
  return { ok: true };
}
