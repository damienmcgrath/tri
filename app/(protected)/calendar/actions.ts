"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { appendConfirmedSkipTag, appendSkipTag, clearSkipTag, syncSkipTagForStatus } from "@/lib/plans/skip-notes";

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

const markActivityExtraSchema = z.object({
  activityId: z.string().uuid()
});

const confirmSkippedSchema = z.object({
  sessionId: z.string().uuid()
});

const updateSessionSchema = z.object({
  sessionId: z.string().uuid(),
  type: z.string().trim().max(120),
  duration: z.coerce.number().int().min(1).max(480),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(["planned", "completed", "skipped"])
});

const quickAddSchema = z.object({
  date: z.string().date(),
  sport: z.enum(["swim", "bike", "run", "strength", "other"]),
  type: z.string().trim().max(120).optional(),
  duration: z.coerce.number().int().min(1).max(480),
  notes: z.string().trim().max(1000).optional()
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

function isMissingCompletedActivityColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42703" || /(is_unplanned|schedule_status|schema cache|column .* does not exist|42703)/i.test(error.message ?? "");
}

async function updateCompletedActivityExtraState(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  activityId: string;
}) {
  const { supabase, userId, activityId } = params;
  const fullUpdate = await supabase
    .from("completed_activities")
    .update({ is_unplanned: true, schedule_status: "unscheduled" })
    .eq("id", activityId)
    .eq("user_id", userId);

  if (!fullUpdate.error) {
    return;
  }

  if (!isMissingCompletedActivityColumnError(fullUpdate.error)) {
    throw new Error(fullUpdate.error.message ?? "Could not mark activity as extra.");
  }

  let appliedAnyFallback = false;

  for (const payload of [{ is_unplanned: true }, { schedule_status: "unscheduled" as const }]) {
    const fallbackUpdate = await supabase
      .from("completed_activities")
      .update(payload)
      .eq("id", activityId)
      .eq("user_id", userId);

    if (!fallbackUpdate.error) {
      appliedAnyFallback = true;
      continue;
    }

    if (!isMissingCompletedActivityColumnError(fallbackUpdate.error)) {
      throw new Error(fallbackUpdate.error.message ?? "Could not mark activity as extra.");
    }
  }

  if (!appliedAnyFallback) {
    throw new Error(fullUpdate.error.message ?? "Could not mark activity as extra.");
  }
}

async function persistExtraActivityMarker(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  activityId: string;
}) {
  const { supabase, userId, activityId } = params;

  const { data: existingLinks, error: loadLinksError } = await supabase
    .from("session_activity_links")
    .select("id")
    .eq("user_id", userId)
    .eq("completed_activity_id", activityId);

  if (loadLinksError) {
    throw new Error(loadLinksError.message ?? "Could not load existing activity links.");
  }

  if (!existingLinks || existingLinks.length === 0) {
    return;
  }

  const { error: updateError } = await supabase
    .from("session_activity_links")
    .update({
      confirmation_status: "rejected",
      matched_by: userId,
      matched_at: new Date().toISOString(),
      match_method: "unmatched"
    })
    .eq("user_id", userId)
    .eq("completed_activity_id", activityId);

  if (updateError) {
    throw new Error(updateError.message ?? "Could not persist extra workout state.");
  }
}

