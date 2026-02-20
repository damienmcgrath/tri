"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();

const createPlanSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required."),
  startDate: z.string().date(),
  durationWeeks: z.coerce.number().int().min(1).max(52)
});

const weekSchema = z.object({
  weekId: uuidSchema,
  planId: uuidSchema
});

const upsertWeekSchema = weekSchema.extend({
  focus: z.enum(["Build", "Recovery", "Taper", "Race", "Custom"]),
  notes: z.string().trim().max(2000).optional(),
  targetMinutes: z.union([z.literal(""), z.coerce.number().int().min(0).max(10080)]).optional(),
  targetTss: z.union([z.literal(""), z.coerce.number().int().min(0).max(5000)]).optional()
});

const createSessionSchema = z.object({
  planId: uuidSchema,
  weekId: uuidSchema,
  date: z.string().date(),
  sport: z.enum(["swim", "bike", "run", "strength", "other"]),
  sessionType: z.string().trim().min(1, "Session type is required."),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  notes: z.string().trim().max(1000).optional(),
  distanceValue: z.union([z.literal(""), z.coerce.number().positive()]).optional(),
  distanceUnit: z.union([z.literal(""), z.enum(["m", "km", "mi", "yd"])]).optional()
});

const updateSessionSchema = createSessionSchema.extend({
  sessionId: uuidSchema,
  status: z.enum(["planned", "completed", "skipped"]).default("planned")
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

async function assertWeekOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  weekId: string,
  planId?: string
) {
  const query = supabase
    .from("training_weeks")
    .select("id,plan_id,week_index,week_start_date,focus,notes,target_minutes,target_tss")
    .eq("id", weekId);

  if (planId) {
    query.eq("plan_id", planId);
  }

  const { data: week, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Could not validate week ownership: ${error.message}`);
  }

  if (!week) {
    throw new Error("Week not found.");
  }

  await assertPlanOwnership(supabase, userId, week.plan_id);

  return week;
}

export async function createPlanAction(formData: FormData) {
  const parsed = createPlanSchema.parse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    durationWeeks: formData.get("durationWeeks")
  });

  const { supabase, user } = await getAuthedClient();

  const { data: plan, error } = await supabase
    .from("training_plans")
    .insert({
      user_id: user.id,
      name: parsed.name,
      start_date: parsed.startDate,
      duration_weeks: parsed.durationWeeks
    })
    .select("id,start_date,duration_weeks")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
  redirect(`/plan?plan=${plan.id}`);
}

export async function updateWeekAction(formData: FormData) {
  const parsed = upsertWeekSchema.parse({
    weekId: formData.get("weekId"),
    planId: formData.get("planId"),
    focus: formData.get("focus"),
    notes: formData.get("notes"),
    targetMinutes: formData.get("targetMinutes"),
    targetTss: formData.get("targetTss")
  });

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { error } = await supabase
    .from("training_weeks")
    .update({
      focus: parsed.focus,
      notes: parsed.notes ?? null,
      target_minutes: parsed.targetMinutes === "" ? null : parsed.targetMinutes,
      target_tss: parsed.targetTss === "" ? null : parsed.targetTss
    })
    .eq("id", parsed.weekId)
    .eq("plan_id", parsed.planId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
}

export async function duplicateWeekForwardAction(formData: FormData) {
  const parsed = weekSchema.parse({
    weekId: formData.get("weekId"),
    planId: formData.get("planId")
  });

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);
  const sourceWeek = await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { data: targetWeek, error: targetWeekError } = await supabase
    .from("training_weeks")
    .select("id,week_start_date")
    .eq("plan_id", parsed.planId)
    .eq("week_index", sourceWeek.week_index + 1)
    .maybeSingle();

  if (targetWeekError) {
    throw new Error(targetWeekError.message);
  }

  if (!targetWeek) {
    throw new Error("No next week available to duplicate into.");
  }

  const { error: weekUpdateError } = await supabase
    .from("training_weeks")
    .update({
      focus: sourceWeek.focus,
      notes: sourceWeek.notes,
      target_minutes: sourceWeek.target_minutes,
      target_tss: sourceWeek.target_tss
    })
    .eq("id", targetWeek.id);

  if (weekUpdateError) {
    throw new Error(weekUpdateError.message);
  }

  const { data: sourceSessions, error: sourceSessionsError } = await supabase
    .from("sessions")
    .select("sport,type,duration_minutes,notes,distance_value,distance_unit,status,date")
    .eq("week_id", sourceWeek.id)
    .order("date", { ascending: true });

  if (sourceSessionsError) {
    throw new Error(sourceSessionsError.message);
  }

  const { error: deleteTargetError } = await supabase.from("sessions").delete().eq("week_id", targetWeek.id).eq("plan_id", parsed.planId);

  if (deleteTargetError) {
    throw new Error(deleteTargetError.message);
  }

  const targetStartDate = new Date(`${targetWeek.week_start_date}T00:00:00.000Z`);
  const sourceStartDate = new Date(`${sourceWeek.week_start_date}T00:00:00.000Z`);

  if ((sourceSessions ?? []).length > 0) {
    const payload = (sourceSessions ?? []).map((session) => {
      const sessionDate = new Date(`${session.date}T00:00:00.000Z`);
      const offsetDays = Math.round((sessionDate.getTime() - sourceStartDate.getTime()) / (1000 * 60 * 60 * 24));
      const targetDate = new Date(targetStartDate);
      targetDate.setUTCDate(targetStartDate.getUTCDate() + offsetDays);

      return {
        user_id: user.id,
        plan_id: parsed.planId,
        week_id: targetWeek.id,
        date: targetDate.toISOString().slice(0, 10),
        sport: session.sport,
        type: session.type,
        duration_minutes: session.duration_minutes,
        notes: session.notes,
        distance_value: session.distance_value,
        distance_unit: session.distance_unit,
        status: "planned"
      };
    });

    const { error: insertError } = await supabase.from("sessions").insert(payload);

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  revalidatePath("/plan");
}

export async function shiftWeekAction(formData: FormData) {
  const parsed = weekSchema.extend({
    direction: z.enum(["forward", "backward"])
  }).parse({
    weekId: formData.get("weekId"),
    planId: formData.get("planId"),
    direction: formData.get("direction")
  });

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);
  const week = await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id,date")
    .eq("week_id", week.id)
    .order("date", { ascending: true });

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const deltaDays = parsed.direction === "forward" ? 7 : -7;
  const newWeekStart = new Date(`${week.week_start_date}T00:00:00.000Z`);
  newWeekStart.setUTCDate(newWeekStart.getUTCDate() + deltaDays);

  const { error: weekUpdateError } = await supabase
    .from("training_weeks")
    .update({ week_start_date: newWeekStart.toISOString().slice(0, 10) })
    .eq("id", week.id);

  if (weekUpdateError) {
    throw new Error(weekUpdateError.message);
  }

  for (const session of sessions ?? []) {
    const nextDate = new Date(`${session.date}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + deltaDays);

    const { error } = await supabase
      .from("sessions")
      .update({ date: nextDate.toISOString().slice(0, 10) })
      .eq("id", session.id)
      .eq("plan_id", parsed.planId);

    if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath("/plan");
}

export async function deleteWeekAction(formData: FormData) {
  const parsed = weekSchema.parse({
    weekId: formData.get("weekId"),
    planId: formData.get("planId")
  });

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);

  const { data: weeks, error: weeksError } = await supabase
    .from("training_weeks")
    .select("id,week_index")
    .eq("plan_id", parsed.planId)
    .order("week_index", { ascending: true });

  if (weeksError) {
    throw new Error(weeksError.message);
  }

  if (!weeks || weeks.length <= 1) {
    throw new Error("A plan must contain at least one week.");
  }

  const weekToDelete = weeks.find((week) => week.id === parsed.weekId);

  if (!weekToDelete) {
    throw new Error("Week not found.");
  }

  const { error: deleteError } = await supabase.from("training_weeks").delete().eq("id", parsed.weekId).eq("plan_id", parsed.planId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const remainingWeeks = weeks.filter((week) => week.id !== parsed.weekId);
  for (const [index, week] of remainingWeeks.entries()) {
    const expected = index + 1;
    if (week.week_index !== expected) {
      const { error } = await supabase.from("training_weeks").update({ week_index: expected }).eq("id", week.id);
      if (error) {
        throw new Error(error.message);
      }
    }
  }

  revalidatePath("/plan");
}

export async function createSessionAction(formData: FormData) {
  const parsed = createSessionSchema.parse({
    planId: formData.get("planId"),
    weekId: formData.get("weekId"),
    date: formData.get("date"),
    sport: formData.get("sport"),
    sessionType: formData.get("sessionType"),
    durationMinutes: formData.get("durationMinutes"),
    notes: formData.get("notes"),
    distanceValue: formData.get("distanceValue"),
    distanceUnit: formData.get("distanceUnit")
  });

  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { error } = await supabase.from("sessions").insert({
    user_id: user.id,
    plan_id: parsed.planId,
    week_id: parsed.weekId,
    date: parsed.date,
    sport: parsed.sport,
    type: parsed.sessionType,
    duration_minutes: parsed.durationMinutes,
    notes: parsed.notes ?? null,
    distance_value: parsed.distanceValue === "" ? null : parsed.distanceValue,
    distance_unit: parsed.distanceUnit === "" ? null : parsed.distanceUnit,
    status: "planned"
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
    weekId: formData.get("weekId"),
    date: formData.get("date"),
    sport: formData.get("sport"),
    sessionType: formData.get("sessionType"),
    durationMinutes: formData.get("durationMinutes"),
    notes: formData.get("notes"),
    distanceValue: formData.get("distanceValue"),
    distanceUnit: formData.get("distanceUnit"),
    status: formData.get("status")
  });

  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { error } = await supabase
    .from("sessions")
    .update({
      plan_id: parsed.planId,
      week_id: parsed.weekId,
      date: parsed.date,
      sport: parsed.sport,
      type: parsed.sessionType,
      duration_minutes: parsed.durationMinutes,
      notes: parsed.notes ?? null,
      distance_value: parsed.distanceValue === "" ? null : parsed.distanceValue,
      distance_unit: parsed.distanceUnit === "" ? null : parsed.distanceUnit,
      status: parsed.status,
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

  const { error } = await supabase.from("sessions").delete().eq("id", parsed.sessionId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
}
