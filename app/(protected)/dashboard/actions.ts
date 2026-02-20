"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseTcxToSessions } from "@/lib/workouts/tcx";

export type IngestResult = {
  status: "idle" | "success" | "failed";
  message: string;
};

const moveSessionSchema = z.object({
  sessionId: z.string().uuid(),
  newDate: z.string().date()
});

const swapSessionSchema = z.object({
  sourceSessionId: z.string().uuid(),
  targetSessionId: z.string().uuid()
});

const markSkippedSchema = z.object({
  sessionId: z.string().uuid()
});

async function getAuthedClient() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in.");
  }

  return { supabase, user };
}

export async function moveSessionAction(formData: FormData) {
  const parsed = moveSessionSchema.parse({
    sessionId: formData.get("sessionId"),
    newDate: formData.get("newDate")
  });

  const { supabase, user } = await getAuthedClient();

  const { error } = await supabase
    .from("planned_sessions")
    .update({ date: parsed.newDate })
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message ?? "Could not move session.");
  }

  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

export async function swapSessionDayAction(formData: FormData) {
  const parsed = swapSessionSchema.safeParse({
    sourceSessionId: formData.get("sourceSessionId"),
    targetSessionId: formData.get("targetSessionId")
  });

  if (!parsed.success) {
    return;
  }

  if (parsed.data.sourceSessionId === parsed.data.targetSessionId) {
    return;
  }

  const { supabase, user } = await getAuthedClient();

  const { data: pair, error: pairError } = await supabase
    .from("planned_sessions")
    .select("id,date")
    .in("id", [parsed.data.sourceSessionId, parsed.data.targetSessionId])
    .eq("user_id", user.id);

  if (pairError) {
    throw new Error(pairError.message ?? "Could not load sessions for swap.");
  }

  if (!pair || pair.length !== 2) {
    throw new Error("Could not find both sessions for swap.");
  }

  const source = pair.find((session) => session.id === parsed.data.sourceSessionId);
  const target = pair.find((session) => session.id === parsed.data.targetSessionId);

  if (!source || !target) {
    throw new Error("Could not identify selected sessions.");
  }

  const { error: sourceUpdateError } = await supabase
    .from("planned_sessions")
    .update({ date: target.date })
    .eq("id", source.id)
    .eq("user_id", user.id);

  if (sourceUpdateError) {
    throw new Error(sourceUpdateError.message ?? "Could not swap sessions.");
  }

  const { error: targetUpdateError } = await supabase
    .from("planned_sessions")
    .update({ date: source.date })
    .eq("id", target.id)
    .eq("user_id", user.id);

  if (targetUpdateError) {
    throw new Error(targetUpdateError.message ?? "Could not swap sessions.");
  }

  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

export async function markSkippedAction(formData: FormData) {
  const parsed = markSkippedSchema.parse({
    sessionId: formData.get("sessionId")
  });

  const { supabase, user } = await getAuthedClient();

  const { data: session, error: sessionError } = await supabase
    .from("planned_sessions")
    .select("notes")
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sessionError) {
    throw new Error(sessionError.message ?? "Could not update session.");
  }

  if (!session) {
    throw new Error("Session not found.");
  }

  const skipTag = `[Skipped ${new Date().toISOString().slice(0, 10)}]`;
  const currentNotes = session.notes ?? "";
  const hasSkipTag = /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(currentNotes);
  const nextNotes = hasSkipTag ? currentNotes : `${currentNotes}\n${skipTag}`.trim();

  const { error } = await supabase
    .from("planned_sessions")
    .update({ notes: nextNotes })
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message ?? "Could not mark session as skipped.");
  }

  revalidatePath("/dashboard");
  revalidatePath("/calendar");
}

export async function ingestTcxAction(_: IngestResult, formData: FormData): Promise<IngestResult> {
  const file = formData.get("tcxFile");

  if (!(file instanceof File)) {
    return {
      status: "failed",
      message: "Please attach a TCX file."
    };
  }

  if (!file.name.toLowerCase().endsWith(".tcx")) {
    return {
      status: "failed",
      message: "Only .tcx files are supported in this MVP importer."
    };
  }

  const content = await file.text();

  let sessions = [];

  try {
    sessions = parseTcxToSessions(content);
  } catch {
    return {
      status: "failed",
      message: "Could not parse this TCX file."
    };
  }

  if (sessions.length === 0) {
    return {
      status: "failed",
      message: "No activities were found in this TCX file."
    };
  }

  const fileHash = createHash("sha256").update(content).digest("hex");

  const { supabase, user } = await getAuthedClient();

  const { error: upsertError } = await supabase.from("completed_sessions").upsert(
    sessions.map((session) => ({
      user_id: user.id,
      garmin_id: session.garminId,
      date: session.date,
      sport: session.sport,
      metrics: session.metrics,
      source: "tcx_import",
      source_file_name: file.name,
      source_hash: fileHash
    })),
    {
      onConflict: "user_id,garmin_id"
    }
  );

  const status = upsertError ? "failed" : "success";

  const { error: eventError } = await supabase.from("ingestion_events").insert({
    user_id: user.id,
    source: "tcx_import",
    file_name: file.name,
    source_hash: fileHash,
    status,
    imported_count: upsertError ? 0 : sessions.length,
    failed_count: upsertError ? sessions.length : 0,
    error_message: upsertError?.message,
    raw_payload: { sample: sessions.slice(0, 2), total: sessions.length }
  });

  if (upsertError || eventError) {
    return {
      status: "failed",
      message: upsertError?.message ?? eventError?.message ?? "Import failed."
    };
  }

  revalidatePath("/dashboard");

  return {
    status: "success",
    message: `Imported ${sessions.length} workout${sessions.length > 1 ? "s" : ""} from ${file.name}.`
  };
}

