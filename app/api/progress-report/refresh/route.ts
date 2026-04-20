import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin, getClientIp } from "@/lib/security/request";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  refreshProgressReport,
  ProgressReportInsufficientDataError
} from "@/lib/progress-report";
import { localIsoDate } from "@/lib/activities/completed-activities";

const refreshInputSchema = z.object({
  blockEnd: z.string().date().optional()
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("progress-report-refresh-ip", ip, {
    maxRequests: 5,
    windowMs: 60_000
  });
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

  const userLimit = await checkRateLimit("progress-report-refresh-user", user.id, {
    maxRequests: 4,
    windowMs: 60_000
  });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const body = refreshInputSchema.parse(await request.json().catch(() => ({})));
    const timeZone =
      (user.user_metadata &&
        typeof user.user_metadata.timezone === "string" &&
        user.user_metadata.timezone) ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";
    const todayIso = localIsoDate(new Date().toISOString(), timeZone);

    const artifact = await refreshProgressReport({
      supabase,
      athleteId: user.id,
      blockEnd: body.blockEnd ?? todayIso
    });

    return NextResponse.json({ ok: true, artifact });
  } catch (error) {
    if (error instanceof ProgressReportInsufficientDataError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "insufficient_data",
          currentBlockActivityCount: error.currentBlockActivityCount
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not refresh progress report."
      },
      { status: 400 }
    );
  }
}
