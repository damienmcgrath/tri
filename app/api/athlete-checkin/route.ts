import { NextResponse } from "next/server";
import { athleteCheckinInputSchema, getAthleteContextSnapshot, saveWeeklyCheckin } from "@/lib/athlete-context";
import { isSameOrigin, getClientIp } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("checkin-ip", ip, { maxRequests: 20, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = athleteCheckinInputSchema.parse(await request.json());
    await saveWeeklyCheckin(supabase, user.id, body);
    const snapshot = await getAthleteContextSnapshot(supabase, user.id);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save weekly check-in." }, { status: 400 });
  }
}