async function updateUploadStatusForActivity(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
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

export async function moveSessionAction(input: { sessionId: string; newDate: string }) {
  const parsed = moveSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  const { data: session, error: sessionError } = await supabase
    .from("planned_sessions")
    .select("date,notes")
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sessionError) {
    throw new Error(sessionError.message ?? "Could not load session before moving.");
  }

  if (!session) {
    throw new Error("Session not found.");
  }

  if (session.date === parsed.newDate) {
    return;
  }

  const withoutExistingMoveTag = (session.notes ?? "").replace(/\n?\[moved\sfrom\s\d{4}-\d{2}-\d{2}\]/gi, "").trim();
  const nextNotes = `${withoutExistingMoveTag}\n[Moved from ${session.date}]`.trim();

  const { error } = await supabase
    .from("planned_sessions")
    .update({ date: parsed.newDate, notes: nextNotes })
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message ?? "Could not move session.");
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function swapSessionDayAction(input: { sourceSessionId: string; targetSessionId: string }) {
  const parsed = swapSessionSchema.parse(input);

  if (parsed.sourceSessionId === parsed.targetSessionId) {
    return;
  }

  const { supabase, user } = await getAuthedClient();
  const { data: pair, error: pairError } = await supabase
    .from("planned_sessions")
    .select("id,date")
    .in("id", [parsed.sourceSessionId, parsed.targetSessionId])
    .eq("user_id", user.id);

  if (pairError) {
    throw new Error(pairError.message ?? "Could not load sessions for swap.");
  }

  if (!pair || pair.length !== 2) {
    throw new Error("Could not find both sessions for swap.");
  }

  const source = pair.find((session: any) => session.id === parsed.sourceSessionId);
  const target = pair.find((session: any) => session.id === parsed.targetSessionId);

  if (!source || !target) {
    throw new Error("Could not identify selected sessions.");
  }

  const { error: sourceError } = await supabase
    .from("planned_sessions")
    .update({ date: target.date })
    .eq("id", source.id)
    .eq("user_id", user.id);

  if (sourceError) {
    throw new Error(sourceError.message ?? "Could not swap sessions.");
  }

  const { error: targetError } = await supabase
    .from("planned_sessions")
    .update({ date: source.date })
    .eq("id", target.id)
    .eq("user_id", user.id);

  if (targetError) {
    throw new Error(targetError.message ?? "Could not swap sessions.");
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function markSkippedAction(input: { sessionId: string }) {
  const parsed = markSkippedSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("notes")
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sessionError) {
    if (!session) {
      throw new Error("Session not found.");
    }

    const nextNotes = appendSkipTag(session.notes, new Date());

    const { error } = await supabase
      .from("sessions")
      .update({ notes: nextNotes, status: "skipped" })
      .eq("id", parsed.sessionId)
      .eq("user_id", user.id);

    if (error) {
      throw new Error(error.message ?? "Could not mark session as skipped.");
    }

    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return;
  }

  if (sessionError.code !== "PGRST205") {
    throw new Error(sessionError.message ?? "Could not update session.");
  }

  const { data: legacySession, error: legacySessionError } = await supabase
    .from("planned_sessions")
    .select("notes")
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (legacySessionError) {
    throw new Error(legacySessionError.message ?? "Could not update session.");
  }

  if (!legacySession) {
    throw new Error("Session not found.");
  }

  const nextNotes = appendSkipTag(legacySession.notes, new Date());

  const { error } = await supabase
    .from("planned_sessions")
    .update({ notes: nextNotes })
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message ?? "Could not mark session as skipped.");
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}


