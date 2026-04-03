import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { athleteContextInputSchema, getAthleteContextSnapshot, saveAthleteContext } from "@/lib/athlete-context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("ctx-ip", ip, { maxRequests: 20, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(ipLimit) });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userLimit = await checkRateLimit("ctx-user", user.id, { maxRequests: 10, windowMs: 60_000 });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(userLimit) });
  }

  try {
    const body = athleteContextInputSchema.parse(await request.json());
    await saveAthleteContext(supabase, user.id, body);
    const snapshot = await getAthleteContextSnapshot(supabase, user.id);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save athlete context." }, { status: 400 });
  }
}
