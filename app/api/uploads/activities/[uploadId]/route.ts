import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: { uploadId: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
