import type { SupabaseClient } from "@supabase/supabase-js";

export async function updateUploadStatusForActivity(params: {
  supabase: SupabaseClient;
  userId: string;
  activityId: string;
  status: "uploaded" | "parsed" | "matched" | "error";
}) {
  const { supabase, userId, activityId, status } = params;
  const { data: activity, error: loadError } = await supabase
    .from("completed_activities")
    .select("upload_id")
    .eq("id", activityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (loadError || !activity?.upload_id) {
    return;
  }

  await supabase
    .from("activity_uploads")
    .update({ status, error_message: null })
    .eq("id", activity.upload_id)
    .eq("user_id", userId);
}
