"use server";

/**
 * Server actions for the training_plans domain. Extracted from
 * app/(protected)/plan/actions.ts to keep the parent file focused.
 *
 * The barrel `actions.ts` re-exports these so existing client-component
 * import paths (e.g. `from "./actions"`) keep working.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/actions-utils";
import { getActivePlanId } from "@/lib/supabase/queries";

const uuidSchema = z.string().uuid();

const createPlanSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required."),
  startDate: z.string().date(),
  durationWeeks: z.coerce.number().int().min(1).max(52)
});

const deletePlanSchema = z.object({
  planId: uuidSchema
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
