import { NextResponse } from "next/server";
import { buildWeeklyExecutionBrief } from "@/lib/execution-review";
import { getAthleteContextSnapshot, getCurrentWeekStart } from "@/lib/athlete-context";
import { createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/security/request";

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const weekStart = getCurrentWeekStart();
    const athleteContext = await getAthleteContextSnapshot(supabase, user.id);
    const brief = await buildWeeklyExecutionBrief({
      supabase,
      athleteId: user.id,
      weekStart,
      weekEnd: addDays(weekStart, 6),
      athleteContext
    });
    return NextResponse.json({ ok: true, brief });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh weekly brief." }, { status: 400 });
  }
}
