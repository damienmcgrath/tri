import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { generateSessionVerdict, SESSION_VERDICT_PROMPT_VERSION } from "@/lib/ai/prompts/session-verdict";
import { createRationaleFromVerdict } from "@/lib/ai/prompts/adaptation-rationale";
import { triggerComparisonAfterVerdict } from "@/lib/training/session-comparison-engine";
import { getCoachModel } from "@/lib/openai";
import { isFindingsPipelineEnabled, runFindingsPipeline } from "@/lib/execution-review";
import { getFindingsForSession } from "@/lib/findings/persist";
import type { Finding } from "@/lib/findings/types";

function tryParseJson(value: string): unknown {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      if ("__proto__" in parsed || "constructor" in parsed || "prototype" in parsed) {
        return null;
      }
    }
    return parsed;
  } catch {
    return value;
  }
}

/**
 * `session_verdicts` has no dedicated columns for the non-obvious insight or
 * the teach moment — both live inside the `raw_ai_response` JSONB. Surface
 * them as top-level fields on the API response so the client component can
 * render them without having to drill into the blob. Legacy rows (pre-teach,
 * pre-insight) return null, so the UI renders nothing rather than breaking.
 */
function readStringField(source: unknown, key: string): string | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function enrichVerdictResponse<T extends Record<string, unknown>>(verdict: T): T & {
  non_obvious_insight: string | null;
  teach: string | null;
} {
  const raw = (verdict as Record<string, unknown>).raw_ai_response;
  const nonObviousInsight =
    typeof verdict.non_obvious_insight === "string" && (verdict.non_obvious_insight as string).trim().length > 0
      ? (verdict.non_obvious_insight as string)
      : readStringField(raw, "non_obvious_insight") ?? readStringField(raw, "nonObviousInsight");
  const teach =
    typeof verdict.teach === "string" && (verdict.teach as string).trim().length > 0
      ? (verdict.teach as string)
      : readStringField(raw, "teach");
  return { ...verdict, non_obvious_insight: nonObviousInsight, teach };
}

const requestSchema = z.object({
  sessionId: z.string().uuid(),
  regenerate: z.boolean().optional().default(false)
});

/**
 * Spec §1.5 — read or generate findings for the session, returning them so
 * the API can surface them alongside the legacy verdict. Reads existing rows
 * via {@link getFindingsForSession} on the cached path; runs the full pipeline
 * (and persists) on the regenerate path. Falls back silently to `null` so a
 * findings failure never blocks the verdict response.
 */
async function loadOrRunFindings(args: {
  sessionId: string;
  userId: string;
  supabase: SupabaseClient;
  regenerate: boolean;
}): Promise<Finding[] | null> {
  if (!isFindingsPipelineEnabled()) return null;
  try {
    if (!args.regenerate) {
      const existing = await getFindingsForSession(args.sessionId, args.supabase);
      if (existing.length > 0) return existing;
    }
    const result = await runFindingsPipeline({
      sessionId: args.sessionId,
      userId: args.userId,
      supabase: args.supabase
    });
    return result.findings;
  } catch (err) {
    console.warn("[SESSION_VERDICTS] findings pipeline failed", err);
    return null;
  }
}

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
        const findings = await loadOrRunFindings({
          sessionId: body.sessionId,
          userId: user.id,
          supabase,
          regenerate: false
        });
        return NextResponse.json({
          verdict: enrichVerdictResponse(existing),
          source: "cached",
          findings
        });
      }
    }

    const { verdict, source, activityId, feel } = await generateSessionVerdict(supabase, user.id, body.sessionId);

    // Upsert to session_verdicts. `feel_data` holds the humanized feel snapshot
    // mirroring what the LLM saw; `stale_reason` is explicitly cleared so any
    // prior "refresh available" flag (set when a feel was captured after the
    // previous generation) is resolved by this fresh write.
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
        feel_data: feel,
        stale_reason: null,
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

    const findings = await loadOrRunFindings({
      sessionId: body.sessionId,
      userId: user.id,
      supabase,
      regenerate: body.regenerate
    });

    if (error) {
      console.error("[SESSION_VERDICTS] Upsert error:", error.message);
      // Still return the verdict even if save fails. The in-memory verdict
      // already carries non_obvious_insight + teach at top level, so the
      // client renders them even when persistence failed.
      return NextResponse.json({
        verdict: enrichVerdictResponse(verdict as unknown as Record<string, unknown>),
        source,
        findings
      });
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

    return NextResponse.json({
      verdict: enrichVerdictResponse((saved ?? verdict) as unknown as Record<string, unknown>),
      source,
      findings
    });
  } catch (error) {
    console.error("[SESSION_VERDICTS]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate session verdict." },
      { status: 400 }
    );
  }
}
