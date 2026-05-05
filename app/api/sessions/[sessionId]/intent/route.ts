import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAthleteContextSnapshot } from "@/lib/athlete-context";
import type { AthletePhysModel } from "@/lib/findings/types";
import { parseAthleteIntent } from "@/lib/intent/parser";
import { saveResolvedIntent } from "@/lib/intent/persist";
import type { ResolvedIntent } from "@/lib/intent/types";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";

const intentSchema = z.object({
  text: z.string().trim().min(1).max(1500)
});

const SESSION_COLUMNS = "id,user_id,athlete_id,sport,duration_minutes";

interface SessionRow {
  id: string;
  user_id: string;
  athlete_id: string | null;
  sport: string | null;
  duration_minutes: number | null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("intent-ip", ip, { maxRequests: 30, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: rateLimitHeaders(ipLimit) }
    );
  }

  const { sessionId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userLimit = await checkRateLimit("intent-user", user.id, {
    maxRequests: 15,
    windowMs: 60_000
  });
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: rateLimitHeaders(userLimit) }
    );
  }

  let body: { text: string };
  try {
    body = intentSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request body." },
      { status: 400 }
    );
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const sessionRow = session as SessionRow;
  const athleteId = sessionRow.athlete_id ?? sessionRow.user_id;

  let athletePhys: AthletePhysModel = {};
  try {
    const snapshot = await getAthleteContextSnapshot(supabase, athleteId);
    if (snapshot?.ftp?.value && Number.isFinite(snapshot.ftp.value)) {
      athletePhys.ftp = snapshot.ftp.value;
    }
  } catch {
    athletePhys = {};
  }

  let intent: ResolvedIntent;
  try {
    intent = await parseAthleteIntent(body.text, {
      session_sport: sessionRow.sport ?? "other",
      session_duration_min: sessionRow.duration_minutes ?? 0,
      athlete: athletePhys
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not parse intent." },
      { status: 500 }
    );
  }

  try {
    await saveResolvedIntent(sessionId, intent, supabase);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not persist intent." },
      { status: 500 }
    );
  }

  revalidatePath(`/sessions/${sessionId}`);

  return NextResponse.json({ intent });
}
