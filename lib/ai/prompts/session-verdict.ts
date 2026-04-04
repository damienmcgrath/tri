import "openai/shims/node";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { getMacroContext } from "@/lib/training/macro-context";

export const SESSION_VERDICT_PROMPT_VERSION = "v1";

// --- Zod schema for AI output ---

const metricComparisonSchema = z.object({
  metric: z.string().min(1).max(60),
  target: z.string().min(1).max(100),
  actual: z.string().min(1).max(100),
  assessment: z.enum(["on_target", "above", "below", "missing"])
});

const deviationSchema = z.object({
  metric: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
  severity: z.enum(["minor", "moderate", "significant"])
});

export const sessionVerdictOutputSchema = z.object({
  purpose_statement: z.string().min(1).max(600),
  training_block_context: z.string().min(1).max(200),
  intended_zones: z.record(z.unknown()).nullable().optional(),
  intended_metrics: z.record(z.unknown()).nullable().optional(),
  execution_summary: z.string().min(1).max(1000),
  verdict_status: z.enum(["achieved", "partial", "missed", "off_target"]),
  metric_comparisons: z.array(metricComparisonSchema).max(10),
  key_deviations: z.array(deviationSchema).max(5).nullable().optional(),
  adaptation_signal: z.string().min(1).max(600),
  adaptation_type: z.enum(["proceed", "flag_review", "modify", "redistribute"]),
  affected_session_ids: z.array(z.string()).max(5).nullable().optional()
});

export type SessionVerdictOutput = z.infer<typeof sessionVerdictOutputSchema>;

// --- Context assembly ---

export type SessionVerdictContext = {
  session: {
    id: string;
    sport: string;
    type: string;
    sessionName: string | null;
    intentCategory: string | null;
    target: string | null;
    notes: string | null;
    durationMinutes: number | null;
    isKey: boolean;
    date: string;
  };
  activity: {
    durationSec: number | null;
    distanceM: number | null;
    avgHr: number | null;
    avgPower: number | null;
    avgPacePer100mSec: number | null;
    metrics: Record<string, unknown> | null;
  } | null;
  executionResult: Record<string, unknown> | null;
  feel: {
    overallFeel: number | null;
    energyLevel: string | null;
    legsFeel: string | null;
    motivation: string | null;
    sleepQuality: string | null;
    lifeStress: string | null;
    note: string | null;
  } | null;
  trainingBlock: {
    currentBlock: string;
    blockWeek: number;
    blockTotalWeeks: number;
    raceName: string | null;
    daysToRace: number | null;
  };
  upcomingSessions: Array<{
    id: string;
    date: string;
    sport: string;
    type: string;
    isKey: boolean;
  }>;
  recentLoadTrend: {
    last7daysTss: number | null;
    last14daysTss: number | null;
    currentCtl: number | null;
    currentAtl: number | null;
    currentTsb: number | null;
  } | null;
};

