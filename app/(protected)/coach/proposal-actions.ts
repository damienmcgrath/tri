"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function approveProposalAction(proposalId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("coach_plan_change_proposals")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/coach");
  return { ok: true };
}

export async function rejectProposalAction(proposalId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("coach_plan_change_proposals")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", proposalId)
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/coach");
  return { ok: true };
}
