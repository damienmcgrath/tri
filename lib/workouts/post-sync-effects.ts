import type { SupabaseClient } from "@supabase/supabase-js";
import { generateSessionVerdict } from "@/lib/ai/prompts/session-verdict";
import { createRationaleFromVerdict } from "@/lib/ai/prompts/adaptation-rationale";
import { triggerComparisonAfterVerdict } from "@/lib/training/session-comparison-engine";
import { refreshWeeklyDebrief } from "@/lib/weekly-debrief";
import { getCurrentWeekStart } from "@/lib/athlete-context";
import { localIsoDate } from "@/lib/activities/completed-activities";
import { getCoachModel } from "@/lib/openai";

/**
 * Computes the Monday-based ISO week start for a given date string (YYYY-MM-DD).
 */
function weekStartForDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Fire-and-forget side effects that should run after a session is confirmed-linked
 * to an activity. All errors are logged but never thrown — callers should not
 * block on this.
 *
 * Triggers:
 * 1. Session verdict generation (AI) → adaptation rationale → session comparison
 * 2. Weekly debrief refresh for the session's week
 */
export async function postSessionSyncSideEffects(args: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  activityId: string;
  /** ISO date (YYYY-MM-DD) of the session, used to determine which week's debrief to refresh. */
  sessionDate?: string | null;
}): Promise<void> {
  const effects: Promise<void>[] = [
    generateVerdictChain(args.supabase, args.userId, args.sessionId),
    refreshDebriefForSession(args.supabase, args.userId, args.sessionDate ?? null),
  ];

  await Promise.allSettled(effects);
}

/**
 * Variant for "extra" (unplanned) activities — only refreshes the weekly debrief
 * since extra activities don't have a planned session to verdict against.
 */
export async function postExtraSyncSideEffects(args: {
  supabase: SupabaseClient;
  userId: string;
  activityDate?: string | null;
}): Promise<void> {
  await refreshDebriefForSession(args.supabase, args.userId, args.activityDate ?? null).catch((e) => {
    console.error("[post-sync] Debrief refresh after extra activity failed:", e);
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function generateVerdictChain(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<void> {
  try {
    const { verdict, activityId } = await generateSessionVerdict(supabase, userId, sessionId);

    const { data: saved } = await supabase.from("session_verdicts").upsert(
      {
        user_id: userId,
        session_id: sessionId,
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
        discipline: "other",
        raw_ai_response: verdict as unknown as Record<string, unknown>,
        ai_model_used: getCoachModel(),
        ai_prompt_version: "v1",
      },
      { onConflict: "session_id" },
    ).select("id").maybeSingle();

    // Update discipline from session data
    if (saved) {
      const { data: session } = await supabase
        .from("sessions")
        .select("sport")
        .eq("id", sessionId)
        .maybeSingle();
      if (session?.sport) {
        await supabase
          .from("session_verdicts")
          .update({ discipline: session.sport })
          .eq("id", saved.id);
      }
    }

    // Adaptation rationale for modify/redistribute verdicts
    if (verdict.adaptation_type === "modify" || verdict.adaptation_type === "redistribute") {
      try {
        const { data: sessionData } = await supabase
          .from("sessions")
          .select("session_name, type, sport")
          .eq("id", sessionId)
          .maybeSingle();
        const sessionName = sessionData?.session_name ?? sessionData?.type ?? "Session";
        await createRationaleFromVerdict(supabase, userId, {
          session_id: sessionId,
          verdict_status: verdict.verdict_status,
          adaptation_type: verdict.adaptation_type,
          adaptation_signal: verdict.adaptation_signal,
          affected_session_ids: verdict.affected_session_ids ?? null,
          discipline: sessionData?.sport ?? "other",
          purpose_statement: verdict.purpose_statement,
          id: saved?.id,
        }, sessionName);
      } catch (rationaleError) {
        console.error("[post-sync] Rationale generation failed:", rationaleError);
      }
    }

    // Session comparison (fire-and-forget)
    triggerComparisonAfterVerdict(supabase, sessionId, userId).catch((e) => {
      console.warn("[post-sync] Comparison trigger failed:", e);
    });
  } catch (e) {
    console.error("[post-sync] Verdict chain failed for session", sessionId, e);
  }
}

async function refreshDebriefForSession(
  supabase: SupabaseClient,
  userId: string,
  sessionDate: string | null,
): Promise<void> {
  try {
    const weekStart = sessionDate ? weekStartForDate(sessionDate) : getCurrentWeekStart();

    const { data: { user } } = await supabase.auth.getUser();
    const timeZone =
      (user?.user_metadata && typeof user.user_metadata.timezone === "string" && user.user_metadata.timezone) ||
      "UTC";
    const todayIso = localIsoDate(new Date().toISOString(), timeZone);

    await refreshWeeklyDebrief({
      supabase,
      athleteId: userId,
      weekStart,
      timeZone,
      todayIso,
    });
  } catch (e) {
    console.error("[post-sync] Weekly debrief refresh failed:", e);
  }
}

function tryParseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}
