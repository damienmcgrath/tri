import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/security/request";
import { syncSessionLoad } from "@/lib/training/load-sync";
import { syncSessionExecutionFromActivityLink } from "@/lib/workouts/session-execution";

const schema = z.object({
  plannedSessionId: z.string().uuid(),
  actor: z.enum(["coach", "athlete"]).default("athlete"),
  mode: z.enum(["confirm", "override"]).default("override")
});

export async function POST(request: Request, { params }: { params: { uploadId: string } }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = schema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { data: activity } = await supabase
    .from("completed_activities")
    .select("id")
    .eq("upload_id", params.uploadId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  let session: { id: string; intent_category: string | null } | null = null;

  const { data: sessionData } = await supabase
    .from("sessions")
    .select("id,intent_category")
    .eq("id", body.data.plannedSessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sessionData) {
    session = sessionData;
  } else {
    const { data: legacySession } = await supabase
      .from("planned_sessions")
      .select("id,intent_category")
      .eq("id", body.data.plannedSessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (legacySession) session = legacySession;
  }

  if (!session) return NextResponse.json({ error: "Planned session not found" }, { status: 404 });

  await supabase.from("session_activity_links").delete().eq("completed_activity_id", activity.id).eq("user_id", user.id);

  const { error } = await supabase.from("session_activity_links").insert({
    user_id: user.id,
    planned_session_id: body.data.plannedSessionId,
    completed_activity_id: activity.id,
    link_type: "manual",
    confidence: 1,
    match_reason: { source: "manual_attach" },
    confirmation_status: "confirmed",
    matched_by: user.id,
    matched_at: new Date().toISOString(),
    match_method: body.data.mode === "confirm"
      ? body.data.actor === "coach"
        ? "coach_confirmed"
        : "athlete_confirmed"
      : "manual_override"
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase
    .from("completed_activities")
    .update({ schedule_status: "scheduled", is_unplanned: false })
    .eq("id", activity.id)
    .eq("user_id", user.id);

  await supabase.from("activity_uploads").update({ status: "matched", error_message: null }).eq("id", params.uploadId).eq("user_id", user.id);
  await syncSessionExecutionFromActivityLink({
    supabase,
    userId: user.id,
    sessionId: body.data.plannedSessionId,
    activityId: activity.id
  });
  try {
    await syncSessionLoad(supabase, user.id, activity.id, body.data.plannedSessionId, session.intent_category);
  } catch (syncError) {
    console.error("[training-load] Failed to sync linked activity load:", syncError);
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath(`/sessions/${body.data.plannedSessionId}`);

  return NextResponse.json({ ok: true });
}
