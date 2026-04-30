"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/actions-utils";
import { insertWithCompat, insertBatchWithCompat, updateWithCompat, isMissingColumnError, SESSIONS_OPTIONAL_COLUMNS } from "@/lib/supabase/schema-compat";
import { getActivePlanId } from "@/lib/supabase/queries";

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
  targetMinutes: z.union([z.literal(""), z.coerce.number().int().min(0).max(10080)]).optional()
});

const createSessionSchema = z.object({
  planId: uuidSchema,
  weekId: uuidSchema,
  date: z.string().date(),
  sport: z.enum(["swim", "bike", "run", "strength", "other"]),
  sessionType: z.string().trim().max(100).optional(),
  sessionName: z.string().trim().max(200).optional(),
  intentCategory: z.string().trim().max(120).optional(),
  target: z.string().trim().max(2000).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  notes: z.string().trim().max(2000).optional(),
  distanceValue: z.union([z.literal(""), z.coerce.number().positive()]).optional(),
  distanceUnit: z.union([z.literal(""), z.enum(["m", "km", "mi", "yd"])]).optional(),
  dayOrder: z.coerce.number().int().min(0).max(100).optional(),
  isKey: z.coerce.boolean().optional(),
  sessionRole: z.union([z.literal(""), z.enum(["Key", "Supporting", "Recovery", "Optional"])]).optional()
});

const updateSessionSchema = createSessionSchema.extend({
  sessionId: uuidSchema,
  status: z.enum(["planned", "completed", "skipped"]).default("planned")
});

const deleteSessionSchema = z.object({
  sessionId: uuidSchema
});

const reorderSessionSchema = z.object({
  sessionId: uuidSchema,
  planId: uuidSchema,
  weekId: uuidSchema,
  date: z.string().date(),
  dayOrder: z.coerce.number().int().min(0).max(100)
});



const bulkReorderSessionSchema = z.object({
  planId: uuidSchema,
  weekId: uuidSchema,
  updates: z.array(reorderSessionSchema).max(200)
});

const duplicateWeekSchema = weekSchema.extend({
  destinationWeekId: uuidSchema,
  copyMetadata: z.coerce.boolean().default(true),
  copySessions: z.coerce.boolean().default(true)
});

const deletePlanSchema = z.object({
  planId: uuidSchema
});

const blockTypeEnum = z.enum([
  "Base",
  "Build",
  "Peak",
  "Taper",
  "Race",
  "Recovery",
  "Transition"
]);

const createBlockSchema = z.object({
  planId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  blockType: blockTypeEnum,
  startDate: z.string().date(),
  endDate: z.string().date(),
  notes: z.string().trim().max(2000).optional()
});

const updateBlockSchema = createBlockSchema.extend({
  blockId: uuidSchema
});

const deleteBlockSchema = z.object({
  blockId: uuidSchema
});

const reorderBlocksSchema = z.object({
  planId: uuidSchema,
  updates: z
    .array(
      z.object({
        blockId: uuidSchema,
        sortOrder: z.coerce.number().int().min(0).max(1000)
      })
    )
    .min(1)
    .max(50)
});


function isMissingTableError(error: { code?: string; message?: string } | null, tableName: string) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes(`could not find the table '${tableName.toLowerCase()}' in the schema cache`);
}

function getOptionalFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === null ? undefined : value;
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


function fallbackSessionType(sport: string, sessionType?: string | null) {
  const explicitType = sessionType?.trim();
  if (explicitType) {
    return explicitType;
  }

  if (sport === "swim") return "Swim";
  if (sport === "bike") return "Bike";
  if (sport === "run") return "Run";
  if (sport === "strength") return "Strength";
  return "Training";
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

  const startDate = new Date(`${plan.start_date}T00:00:00.000Z`);
  const weeksPayload = Array.from({ length: Math.max(plan.duration_weeks, 1) }).map((_, index) => {
    const weekStart = new Date(startDate);
    weekStart.setUTCDate(startDate.getUTCDate() + index * 7);
    return {
      plan_id: plan.id,
      week_index: index + 1,
      week_start_date: weekStart.toISOString().slice(0, 10),
      focus: "Build"
    };
  });

  const { error: weeksError } = await supabase.from("training_weeks").upsert(weeksPayload, {
    onConflict: "plan_id,week_index",
    ignoreDuplicates: true
  });

  if (weeksError) {
    if (isMissingTableError(weeksError, "public.training_weeks")) {
      throw new Error("Could not create week rows because the training_weeks table is missing. Run latest Supabase migrations and try again.");
    }

    throw new Error(weeksError.message);
  }

  await supabase.from("profiles").upsert({ id: user.id, active_plan_id: plan.id }, { onConflict: "id" });

  revalidatePath("/plan");
  revalidatePath("/dashboard");
  redirect(`/plan?plan=${plan.id}`);
}

