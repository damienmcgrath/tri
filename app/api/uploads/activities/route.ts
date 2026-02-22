import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pickAutoMatch, scoreCandidate } from "@/lib/workouts/activity-matching";
import { parseFitFile, parseTcxFile, sha256Hex } from "@/lib/workouts/activity-parser";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const acceptedExtensions = [".fit", ".tcx"];

function ext(name: string) {
  return name.slice(name.lastIndexOf(".")).toLowerCase();
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("activity_uploads")
    .select("id,filename,file_type,file_size,status,error_message,created_at,completed_activities(id,sport_type,duration_sec,distance_m),session_activity_links(planned_session_id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(15);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ uploads: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const extension = ext(file.name);
  if (!acceptedExtensions.includes(extension)) {
    return NextResponse.json({ error: "Unsupported file type. Please upload .fit or .tcx" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File is too large. Max size is 20MB." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = sha256Hex(bytes);

  const { data: duplicate } = await supabase
    .from("activity_uploads")
    .select("id,status")
    .eq("user_id", user.id)
    .eq("sha256", hash)
    .maybeSingle();

  if (duplicate) {
    return NextResponse.json({ duplicate: true, uploadId: duplicate.id, status: duplicate.status });
  }

  const base64 = bytes.toString("base64");

  const { data: upload, error: uploadError } = await supabase
    .from("activity_uploads")
    .insert({ user_id: user.id, filename: file.name, file_type: extension.slice(1), file_size: file.size, sha256: hash, raw_file_base64: base64, storage_key: null, status: "uploaded" })
    .select("id")
    .single();

  if (uploadError || !upload) return NextResponse.json({ error: uploadError?.message ?? "Could not store upload" }, { status: 400 });

  try {
    const parsed = extension === ".fit" ? await parseFitFile(bytes) : parseTcxFile(bytes.toString("utf8"));

    const { data: createdActivity, error: activityError } = await supabase
      .from("completed_activities")
      .insert({
        user_id: user.id,
        upload_id: upload.id,
        sport_type: parsed.sportType,
        start_time_utc: parsed.startTimeUtc,
        end_time_utc: parsed.endTimeUtc,
        duration_sec: parsed.durationSec,
        distance_m: parsed.distanceM,
        avg_hr: parsed.avgHr,
        avg_power: parsed.avgPower,
        calories: parsed.calories,
        parse_summary: parsed.parseSummary,
        source: "upload"
      })
      .select("id,start_time_utc,sport_type,duration_sec,distance_m")
      .single();

    if (activityError || !createdActivity) throw new Error(activityError?.message ?? "Could not save parsed activity");

    await supabase.from("activity_uploads").update({ status: "parsed" }).eq("id", upload.id).eq("user_id", user.id);

    const start = new Date(createdActivity.start_time_utc);
    const windowStart = new Date(start.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(start.getTime() + 6 * 60 * 60 * 1000).toISOString();

    const { data: candidates } = await supabase
      .from("planned_sessions")
      .select("id,sport,date,duration")
      .eq("user_id", user.id)
      .gte("date", windowStart.slice(0, 10))
      .lte("date", windowEnd.slice(0, 10));

    const scored = (candidates ?? []).map((candidate) =>
      scoreCandidate(
        {
          sportType: createdActivity.sport_type,
          startTimeUtc: createdActivity.start_time_utc,
          durationSec: createdActivity.duration_sec,
          distanceM: Number(createdActivity.distance_m ?? 0)
        },
        {
          id: candidate.id,
          sport: candidate.sport,
          startTimeUtc: `${candidate.date}T06:00:00.000Z`,
          targetDurationSec: candidate.duration ? candidate.duration * 60 : null,
          targetDistanceM: null
        }
      )
    );

    const best = pickAutoMatch(scored);
    if (best) {
      await supabase.from("session_activity_links").insert({
        user_id: user.id,
        planned_session_id: best.candidateId,
        completed_activity_id: createdActivity.id,
        link_type: "auto",
        confidence: Number(best.confidence.toFixed(2)),
        match_reason: best.reason
      });
      await supabase.from("activity_uploads").update({ status: "matched" }).eq("id", upload.id).eq("user_id", user.id);
    }

    return NextResponse.json({ uploadId: upload.id, completedActivityId: createdActivity.id, matched: Boolean(best) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse file";
    await supabase.from("activity_uploads").update({ status: "error", error_message: message }).eq("id", upload.id).eq("user_id", user.id);
    return NextResponse.json({ error: message, uploadId: upload.id }, { status: 400 });
  }
}
