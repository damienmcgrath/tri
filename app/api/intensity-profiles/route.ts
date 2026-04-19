import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { computeAndPersistIntensityProfiles } from "@/lib/training/intensity-profiles";

const requestSchema = z.object({
  planId: z.string().uuid()
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await computeAndPersistIntensityProfiles(supabase, user.id, parsed.data.planId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[INTENSITY_PROFILES] Error:", error);
    return NextResponse.json({ error: "Failed to compute profiles" }, { status: 500 });
  }
}
