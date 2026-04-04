import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin, getClientIp } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWeekStart } from "@/lib/athlete-context";
import { refreshWeeklyDebrief } from "@/lib/weekly-debrief";
import { localIsoDate } from "@/lib/activities/completed-activities";

const refreshInputSchema = z.object({
  weekStart: z.string().date().optional()
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("debrief-refresh-ip", ip, { maxRequests: 10, windowMs: 60_000 });
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
    const body = refreshInputSchema.parse(await request.json().catch(() => ({})));
    const timeZone =
      (user.user_metadata && typeof user.user_metadata.timezone === "string" && user.user_metadata.timezone) ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";
    const todayIso = localIsoDate(new Date().toISOString(), timeZone);
    const result = await refreshWeeklyDebrief({
      supabase,
      athleteId: user.id,
      weekStart: body.weekStart ?? getCurrentWeekStart(),
      timeZone,
      todayIso
    });

    return NextResponse.json({
      ok: true,
      readiness: result.readiness,
      artifact: result.artifact
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not refresh Weekly Debrief." },
      { status: 400 }
    );
  }
}
