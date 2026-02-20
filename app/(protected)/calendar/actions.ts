"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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

export async function moveSessionAction(input: { sessionId: string; newDate: string }) {
  const parsed = moveSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  const { error } = await supabase
    .from("planned_sessions")
    .update({ date: parsed.newDate })
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

  const source = pair.find((session) => session.id === parsed.sourceSessionId);
  const target = pair.find((session) => session.id === parsed.targetSessionId);

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

  if (!plan) {
    throw new Error("Create a plan first before adding sessions.");
  }

  const { error } = await supabase.from("planned_sessions").insert({
    user_id: user.id,
    plan_id: plan.id,
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
