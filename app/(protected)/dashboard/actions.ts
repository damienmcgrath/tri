"use server";

import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseTcxToSessions } from "@/lib/workouts/tcx";

export type IngestResult = {
  status: "idle" | "success" | "failed";
  message: string;
};

const initialResult: IngestResult = {
  status: "idle",
  message: ""
};

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

export { initialResult };
