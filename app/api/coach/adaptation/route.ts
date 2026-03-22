import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { getMacroContext, formatMacroContextSummary } from "@/lib/training/macro-context";
import { evaluateAdaptationTriggers, buildAdaptationOptions, type SessionSummary, type CheckInData } from "@/lib/training/adaptation-rules";
import { getOpenAIClient, getCoachModel } from "@/lib/openai";

const adaptationRequestSchema = z.object({
  weekStart: z.string().date()
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = checkRateLimit("adapt-ip", ip, { maxRequests: 10, windowMs: 60_000 });
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

  const userLimit = checkRateLimit("adapt-user", user.id, { maxRequests: 5, windowMs: 60_000 });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(userLimit) });
  }

  try {
    const body = adaptationRequestSchema.parse(await request.json());
    const { weekStart } = body;

    // Compute week end (Sunday)
    const weekEnd = new Date(`${weekStart}T00:00:00.000Z`);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndIso = weekEnd.toISOString().slice(0, 10);
    const todayIso = new Date().toISOString().slice(0, 10);

    // Fetch sessions and check-in in parallel
    const [{ data: sessionsData }, { data: checkInData }, macroCtx] = await Promise.all([
      supabase
        .from("sessions")
        .select("id,date,sport,type,status,is_key,duration_minutes")
        .eq("user_id", user.id)
        .gte("date", weekStart)
        .lte("date", weekEndIso)
        .order("date", { ascending: true }),
      supabase
        .from("athlete_checkins")
        .select("fatigue_score,stress_score,motivation_score,week_notes")
        .eq("user_id", user.id)
        .eq("week_start", weekStart)
        .maybeSingle(),
      getMacroContext(supabase, user.id)
    ]);

    const sessions: SessionSummary[] = (sessionsData ?? []).map((s: { id: string; date: string; sport: string; type: string; status: string | null; is_key: boolean | null; duration_minutes: number | null }) => ({
      id: s.id,
      date: s.date,
      sport: s.sport,
      type: s.type,
      status: s.status ?? "planned",
      isKey: Boolean(s.is_key),
      durationMinutes: s.duration_minutes ?? null
    }));

    const checkIn: CheckInData | null = checkInData
      ? {
          fatigueScore: checkInData.fatigue_score ?? null,
          stressScore: checkInData.stress_score ?? null,
          motivationScore: checkInData.motivation_score ?? null,
          weekNotes: checkInData.week_notes ?? null
        }
      : null;

    // Deterministic triggers
    const triggers = evaluateAdaptationTriggers(sessions, checkIn, macroCtx);

    if (triggers.length === 0) {
      return NextResponse.json({ ok: true, triggers: [], adaptations: [] });
    }

    const remainingSessions = sessions.filter((s) => s.date >= todayIso && s.status === "planned");
    const daysRemaining = Math.max(0, Math.ceil((new Date(`${weekEndIso}T00:00:00.000Z`).getTime() - new Date(`${todayIso}T00:00:00.000Z`).getTime()) / 86400000));

    // Build deterministic options for each trigger
    const deterministicAdaptations = triggers.map((trigger) => ({
      trigger,
      options: buildAdaptationOptions(trigger, remainingSessions, { daysRemaining })
    }));

    // AI enrichment — add natural language rationale to options
    const macroSummary = formatMacroContextSummary(macroCtx);

    let enrichedAdaptations = deterministicAdaptations;

    try {
      const client = getOpenAIClient();
      const prompt = `You are a triathlon coach assistant. Given these adaptation triggers and options, add a brief natural language rationale (1-2 sentences) for each option that helps the athlete understand the trade-off.

Athlete context: ${macroSummary}
${checkIn ? `Check-in: fatigue ${checkIn.fatigueScore ?? "??"}/10, stress ${checkIn.stressScore ?? "??"}/10, motivation ${checkIn.motivationScore ?? "??"}/10` : ""}

Triggers and options (JSON):
${JSON.stringify(deterministicAdaptations, null, 2)}

Respond with a JSON array matching the input structure, but with each option.description replaced by a concise, coach-voice rationale. Keep it practical and empathetic. No preamble.`;

      const response = await client.responses.create({
        model: getCoachModel({ deep: true }),
        input: [{ role: "user", content: prompt }],
        text: { format: { type: "json_object" } }
      });

      const aiText = typeof response.output_text === "string" ? response.output_text : null;
      if (aiText) {
        const parsed = JSON.parse(aiText) as Array<{ trigger: unknown; options: Array<{ id: string; description: string }> }>;
        if (Array.isArray(parsed)) {
          enrichedAdaptations = deterministicAdaptations.map((det, i) => {
            const enriched = parsed[i];
            if (!enriched) return det;
            return {
              ...det,
              options: det.options.map((opt) => {
                const enrichedOpt = enriched.options?.find((o) => o.id === opt.id);
                return enrichedOpt ? { ...opt, description: enrichedOpt.description } : opt;
              })
            };
          });
        }
      }
    } catch {
      // AI enrichment failed — return deterministic suggestions
    }

    // Persist to adaptations table
    const adaptationRows = enrichedAdaptations.map((a) => ({
      athlete_id: user.id,
      user_id: user.id,
      trigger_type: a.trigger.type,
      options: a.options,
      status: "pending",
      model_used: getCoachModel({ deep: true })
    }));

    const { data: savedAdaptations } = await supabase
      .from("adaptations")
      .insert(adaptationRows)
      .select("id");

    return NextResponse.json({
      ok: true,
      triggers,
      adaptations: enrichedAdaptations.map((a, i) => ({
        id: savedAdaptations?.[i]?.id ?? null,
        trigger: a.trigger,
        options: a.options
      }))
    });
  } catch (error) {
    console.error("[ADAPTATION]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not generate adaptations." }, { status: 400 });
  }
}
