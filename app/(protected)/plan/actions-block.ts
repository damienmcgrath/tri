"use server";

/**
 * Server actions for the training_blocks domain. Extracted from
 * app/(protected)/plan/actions.ts to keep the parent file focused.
 *
 * The barrel `actions.ts` re-exports these so existing client-component
 * import paths (e.g. `from "./actions"`) keep working.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/actions-utils";
import { isMissingColumnError } from "@/lib/supabase/schema-compat";

const uuidSchema = z.string().uuid();

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
  if (!error) return false;
  if (error.code === "PGRST205") return true;
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