export async function deletePlanAction(formData: FormData) {
  const parsed = deletePlanSchema.parse({
    planId: formData.get("planId")
  });

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);

  const { error } = await supabase
    .from("training_plans")
    .delete()
    .eq("id", parsed.planId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  const currentActivePlanId = await getActivePlanId(supabase, user.id);
  if (currentActivePlanId === parsed.planId) {
    const { data: fallbackPlan } = await supabase
      .from("training_plans")
      .select("id")
      .eq("user_id", user.id)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    await supabase.from("profiles").upsert({ id: user.id, active_plan_id: fallbackPlan?.id ?? null }, { onConflict: "id" });
  }

  revalidatePath("/plan");
  revalidatePath("/dashboard");
  redirect("/plan");
}

export async function updateWeekAction(formData: FormData) {
  const parsed = upsertWeekSchema.parse({
    weekId: formData.get("weekId"),
    planId: formData.get("planId"),
    focus: formData.get("focus"),
    notes: formData.get("notes"),
    targetMinutes: formData.get("targetMinutes"),
  });

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { error } = await supabase
    .from("training_weeks")
    .update({
      focus: parsed.focus,
      notes: parsed.notes ?? null,
      target_minutes: parsed.targetMinutes === "" ? null : parsed.targetMinutes
    })
    .eq("id", parsed.weekId)
    .eq("plan_id", parsed.planId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/plan");
}

export async function duplicateWeekForwardAction(formData: FormData) {
  const parsed = duplicateWeekSchema.parse({
    weekId: formData.get("weekId"),
    planId: formData.get("planId"),
    destinationWeekId: formData.get("destinationWeekId"),
    copyMetadata: formData.get("copyMetadata") ?? "true",
    copySessions: formData.get("copySessions") ?? "true"
  });

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);
  const sourceWeek = await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { data: targetWeek, error: targetWeekError } = await supabase
    .from("training_weeks")
    .select("id,week_start_date")
    .eq("plan_id", parsed.planId)
    .eq("id", parsed.destinationWeekId)
    .maybeSingle();

  if (targetWeekError) {
    throw new Error(targetWeekError.message);
  }

  if (!targetWeek) {
    throw new Error("No destination week available to duplicate into.");
  }

  if (targetWeek.id === sourceWeek.id) {
    throw new Error("Destination week must be different from source week.");
  }

  if (parsed.copyMetadata) {
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
  }

  const sourceSessionsQuery = await supabase
    .from("sessions")
    .select("sport,type,target,duration_minutes,notes,distance_value,distance_unit,status,is_key,session_role,date,day_order")
    .eq("week_id", sourceWeek.id)
    .order("date", { ascending: true });

  let sourceSessionsData: unknown[] | null = sourceSessionsQuery.data as unknown[] | null;
  let sourceSessionsError = sourceSessionsQuery.error;

  if (sourceSessionsError && (isMissingColumnError(sourceSessionsError, "target") || isMissingColumnError(sourceSessionsError, "day_order"))) {
    const fallbackQuery = await supabase
      .from("sessions")
      .select("sport,type,duration_minutes,notes,distance_value,distance_unit,status,is_key,session_role,date")
      .eq("week_id", sourceWeek.id)
      .order("date", { ascending: true });

    sourceSessionsData = fallbackQuery.data as unknown[] | null;
    sourceSessionsError = fallbackQuery.error;
  }

  if (sourceSessionsError) {
    throw new Error(sourceSessionsError.message);
  }

  const sourceSessions = (sourceSessionsData ?? []) as Array<{
    sport: string;
    type: string;
    target?: string | null;
    duration_minutes: number;
    notes: string | null;
    distance_value: number | null;
    distance_unit: string | null;
    status: string;
    session_role?: "Key" | "Supporting" | "Recovery" | "Optional" | null;
    date: string;
    day_order?: number | null;
  }>;

  if (!parsed.copySessions) {
    revalidatePath("/plan");
    return;
  }

  const { error: deleteTargetError } = await supabase.from("sessions").delete().eq("week_id", targetWeek.id).eq("plan_id", parsed.planId);

  if (deleteTargetError) {
    throw new Error(deleteTargetError.message);
  }

  const targetStartDate = new Date(`${targetWeek.week_start_date}T00:00:00.000Z`);
  const sourceStartDate = new Date(`${sourceWeek.week_start_date}T00:00:00.000Z`);

  if (sourceSessions.length > 0) {
    const payload = sourceSessions.map((session) => {
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
        target: session.target,
        duration_minutes: session.duration_minutes,
        day_order: session.day_order,
        notes: session.notes,
        distance_value: session.distance_value,
        distance_unit: session.distance_unit,
        status: "planned",
        session_role: session.session_role ?? null
      };
    });

    await insertBatchWithCompat(supabase, "sessions", payload, SESSIONS_OPTIONAL_COLUMNS);
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
  const newWeekStartIso = newWeekStart.toISOString().slice(0, 10);

  const { data: planBlocks, error: planBlocksError } = await supabase
    .from("training_blocks")
    .select("id,start_date,end_date")
    .eq("plan_id", parsed.planId);

  if (planBlocksError && !isMissingTableError(planBlocksError, "public.training_blocks")) {
    throw new Error(planBlocksError.message);
  }

  const containingBlock = (planBlocks ?? []).find(
    (b: { start_date: string; end_date: string }) =>
      newWeekStartIso >= b.start_date && newWeekStartIso <= b.end_date
  );
  const weekUpdatePayload: Record<string, unknown> = { week_start_date: newWeekStartIso };
  if (planBlocks) {
    weekUpdatePayload.block_id = containingBlock?.id ?? null;
  }

  const { error: weekUpdateError } = await supabase
    .from("training_weeks")
    .update(weekUpdatePayload)
    .eq("id", week.id);

  if (weekUpdateError && isMissingColumnError(weekUpdateError, "block_id")) {
    const { error: retryError } = await supabase
      .from("training_weeks")
      .update({ week_start_date: newWeekStartIso })
      .eq("id", week.id);
    if (retryError) {
      throw new Error(retryError.message);
    }
  } else if (weekUpdateError) {
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

  if (weeksError && !isMissingTableError(weeksError, "public.training_weeks")) {
    throw new Error(weeksError.message);
  }

  if (!weeks || weeks.length <= 1) {
    throw new Error("A plan must contain at least one week.");
  }

  const weekToDelete = weeks.find((week: any) => week.id === parsed.weekId);

  if (!weekToDelete) {
    throw new Error("Week not found.");
  }

  const { error: deleteError } = await supabase.from("training_weeks").delete().eq("id", parsed.weekId).eq("plan_id", parsed.planId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const remainingWeeks = weeks.filter((week: any) => week.id !== parsed.weekId);
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
    sessionType: getOptionalFormValue(formData, "sessionType"),
    target: getOptionalFormValue(formData, "target"),
    durationMinutes: formData.get("durationMinutes"),
    notes: getOptionalFormValue(formData, "notes"),
    distanceValue: getOptionalFormValue(formData, "distanceValue"),
    distanceUnit: getOptionalFormValue(formData, "distanceUnit"),
    dayOrder: getOptionalFormValue(formData, "dayOrder"),
    isKey: getOptionalFormValue(formData, "isKey"),
    sessionRole: getOptionalFormValue(formData, "sessionRole")
  });

  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { data: daySessions, error: daySessionsError } = await supabase
    .from("sessions")
    .select("id")
    .eq("week_id", parsed.weekId)
    .eq("date", parsed.date);

  if (daySessionsError && !isMissingTableError(daySessionsError, "public.sessions")) {
    throw new Error(daySessionsError.message);
  }

  const canonicalPayload = {
    user_id: user.id,
    plan_id: parsed.planId,
    week_id: parsed.weekId,
    date: parsed.date,
    sport: parsed.sport,
    type: fallbackSessionType(parsed.sport, parsed.sessionType),
    session_name: parsed.sessionName?.length ? parsed.sessionName : null,
    intent_category: parsed.intentCategory?.length ? parsed.intentCategory : null,
    target: parsed.target || null,
    day_order: parsed.dayOrder ?? (daySessions?.length ?? 0),
    duration_minutes: parsed.durationMinutes,
    notes: parsed.notes ?? null,
    distance_value: parsed.distanceValue === "" ? null : parsed.distanceValue,
    distance_unit: parsed.distanceUnit === "" ? null : parsed.distanceUnit,
    status: "planned",
    is_key: Boolean(parsed.isKey) || parsed.sessionRole === "Key",
    session_role: parsed.sessionRole === "" ? null : parsed.sessionRole
  };

  await insertWithCompat(supabase, "sessions", canonicalPayload, SESSIONS_OPTIONAL_COLUMNS);

  revalidatePath("/plan");
  revalidatePath("/calendar");
}

