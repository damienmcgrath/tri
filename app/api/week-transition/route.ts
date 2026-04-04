import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  generateWeekTransitionBriefing,
  getWeekTransitionBriefing,
  markBriefingViewed,
  markBriefingDismissed
} from "@/lib/training/week-transition";

const getSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const patchSchema = z.object({
  briefingId: z.string().uuid(),
  action: z.enum(["view", "dismiss"])
});

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const parsed = getSchema.safeParse({ weekStart: searchParams.get("weekStart") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid weekStart" }, { status: 400 });
  }

  const briefing = await getWeekTransitionBriefing(supabase, user.id, parsed.data.weekStart);
  return NextResponse.json({ briefing });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = getSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid weekStart" }, { status: 400 });
  }

  const briefing = await generateWeekTransitionBriefing(supabase, user.id, parsed.data.weekStart);
  return NextResponse.json({ briefing });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (parsed.data.action === "view") {
    await markBriefingViewed(supabase, parsed.data.briefingId);
  } else {
    await markBriefingDismissed(supabase, parsed.data.briefingId);
  }

  return NextResponse.json({ ok: true });
}
