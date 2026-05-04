"use server";

/**
 * Server actions for the training_weeks domain. Extracted from
 * app/(protected)/plan/actions.ts to keep the parent file focused.
 *
 * The barrel `actions.ts` re-exports these so existing client-component
 * import paths (e.g. `from "./actions"`) keep working.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/actions-utils";
import { insertBatchWithCompat, isMissingColumnError, SESSIONS_OPTIONAL_COLUMNS } from "@/lib/supabase/schema-compat";

const uuidSchema = z.string().uuid();

const weekSchema = z.object({
  weekId: uuidSchema,
  planId: uuidSchema
});

const upsertWeekSchema = weekSchema.extend({
  focus: z.enum(["Build", "Recovery", "Taper", "Race", "Custom"]),
  notes: z.string().trim().max(2000).optional(),
  targetMinutes: z.union([z.literal(""), z.coerce.number().int().min(0).max(10080)]).optional()
});

const duplicateWeekSchema = weekSchema.extend({
  destinationWeekId: uuidSchema,
  copyMetadata: z.coerce.boolean().default(true),
  copySessions: z.coerce.boolean().default(true)
});

function isMissingTableError(error: { code?: string; message?: string } | null, tableName: string) {
  if (!error) return false;
  if (error.code === "PGRST205") return true;
  return (error.message ?? "").toLowerCase().includes(`could not find the table '${tableName.toLowerCase()}' in the schema cache`);
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

  const weekToDelete = weeks.find((week: { id: string }) => week.id === parsed.weekId);

  if (!weekToDelete) {
    throw new Error("Week not found.");
  }

  const { error: deleteError } = await supabase.from("training_weeks").delete().eq("id", parsed.weekId).eq("plan_id", parsed.planId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const remainingWeeks = weeks.filter((week: { id: string }) => week.id !== parsed.weekId);
  for (const [index, week] of remainingWeeks.entries()) {
    const expected = index + 1;
    if ((week as { week_index: number }).week_index !== expected) {
      const { error } = await supabase.from("training_weeks").update({ week_index: expected }).eq("id", week.id);
      if (error) {
        throw new Error(error.message);
      }
    }
  }

  revalidatePath("/plan");
}
