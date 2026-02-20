"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();

const createPlanSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required."),
  startDate: z.string().date(),
  durationWeeks: z.coerce.number().int().min(1).max(52)
});

const sessionSchema = z.object({
  planId: uuidSchema,
  date: z.string().date(),
  sport: z.enum(["swim", "bike", "run", "strength", "other"]),
  sessionType: z.string().trim().min(1, "Session type is required."),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  notes: z.string().trim().max(1000).optional()
});

const updateSessionSchema = sessionSchema.extend({
  sessionId: uuidSchema
});

const deleteSessionSchema = z.object({
  sessionId: uuidSchema
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

async function assertPlanOwnership(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, planId: string) {
  const { data: plan, error } = await supabase
    .from("training_plans")
    .select("id")
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not validate plan ownership: ${error.message}`);
  }

  if (!plan) {
    throw new Error("Plan not found or not owned by current user.");
  }
}

export async function createPlanAction(formData: FormData) {
  const parsed = createPlanSchema.parse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    durationWeeks: formData.get("durationWeeks")
  });

  const { supabase, user } = await getAuthedClient();

  const { error } = await supabase.from("training_plans").insert({
    user_id: user.id,
    name: parsed.name,
    start_date: parsed.startDate,
    duration_weeks: parsed.durationWeeks
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
}

export async function createSessionAction(formData: FormData) {
  const parsed = sessionSchema.parse({
    planId: formData.get("planId"),
    date: formData.get("date"),
    sport: formData.get("sport"),
    sessionType: formData.get("sessionType"),
    durationMinutes: formData.get("durationMinutes"),
    notes: formData.get("notes")
  });

  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);

  const { error } = await supabase.from("planned_sessions").insert({
    user_id: user.id,
    plan_id: parsed.planId,
    date: parsed.date,
    sport: parsed.sport,
    type: parsed.sessionType,
    duration: parsed.durationMinutes,
    session_type: parsed.sessionType,
    duration_minutes: parsed.durationMinutes,
    notes: parsed.notes ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
}

export async function updateSessionAction(formData: FormData) {
  const parsed = updateSessionSchema.parse({
    sessionId: formData.get("sessionId"),
    planId: formData.get("planId"),
    date: formData.get("date"),
    sport: formData.get("sport"),
    sessionType: formData.get("sessionType"),
    durationMinutes: formData.get("durationMinutes"),
    notes: formData.get("notes")
  });

  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);

  const { error } = await supabase
    .from("planned_sessions")
    .update({
      plan_id: parsed.planId,
      date: parsed.date,
      sport: parsed.sport,
      type: parsed.sessionType,
      duration: parsed.durationMinutes,
      session_type: parsed.sessionType,
      duration_minutes: parsed.durationMinutes,
      notes: parsed.notes ?? null,
      user_id: user.id
    })
    .eq("id", parsed.sessionId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
}

export async function deleteSessionAction(formData: FormData) {
  const parsed = deleteSessionSchema.parse({
    sessionId: formData.get("sessionId")
  });

  const { supabase } = await getAuthedClient();

  const { error } = await supabase.from("planned_sessions").delete().eq("id", parsed.sessionId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
}
