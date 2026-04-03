import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { saveWeeklyDebriefFeedback, weeklyDebriefFeedbackInputSchema } from "@/lib/weekly-debrief";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("debrief-fb-ip", ip, { maxRequests: 20, windowMs: 60_000 });
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

  const userLimit = await checkRateLimit("debrief-fb-user", user.id, { maxRequests: 10, windowMs: 60_000 });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(userLimit) });
  }

  try {
    const input = weeklyDebriefFeedbackInputSchema.parse(await request.json());
    const artifact = await saveWeeklyDebriefFeedback({
      supabase,
      athleteId: user.id,
      input
    });
    return NextResponse.json({ ok: true, artifact });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save Weekly Debrief feedback." },
      { status: 400 }
    );
  }
}
