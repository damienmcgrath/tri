"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function linkActivityAction(activityId: string, plannedSessionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: session } = await supabase.from("sessions").select("id").eq("id", plannedSessionId).eq("user_id", user.id).maybeSingle();
  if (!session) return { error: "Session not found" };

  await supabase.from("session_activity_links").delete().eq("user_id", user.id).eq("completed_activity_id", activityId);

  const { error } = await supabase.from("session_activity_links").insert({
    user_id: user.id,
    planned_session_id: plannedSessionId,
    completed_activity_id: activityId,
    link_type: "manual",
    confidence: 1,
    match_reason: { source: "activity_details" }
  });

  if (error) return { error: error.message };

  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function unlinkActivityAction(activityId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase.from("session_activity_links").delete().eq("user_id", user.id).eq("completed_activity_id", activityId);
  if (error) return { error: error.message };

  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function markUnplannedAction(activityId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  await supabase.from("session_activity_links").delete().eq("user_id", user.id).eq("completed_activity_id", activityId);
  const { error } = await supabase.from("completed_activities").update({ is_unplanned: true }).eq("id", activityId).eq("user_id", user.id);
  if (error) return { error: error.message };

  revalidatePath(`/activities/${activityId}`);
  revalidatePath("/dashboard");
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
