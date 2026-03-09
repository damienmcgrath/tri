import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/security/request";

export async function GET(_: Request, { params }: { params: { uploadId: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("activity_uploads")
    .select("id,filename,file_type,file_size,status,error_message,created_at,completed_activities(*,session_activity_links(*,sessions(id,date,sport,type,duration_minutes)))")
    .eq("user_id", user.id)
    .eq("id", params.uploadId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ upload: data });
}

export async function DELETE(request: Request, { params }: { params: { uploadId: string } }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: upload } = await supabase
    .from("activity_uploads")
    .select("id")
    .eq("id", params.uploadId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }

  const { error: activityDeleteError } = await supabase
    .from("completed_activities")
    .delete()
    .eq("upload_id", params.uploadId)
    .eq("user_id", user.id);

  if (activityDeleteError) {
    return NextResponse.json({ error: activityDeleteError.message }, { status: 400 });
  }

  const { data: deletedUpload, error: uploadDeleteError } = await supabase
    .from("activity_uploads")
    .delete()
    .eq("id", params.uploadId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (uploadDeleteError) {
    return NextResponse.json({ error: uploadDeleteError.message }, { status: 400 });
  }

  if (!deletedUpload) {
    return NextResponse.json({ error: "Delete blocked by permissions. Apply latest DB migrations." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