export async function updateSessionAction(formData: FormData) {
  const parsed = updateSessionSchema.parse({
    sessionId: formData.get("sessionId"),
    planId: formData.get("planId"),
    weekId: formData.get("weekId"),
    date: formData.get("date"),
    sport: formData.get("sport"),
    sessionType: getOptionalFormValue(formData, "sessionType"),
    sessionName: getOptionalFormValue(formData, "sessionName"),
    intentCategory: getOptionalFormValue(formData, "intentCategory"),
    target: getOptionalFormValue(formData, "target"),
    durationMinutes: formData.get("durationMinutes"),
    notes: getOptionalFormValue(formData, "notes"),
    distanceValue: getOptionalFormValue(formData, "distanceValue"),
    distanceUnit: getOptionalFormValue(formData, "distanceUnit"),
    status: formData.get("status"),
    isKey: getOptionalFormValue(formData, "isKey"),
    sessionRole: getOptionalFormValue(formData, "sessionRole")
  });

  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const canonicalPayload = {
    plan_id: parsed.planId,
    week_id: parsed.weekId,
    date: parsed.date,
    sport: parsed.sport,
    type: fallbackSessionType(parsed.sport, parsed.sessionType),
    session_name: parsed.sessionName?.length ? parsed.sessionName : null,
    intent_category: parsed.intentCategory?.length ? parsed.intentCategory : null,
    target: parsed.target || null,
    notes: parsed.notes ?? null,
    distance_value: parsed.distanceValue === "" ? null : parsed.distanceValue,
    distance_unit: parsed.distanceUnit === "" ? null : parsed.distanceUnit,
    duration_minutes: parsed.durationMinutes,
    status: parsed.status,
    user_id: user.id,
    is_key: Boolean(parsed.isKey) || parsed.sessionRole === "Key",
    session_role: parsed.sessionRole === "" ? null : parsed.sessionRole
  };

  await updateWithCompat(supabase, "sessions", parsed.sessionId, canonicalPayload, SESSIONS_OPTIONAL_COLUMNS);

  revalidatePath("/plan");
  revalidatePath("/calendar");
}

