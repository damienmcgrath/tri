import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { generateSessionVerdict, SESSION_VERDICT_PROMPT_VERSION } from "@/lib/ai/prompts/session-verdict";
import { createRationaleFromVerdict } from "@/lib/ai/prompts/adaptation-rationale";
import { triggerComparisonAfterVerdict } from "@/lib/training/session-comparison-engine";
import { getCoachModel } from "@/lib/openai";

function tryParseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

const requestSchema = z.object({
  sessionId: z.string().uuid(),
  regenerate: z.boolean().optional().default(false)
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("verdict-ip", ip, { maxRequests: 20, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(ipLimit) });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userLimit = await checkRateLimit("verdict-user", user.id, { maxRequests: 10, windowMs: 60_000 });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(userLimit) });
  }

  try {
    const body = requestSchema.parse(await request.json());

    // Check for existing verdict unless regenerating
    if (!body.regenerate) {
      const { data: existing } = await supabase
        .from("session_verdicts")
        .select("*")
        .eq("session_id", body.sessionId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        return NextResponse.json({ verdict: existing, source: "cached" });
      }
    }

    const { verdict, source, activityId } = await generateSessionVerdict(supabase, user.id, body.sessionId);

    // Upsert to session_verdicts
    const { data: saved, error } = await supabase.from("session_verdicts").upsert(
      {
        user_id: user.id,
        session_id: body.sessionId,
        activity_id: activityId,
        purpose_statement: verdict.purpose_statement,
        training_block_context: verdict.training_block_context,
        intended_zones: verdict.intended_zones ? tryParseJson(verdict.intended_zones) : null,
        intended_metrics: verdict.intended_metrics ? tryParseJson(verdict.intended_metrics) : null,
        execution_summary: verdict.execution_summary,
        verdict_status: verdict.verdict_status,
        metric_comparisons: verdict.metric_comparisons,
        key_deviations: verdict.key_deviations.length > 0 ? verdict.key_deviations : null,
        adaptation_signal: verdict.adaptation_signal,
        adaptation_type: verdict.adaptation_type,
        affected_session_ids: verdict.affected_session_ids.length > 0 ? verdict.affected_session_ids : null,
        discipline: verdict.purpose_statement ? "run" : "other", // Will be overridden below
        raw_ai_response: verdict as unknown as Record<string, unknown>,
        ai_model_used: getCoachModel(),
        ai_prompt_version: SESSION_VERDICT_PROMPT_VERSION
      },
      { onConflict: "session_id" }
    ).select().maybeSingle();

    // Update discipline from session data
    if (saved) {
      const { data: session } = await supabase
        .from("sessions")
        .select("sport")
        .eq("id", body.sessionId)
        .maybeSingle();
      if (session?.sport) {
        await supabase
          .from("session_verdicts")
          .update({ discipline: session.sport })
          .eq("id", saved.id);
      }
    }

    if (error) {
      console.error("[SESSION_VERDICTS] Upsert error:", error.message);
      // Still return the verdict even if save fails
      return NextResponse.json({ verdict, source });
    }

    // Auto-trigger adaptation rationale for modify/redistribute verdicts
    if (verdict.adaptation_type === "modify" || verdict.adaptation_type === "redistribute") {
      try {
        const { data: sessionData } = await supabase
          .from("sessions")
          .select("session_name, type, sport")
          .eq("id", body.sessionId)
          .maybeSingle();
        const sessionName = sessionData?.session_name ?? sessionData?.type ?? "Session";
        await createRationaleFromVerdict(supabase, user.id, {
          session_id: body.sessionId,
          verdict_status: verdict.verdict_status,
          adaptation_type: verdict.adaptation_type,
          adaptation_signal: verdict.adaptation_signal,
          affected_session_ids: verdict.affected_session_ids ?? null,
          discipline: sessionData?.sport ?? "other",
          purpose_statement: verdict.purpose_statement,
          id: saved?.id
        }, sessionName);
      } catch (rationaleError) {
        console.error("[SESSION_VERDICTS] Rationale generation failed:", rationaleError);
        // Non-blocking — verdict still saved successfully
      }
    }

    // Fire-and-forget: trigger session comparison after verdict
    triggerComparisonAfterVerdict(supabase, body.sessionId, user.id).catch((e) => {
      console.warn("[SESSION_VERDICTS] Comparison trigger failed:", e);
    });

    return NextResponse.json({ verdict: saved ?? verdict, source });
  } catch (error) {
    console.error("[SESSION_VERDICTS]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate session verdict." },
      { status: 400 }
    );
  }
}
