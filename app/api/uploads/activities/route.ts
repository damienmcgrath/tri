import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseFitFile, parseTcxFile, sha256Hex } from "@/lib/workouts/activity-parser";
import { pickBestSuggestion, suggestSessionMatches } from "@/lib/workouts/matching-service";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const acceptedExtensions = [".fit", ".tcx"];

function isMissingScheduleStatus(errorMessage: string) {
  return errorMessage.includes("schedule_status") && errorMessage.includes("schema cache");
}

function ext(name: string) {
  return name.slice(name.lastIndexOf(".")).toLowerCase();
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const baseSelect = "id,filename,file_type,file_size,status,error_message,created_at,completed_activities(id,sport_type,duration_sec,distance_m),session_activity_links(planned_session_id)";
  const scheduleSelect = "id,filename,file_type,file_size,status,error_message,created_at,completed_activities(id,sport_type,duration_sec,distance_m,schedule_status),session_activity_links(planned_session_id)";

  const { data: withStatus, error: withStatusError } = await supabase
    .from("activity_uploads")
    .select(scheduleSelect)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(15);

  if (!withStatusError) return NextResponse.json({ uploads: withStatus ?? [] });

  if (!isMissingScheduleStatus(withStatusError.message)) {
    return NextResponse.json({ error: withStatusError.message }, { status: 400 });
  }

  const { data: legacyData, error: legacyError } = await supabase
    .from("activity_uploads")
    .select(baseSelect)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(15);

  if (legacyError) return NextResponse.json({ error: legacyError.message }, { status: 400 });

  const uploads = (legacyData ?? []).map((upload) => ({
    ...upload,
    completed_activities: (upload.completed_activities ?? []).map((activity) => ({
      ...activity,
      schedule_status: "unscheduled" as const
    }))
  }));

  return NextResponse.json({ uploads });
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
      .from("sessions")
      .select("id,sport,date,duration_minutes")
      .eq("user_id", user.id)
      .gte("date", windowStart.slice(0, 10))
      .lte("date", windowEnd.slice(0, 10));

    const suggestions = suggestSessionMatches(
      {
        id: createdActivity.id,
        userId: user.id,
        sportType: createdActivity.sport_type,
        startTimeUtc: createdActivity.start_time_utc,
        durationSec: createdActivity.duration_sec,
        distanceM: Number(createdActivity.distance_m ?? 0)
      },
      (candidates ?? []).map((candidate) => ({
        id: candidate.id,
        userId: user.id,
        date: candidate.date,
        sport: candidate.sport,
        type: candidate.sport,
        durationMinutes: candidate.duration_minutes,
        distanceM: null
      }))
    );

    const best = pickBestSuggestion(suggestions);
    let suggested = false;
    if (best) {
      const { error: linkError } = await supabase.from("session_activity_links").insert({
        user_id: user.id,
        planned_session_id: best.plannedSessionId,
        completed_activity_id: createdActivity.id,
        link_type: "auto",
        confidence: best.confidence,
        match_reason: best.reason,
        confirmation_status: "suggested",
        match_method: best.matchMethod
      });

      if (!linkError) {
        suggested = true;
      }
    }

    return NextResponse.json({ uploadId: upload.id, completedActivityId: createdActivity.id, suggested });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse file";
    await supabase.from("activity_uploads").update({ status: "error", error_message: message }).eq("id", upload.id).eq("user_id", user.id);
    return NextResponse.json({ error: message, uploadId: upload.id }, { status: 400 });
  }
}
