import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrGenerateMorningBrief, generateMorningBrief } from "@/lib/training/morning-brief";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const date = request.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const parsed = dateSchema.safeParse(date);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  try {
    const brief = await getOrGenerateMorningBrief(supabase, user.id, parsed.data);
    return NextResponse.json({ brief });
  } catch (error) {
    console.error("[MORNING_BRIEF] Error:", error);
    return NextResponse.json({ error: "Failed to generate brief" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const date = dateSchema.safeParse(body?.date ?? new Date().toISOString().slice(0, 10));
  if (!date.success) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  try {
    const brief = await generateMorningBrief(supabase, user.id, date.data);
    return NextResponse.json({ brief });
  } catch (error) {
    console.error("[MORNING_BRIEF] Regenerate error:", error);
    return NextResponse.json({ error: "Failed to regenerate brief" }, { status: 500 });
  }
}
