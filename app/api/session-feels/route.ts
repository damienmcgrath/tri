import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";

const sessionFeelSchema = z.object({
  sessionId: z.string().uuid(),
  // Legacy RPE (1-10) — optional for backward compat
  rpe: z.number().int().min(1).max(10).nullable().optional(),
  // New 5-point overall feel
  overallFeel: z.number().int().min(1).max(5).nullable().optional(),
  // Secondary inputs
  energyLevel: z.enum(["low", "normal", "high"]).nullable().optional(),
  legsFeel: z.enum(["heavy", "normal", "fresh"]).nullable().optional(),
  motivation: z.enum(["struggled", "neutral", "fired_up"]).nullable().optional(),
  sleepQuality: z.enum(["poor", "ok", "great"]).nullable().optional(),
  lifeStress: z.enum(["high", "normal", "low"]).nullable().optional(),
  // Free text note (expanded to 280 chars)
  note: z.string().max(280).nullable().optional(),
  wasPrompted: z.boolean().optional().default(true),
  // Timing metadata
  promptShownAt: z.string().datetime().nullable().optional(),
  completionTimeMs: z.number().int().min(0).nullable().optional()
}).refine(
  (data) => data.rpe != null || data.overallFeel != null,
  { message: "Either rpe or overallFeel must be provided" }
);

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("feels-ip", ip, { maxRequests: 30, windowMs: 60_000 });
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

  const userLimit = await checkRateLimit("feels-user", user.id, { maxRequests: 15, windowMs: 60_000 });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(userLimit) });
  }

  try {
    const body = sessionFeelSchema.parse(await request.json());

    const { error } = await supabase.from("session_feels").upsert(
      {
        user_id: user.id,
        session_id: body.sessionId,
        rpe: body.rpe ?? null,
        overall_feel: body.overallFeel ?? null,
        energy_level: body.energyLevel ?? null,
        legs_feel: body.legsFeel ?? null,
        motivation: body.motivation ?? null,
        sleep_quality: body.sleepQuality ?? null,
        life_stress: body.lifeStress ?? null,
        note: body.note ?? null,
        was_prompted: body.wasPrompted,
        prompt_shown_at: body.promptShownAt ?? null,
        completed_at: new Date().toISOString(),
        completion_time_ms: body.completionTimeMs ?? null
      },
      { onConflict: "session_id" }
    );

    if (error) {
      console.error("[SESSION_FEELS]", error.message);
      return NextResponse.json({ error: "Could not save session feel." }, { status: 400 });
    }

    // Mark any existing verdict as stale so the card surfaces a "refresh
    // available" chip. We do not auto-regenerate — the user decides. Only
    // flag rows that are not already stale to preserve the earliest reason.
    // Non-blocking: a failure here should not fail the feel upsert.
    const { error: staleError } = await supabase
      .from("session_verdicts")
      .update({ stale_reason: "feel_updated" })
      .eq("session_id", body.sessionId)
      .eq("user_id", user.id)
      .is("stale_reason", null);
    if (staleError) {
      console.error("[SESSION_FEELS] Failed to mark verdict stale:", staleError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save session feel." }, { status: 400 });
  }
}