const sessionDetailsSchema = z.object({
  sessionId: uuidSchema,
  planId: uuidSchema,
  weekId: uuidSchema,
  sport: z.enum(["swim", "bike", "run", "strength", "other"]),
  sessionName: z.string().trim().max(200).nullable().optional(),
  intentCategory: z.string().trim().max(120).nullable().optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440),
  target: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  sessionRole: z.enum(["Key", "Supporting", "Recovery"]).nullable().optional()
});

export type SessionDetailsInput = z.infer<typeof sessionDetailsSchema>;

/**
 * JSON-input variant of updateSessionAction used by the SessionDrawer for
 * optimistic UX. Returns void; caller is responsible for splicing the new
 * values into local state before awaiting and reverting on rejection.
 */
export async function updateSessionDetailsAction(input: SessionDetailsInput) {
  const parsed = sessionDetailsSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  // The drawer schema dropped the explicit `sessionType` field in favour of
  // `intent_category`, but the legacy `type` column is still NOT NULL on older
  // rows. Mirror `session_name` into `type` so the column stays populated;
  // intent lives in `intent_category`. Diverges from create/updateSessionAction
  // which still pass an explicit sessionType.
  const canonicalPayload = {
    sport: parsed.sport,
    type: fallbackSessionType(parsed.sport, parsed.sessionName ?? undefined),
    session_name: parsed.sessionName?.length ? parsed.sessionName : null,
    intent_category: parsed.intentCategory?.length ? parsed.intentCategory : null,
    target: parsed.target?.length ? parsed.target : null,
    notes: parsed.notes?.length ? parsed.notes : null,
    duration_minutes: parsed.durationMinutes,
    is_key: parsed.sessionRole === "Key",
    session_role: parsed.sessionRole ?? null,
    user_id: user.id
  };

  await updateWithCompat(supabase, "sessions", parsed.sessionId, canonicalPayload, SESSIONS_OPTIONAL_COLUMNS);

  revalidatePath("/plan");
  revalidatePath("/calendar");
}

