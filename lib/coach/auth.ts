import { createClient } from "@/lib/supabase/server";
import type { CoachAuthContext } from "@/lib/coach/types";

export async function resolveCoachAuthContext() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, ctx: null, reason: "unauthenticated" as const };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed resolving athlete profile: ${error.message}`);
  }

  if (!profile) {
    return { supabase, ctx: null, reason: "missing-athlete-profile" as const };
  }

  const ctx: CoachAuthContext = {
    userId: user.id,
    athleteId: profile.id,
    email: user.email ?? null
  };

  return { supabase, ctx, reason: null };
}