export async function clearSkippedAction(input: { sessionId: string }) {
  const parsed = markSkippedSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("notes")
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sessionError) {
    if (!session) {
      throw new Error("Session not found.");
    }

    const nextNotes = clearSkipTag(session.notes);

    const { error } = await supabase
      .from("sessions")
      .update({ notes: nextNotes, status: "planned" })
      .eq("id", parsed.sessionId)
      .eq("user_id", user.id);

    if (error) {
      throw new Error(error.message ?? "Could not clear skipped status.");
    }

    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return;
  }

  if (sessionError.code !== "PGRST205") {
    throw new Error(sessionError.message ?? "Could not update session.");
  }

  const { data: legacySession, error: legacySessionError } = await supabase
    .from("planned_sessions")
    .select("notes")
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (legacySessionError) {
    throw new Error(legacySessionError.message ?? "Could not update session.");
  }

  if (!legacySession) {
    throw new Error("Session not found.");
  }

  const nextNotes = clearSkipTag(legacySession.notes);

  const { error } = await supabase
    .from("planned_sessions")
    .update({ notes: nextNotes })
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message ?? "Could not clear skipped status.");
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function confirmSkippedAction(input: { sessionId: string }) {
  const parsed = confirmSkippedSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("notes,status")
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sessionError) {
    if (!session) {
      throw new Error("Session not found.");
    }

    const nextNotes = appendConfirmedSkipTag(session.notes, new Date());

    const { error } = await supabase
      .from("sessions")
      .update({ notes: nextNotes, status: session.status ?? "skipped" })
      .eq("id", parsed.sessionId)
      .eq("user_id", user.id);

    if (error) {
      throw new Error(error.message ?? "Could not confirm skipped session.");
    }

    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return;
  }

  if (sessionError.code !== "PGRST205") {
    throw new Error(sessionError.message ?? "Could not confirm skipped session.");
  }

  const { data: legacySession, error: legacySessionError } = await supabase
    .from("planned_sessions")
    .select("notes")
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (legacySessionError) {
    throw new Error(legacySessionError.message ?? "Could not confirm skipped session.");
  }

  if (!legacySession) {
    throw new Error("Session not found.");
  }

  const nextNotes = appendConfirmedSkipTag(legacySession.notes, new Date());

  const { error } = await supabase
    .from("planned_sessions")
    .update({ notes: nextNotes })
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message ?? "Could not confirm skipped session.");
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function markActivityExtraAction(input: { activityId: string }) {
  const parsed = markActivityExtraSchema.parse(input);
  const { supabase, user } = await getAuthedClient();
  await updateCompletedActivityExtraState({ supabase, userId: user.id, activityId: parsed.activityId });
  await persistExtraActivityMarker({ supabase, userId: user.id, activityId: parsed.activityId });
  await updateUploadStatusForActivity({ supabase, userId: user.id, activityId: parsed.activityId, status: "matched" });

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath(`/activities/${parsed.activityId}`);
}


export async function updateSessionAction(input: {
  sessionId: string;
  type: string;
  duration: number;
  notes?: string;
  status: "planned" | "completed" | "skipped";
}) {
  const parsed = updateSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  let nextNotes = parsed.notes?.trim() || null;

  const { error: sessionTableError } = await supabase
    .from("sessions")
    .update({
      type: parsed.type || "Session",
      duration_minutes: parsed.duration,
      notes: syncSkipTagForStatus(nextNotes, parsed.status, new Date()),
      status: parsed.status
    })
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id);

  if (!sessionTableError) {
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    return;
  }

  if (sessionTableError.code !== "PGRST205") {
    throw new Error(sessionTableError.message ?? "Could not update session.");
  }

  nextNotes = syncSkipTagForStatus(nextNotes, parsed.status, new Date());

  const { error: plannedError } = await supabase
    .from("planned_sessions")
    .update({
      type: parsed.type || "Session",
      duration: parsed.duration,
      notes: nextNotes
    })
    .eq("id", parsed.sessionId)
    .eq("user_id", user.id);

  if (plannedError) {
    throw new Error(plannedError.message ?? "Could not update session.");
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

export async function quickAddSessionAction(input: {
  date: string;
  sport: "swim" | "bike" | "run" | "strength" | "other";
  type?: string;
  duration: number;
  notes?: string;
}) {
  const parsed = quickAddSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  const { data: plan, error: planError } = await supabase
    .from("training_plans")
    .select("id")
    .eq("user_id", user.id)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (planError) {
    throw new Error(planError.message ?? "Could not load training plan.");
  }

  let planId = plan?.id;

  if (!planId) {
    const { data: createdPlan, error: createPlanError } = await supabase
      .from("training_plans")
      .insert({
        user_id: user.id,
        name: "Quick Plan",
        start_date: parsed.date,
        duration_weeks: 12
      })
      .select("id")
      .single();

    if (createPlanError || !createdPlan) {
      throw new Error(createPlanError?.message ?? "Could not create plan for new session.");
    }

    planId = createdPlan.id;
  }

  const { error } = await supabase.from("planned_sessions").insert({
    user_id: user.id,
    plan_id: planId,
    date: parsed.date,
    sport: parsed.sport,
    type: parsed.type?.trim() || "Session",
    duration: parsed.duration,
    notes: parsed.notes?.trim() || null
  });

  if (error) {
    throw new Error(error.message ?? "Could not create session.");
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}