export async function reorderSessionAction(input: z.infer<typeof reorderSessionSchema>) {
  const parsed = reorderSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  const { error } = await supabase
    .from("sessions")
    .update({ date: parsed.date, day_order: parsed.dayOrder, week_id: parsed.weekId })
    .eq("id", parsed.sessionId)
    .eq("plan_id", parsed.planId);

  if (error && isMissingColumnError(error, "day_order")) {
    const { error: retryError } = await supabase
      .from("sessions")
      .update({ date: parsed.date, week_id: parsed.weekId })
      .eq("id", parsed.sessionId)
      .eq("plan_id", parsed.planId);

    if (retryError) {
      throw new Error(retryError.message);
    }
  } else if (error) {
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
  revalidatePath("/calendar");
}


async function assertBlockOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  blockId: string
) {
  const { data: block, error } = await supabase
    .from("training_blocks")
    .select("id,plan_id,user_id,start_date,end_date,sort_order")
    .eq("id", blockId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not validate block ownership: ${error.message}`);
  }
  if (!block || block.user_id !== userId) {
    throw new Error("Block not found or not owned by current user.");
  }
  return block as {
    id: string;
    plan_id: string | null;
    user_id: string;
    start_date: string;
    end_date: string;
    sort_order: number;
  };
}

/**
 * Re-attach weeks whose start date falls inside this block. Also clears
 * `block_id` on weeks that previously pointed here but no longer overlap
 * (e.g. when a block's dates shrink).
 */
async function rebackfillWeeksForBlock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  planId: string,
  block: { id: string; start_date: string; end_date: string }
) {
  const detach = await supabase
    .from("training_weeks")
    .update({ block_id: null })
    .eq("plan_id", planId)
    .eq("block_id", block.id)
    .or(`week_start_date.lt.${block.start_date},week_start_date.gt.${block.end_date}`);

  if (detach.error && !isMissingColumnError(detach.error, "block_id")) {
    throw new Error(detach.error.message);
  }

  const attach = await supabase
    .from("training_weeks")
    .update({ block_id: block.id })
    .eq("plan_id", planId)
    .gte("week_start_date", block.start_date)
    .lte("week_start_date", block.end_date);

  if (attach.error && !isMissingColumnError(attach.error, "block_id")) {
    throw new Error(attach.error.message);
  }
}

export async function createBlockAction(formData: FormData) {
  const parsed = createBlockSchema.parse({
    planId: formData.get("planId"),
    name: formData.get("name"),
    blockType: formData.get("blockType"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    notes: getOptionalFormValue(formData, "notes")
  });

  if (parsed.endDate < parsed.startDate) {
    throw new Error("Block end date must be on or after start date.");
  }

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);

  const { data: existingBlocks, error: existingError } = await supabase
    .from("training_blocks")
    .select("sort_order")
    .eq("plan_id", parsed.planId)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (existingError && !isMissingTableError(existingError, "public.training_blocks")) {
    throw new Error(existingError.message);
  }

  const nextSortOrder =
    ((existingBlocks?.[0]?.sort_order as number | null | undefined) ?? -1) + 1;

  const { data: block, error: insertError } = await supabase
    .from("training_blocks")
    .insert({
      plan_id: parsed.planId,
      user_id: user.id,
      name: parsed.name,
      block_type: parsed.blockType,
      start_date: parsed.startDate,
      end_date: parsed.endDate,
      notes: parsed.notes ?? null,
      sort_order: nextSortOrder
    })
    .select("id,start_date,end_date")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  await rebackfillWeeksForBlock(supabase, parsed.planId, {
    id: block.id,
    start_date: block.start_date,
    end_date: block.end_date
  });

  revalidatePath("/plan");
}

export async function updateBlockAction(formData: FormData) {
  const parsed = updateBlockSchema.parse({
    blockId: formData.get("blockId"),
    planId: formData.get("planId"),
    name: formData.get("name"),
    blockType: formData.get("blockType"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    notes: getOptionalFormValue(formData, "notes")
  });

  if (parsed.endDate < parsed.startDate) {
    throw new Error("Block end date must be on or after start date.");
  }

  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);
  const existing = await assertBlockOwnership(supabase, user.id, parsed.blockId);

  if (existing.plan_id && existing.plan_id !== parsed.planId) {
    throw new Error("Block belongs to a different plan.");
  }

  const { error: updateError } = await supabase
    .from("training_blocks")
    .update({
      name: parsed.name,
      block_type: parsed.blockType,
      start_date: parsed.startDate,
      end_date: parsed.endDate,
      notes: parsed.notes ?? null
    })
    .eq("id", parsed.blockId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  await rebackfillWeeksForBlock(supabase, parsed.planId, {
    id: parsed.blockId,
    start_date: parsed.startDate,
    end_date: parsed.endDate
  });

  revalidatePath("/plan");
}

export async function deleteBlockAction(formData: FormData) {
  const parsed = deleteBlockSchema.parse({
    blockId: formData.get("blockId")
  });

  const { supabase, user } = await getAuthedClient();
  await assertBlockOwnership(supabase, user.id, parsed.blockId);

  const { error } = await supabase
    .from("training_blocks")
    .delete()
    .eq("id", parsed.blockId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }

  // training_weeks.block_id has ON DELETE SET NULL, so orphaned weeks are
  // unlinked automatically — nothing else to clean up.

  revalidatePath("/plan");
}

export async function reorderBlocksAction(input: z.infer<typeof reorderBlocksSchema>) {
  const parsed = reorderBlocksSchema.parse(input);
  const { supabase, user } = await getAuthedClient();
  await assertPlanOwnership(supabase, user.id, parsed.planId);

  for (const update of parsed.updates) {
    const { error } = await supabase
      .from("training_blocks")
      .update({ sort_order: update.sortOrder })
      .eq("id", update.blockId)
      .eq("plan_id", parsed.planId)
      .eq("user_id", user.id);

    if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath("/plan");
}

export async function bulkReorderSessionsAction(input: z.infer<typeof bulkReorderSessionSchema>) {
  const parsed = bulkReorderSessionSchema.parse(input);
  const { supabase, user } = await getAuthedClient();

  await assertPlanOwnership(supabase, user.id, parsed.planId);
  await assertWeekOwnership(supabase, user.id, parsed.weekId, parsed.planId);

  for (const update of parsed.updates) {
    const { error } = await supabase
      .from("sessions")
      .update({ date: update.date, day_order: update.dayOrder, week_id: update.weekId })
      .eq("id", update.sessionId)
      .eq("plan_id", parsed.planId);

    if (error && isMissingColumnError(error, "day_order")) {
      const { error: retryError } = await supabase
        .from("sessions")
        .update({ date: update.date, week_id: update.weekId })
        .eq("id", update.sessionId)
        .eq("plan_id", parsed.planId);

      if (retryError) {
        throw new Error(retryError.message);
      }
    } else if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath("/plan");
}
