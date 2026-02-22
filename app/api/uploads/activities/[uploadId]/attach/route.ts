import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ plannedSessionId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: { uploadId: string } }) {
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

  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", body.data.plannedSessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!session) return NextResponse.json({ error: "Planned session not found" }, { status: 404 });

  await supabase.from("session_activity_links").delete().eq("completed_activity_id", activity.id).eq("user_id", user.id);

  const { error } = await supabase.from("session_activity_links").insert({
    user_id: user.id,
    planned_session_id: body.data.plannedSessionId,
    completed_activity_id: activity.id,
    link_type: "manual",
    confidence: 1,
    match_reason: { source: "manual_attach" }
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("activity_uploads").update({ status: "matched", error_message: null }).eq("id", params.uploadId).eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