export async function buildSessionVerdictContext(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<SessionVerdictContext | null> {
  // Fetch session
  const { data: session } = await supabase
    .from("sessions")
    .select("id, sport, type, session_name, intent_category, target, notes, duration_minutes, is_key, date, plan_id, week_id, execution_result, status")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!session) return null;

  // Fetch linked activity
  const { data: links } = await supabase
    .from("session_activity_links")
    .select("activity_id")
    .eq("session_id", sessionId);

  let activity: SessionVerdictContext["activity"] = null;
  const activityId = links?.[0]?.activity_id;
  if (activityId) {
    const { data: act } = await supabase
      .from("completed_activities")
      .select("duration_sec, distance_m, avg_hr, avg_power, avg_pace_per_100m_sec, metrics_v2, execution_result")
      .eq("id", activityId)
      .maybeSingle();
    if (act) {
      activity = {
        durationSec: act.duration_sec,
        distanceM: act.distance_m,
        avgHr: act.avg_hr,
        avgPower: act.avg_power,
        avgPacePer100mSec: act.avg_pace_per_100m_sec ?? null,
        metrics: (act.metrics_v2 as Record<string, unknown>) ?? null
      };
    }
  }

  // Fetch feel data
  let feel: SessionVerdictContext["feel"] = null;
  const { data: feelRow } = await supabase
    .from("session_feels")
    .select("overall_feel, energy_level, legs_feel, motivation, sleep_quality, life_stress, note")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (feelRow) {
    feel = {
      overallFeel: feelRow.overall_feel ?? null,
      energyLevel: feelRow.energy_level ?? null,
      legsFeel: feelRow.legs_feel ?? null,
      motivation: feelRow.motivation ?? null,
      sleepQuality: feelRow.sleep_quality ?? null,
      lifeStress: feelRow.life_stress ?? null,
      note: feelRow.note ?? null
    };
  }

  // Fetch macro context
  let trainingBlock: SessionVerdictContext["trainingBlock"] = {
    currentBlock: "Build",
    blockWeek: 1,
    blockTotalWeeks: 1,
    raceName: null,
    daysToRace: null
  };
  try {
    const macro = await getMacroContext(supabase, userId);
    trainingBlock = {
      currentBlock: macro.currentBlock,
      blockWeek: macro.blockWeek,
      blockTotalWeeks: macro.blockTotalWeeks,
      raceName: macro.raceName,
      daysToRace: macro.daysToRace
    };
  } catch {
    // Use defaults
  }

  // Fetch upcoming sessions (next 7 days)
  const sessionDate = session.date as string;
  const endDate = new Date(new Date(sessionDate).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const { data: upcoming } = await supabase
    .from("sessions")
    .select("id, date, sport, type, is_key")
    .eq("user_id", userId)
    .gt("date", sessionDate)
    .lte("date", endDate)
    .eq("status", "planned")
    .order("date")
    .limit(10);

  // Fetch recent training load
  let recentLoadTrend: SessionVerdictContext["recentLoadTrend"] = null;
  try {
    const { data: fitness } = await supabase
      .from("athlete_fitness")
      .select("ctl, atl, tsb")
      .eq("user_id", userId)
      .eq("sport", "total")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const loadStartDate14 = new Date(new Date(sessionDate).getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const loadStartDate7 = new Date(new Date(sessionDate).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const { data: loads14 } = await supabase
      .from("daily_load")
      .select("tss, date")
      .eq("user_id", userId)
      .eq("sport", "total")
      .gte("date", loadStartDate14)
      .lte("date", sessionDate);

    const last7daysTss = loads14?.filter(l => l.date >= loadStartDate7).reduce((s, l) => s + Number(l.tss ?? 0), 0) ?? null;
    const last14daysTss = loads14?.reduce((s, l) => s + Number(l.tss ?? 0), 0) ?? null;

    recentLoadTrend = {
      last7daysTss,
      last14daysTss,
      currentCtl: fitness?.ctl ? Number(fitness.ctl) : null,
      currentAtl: fitness?.atl ? Number(fitness.atl) : null,
      currentTsb: fitness?.tsb ? Number(fitness.tsb) : null
    };
  } catch {
    // Non-critical
  }

  return {
    session: {
      id: session.id,
      sport: session.sport,
      type: session.type,
      sessionName: session.session_name ?? null,
      intentCategory: session.intent_category ?? null,
      target: session.target ?? null,
      notes: session.notes ?? null,
      durationMinutes: session.duration_minutes ?? null,
      isKey: Boolean(session.is_key),
      date: session.date
    },
    activity,
    executionResult: (session.execution_result as Record<string, unknown>) ?? null,
    feel,
    trainingBlock,
    upcomingSessions: (upcoming ?? []).map(s => ({
      id: s.id,
      date: s.date,
      sport: s.sport,
      type: s.type,
      isKey: Boolean(s.is_key)
    })),
    recentLoadTrend
  };
}

// --- AI prompt instructions ---

function buildVerdictInstructions(): string {
  return [
    "You are an expert triathlon coach generating a structured session verdict.",
    "The verdict has three parts: Purpose Statement, Execution Assessment, and Adaptation Signal.",
    "",
    "PART 1 — Purpose Statement:",
    "- Explain the session's physiological intent in plain language.",
    "- Reference the training block context (e.g. 'Week 3 of a 4-week build block').",
    "- Example: 'This was a Z2 aerobic maintenance run designed to build capillary density without accumulating fatigue.'",
    "",
    "PART 2 — Execution Assessment:",
    "- Compare actual metrics against target/expected ranges.",
    "- Flag meaningful deviations with specific numbers.",
    "- For swim: include SWOLF trends, stroke rate, distance per stroke where available.",
    "- For bike: include normalised power, variability index, cadence patterns.",
    "- For run: include pace distribution, cardiac drift analysis, cadence.",
    "- Produce a clear verdict_status: 'achieved' (session achieved its purpose), 'partial' (partially achieved), 'missed' (did not achieve intent), 'off_target' (significantly off).",
    "- Express durations in minutes (e.g. '37 min'). Express run pace as min:sec/km (e.g. '5:41/km'). Never write raw seconds.",
    "",
    "PART 3 — Adaptation Signal:",
    "- State what this means for upcoming training.",
    "- If well-executed: confirm the plan proceeds. Reference specific upcoming sessions.",
    "- If warning signs: flag specific sessions for potential modification.",
    "- If missed/off-target: explain redistribution or recovery implications.",
    "- If feel data contradicts objective metrics, acknowledge the mismatch explicitly.",
    "",
    "Rules:",
    "- Use only provided evidence. Do not invent metrics or facts.",
    "- Speak with direct authority. Do not hedge.",
    "- Keep metric_comparisons to the 3-5 most important metrics.",
    "- Keep key_deviations only for meaningful deviations (not minor noise).",
    "- If evidence is limited, reflect that by keeping recommendations conservative.",
    "- Return exactly one JSON object matching the required schema."
  ].join("\n");
}

// --- Deterministic fallback ---

function buildFallbackVerdict(ctx: SessionVerdictContext): SessionVerdictOutput {
  const sport = ctx.session.sport;
  const intentCategory = ctx.session.intentCategory ?? "general";
  const blockCtx = `Week ${ctx.trainingBlock.blockWeek} of ${ctx.trainingBlock.blockTotalWeeks}-week ${ctx.trainingBlock.currentBlock.toLowerCase()} block`;

  const hasActivity = ctx.activity !== null;
  const status: SessionVerdictOutput["verdict_status"] = hasActivity ? "partial" : "missed";

  return {
    purpose_statement: ctx.session.target
      ? `${ctx.session.sessionName ?? ctx.session.type}: ${ctx.session.target}`
      : `${ctx.session.sessionName ?? ctx.session.type} — ${intentCategory} ${sport} session.`,
    training_block_context: blockCtx,
    intended_zones: null,
    intended_metrics: null,
    execution_summary: hasActivity
      ? "Session data available but AI analysis unavailable. Review the metrics below for a manual assessment."
      : "No activity data linked to this session.",
    verdict_status: status,
    metric_comparisons: [],
    key_deviations: null,
    adaptation_signal: "Unable to generate adaptation signal — AI analysis unavailable. Review manually.",
    adaptation_type: "flag_review",
    affected_session_ids: null
  };
}

// --- Main generation function ---

export async function generateSessionVerdict(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<{ verdict: SessionVerdictOutput; source: "ai" | "fallback"; activityId: string | null }> {
  const ctx = await buildSessionVerdictContext(supabase, userId, sessionId);
  if (!ctx) {
    throw new Error("Session not found or not accessible.");
  }

  const fallback = buildFallbackVerdict(ctx);

  // Get linked activity ID for storage
  const { data: links } = await supabase
    .from("session_activity_links")
    .select("activity_id")
    .eq("session_id", sessionId)
    .limit(1);
  const activityId = links?.[0]?.activity_id ?? null;

  const result = await callOpenAIWithFallback<SessionVerdictOutput>({
    logTag: "session-verdict",
    fallback,
    logContext: { sessionId, userId },
    buildRequest: () => ({
      instructions: buildVerdictInstructions(),
      reasoning: { effort: "medium" },
      max_output_tokens: 2000,
      text: {
        format: zodTextFormat(sessionVerdictOutputSchema, "session_verdict", {
          description: "Structured three-part session verdict."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify(ctx)
            }
          ]
        }
      ]
    }),
    schema: sessionVerdictOutputSchema
  });

  return { verdict: result.value, source: result.source, activityId };
}
