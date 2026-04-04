import "openai/shims/node";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";

export const ADAPTATION_RATIONALE_PROMPT_VERSION = "v1";

// --- Zod schema for AI output ---

const changeItemSchema = z.object({
  session_id: z.string().nullable().optional(),
  session_label: z.string().min(1).max(120),
  change_type: z.enum(["intensity_reduced", "intensity_increased", "moved", "dropped", "shortened", "extended", "added", "swapped", "unchanged"]),
  before: z.string().min(1).max(200),
  after: z.string().min(1).max(200)
});

export const adaptationRationaleOutputSchema = z.object({
  rationale_text: z.string().min(1).max(800),
  changes_summary: z.array(changeItemSchema).max(8),
  preserved_elements: z.array(z.string().min(1).max(200)).max(5)
});

export type AdaptationRationaleOutput = z.infer<typeof adaptationRationaleOutputSchema>;

// --- Trigger type mapping ---

export type AdaptationRationaleTriggerType =
  | "recovery_signal"
  | "missed_session"
  | "load_rebalance"
  | "cross_discipline"
  | "feel_based"
  | "block_transition"
  | "athlete_request"
  | "schedule_change";

// --- Context ---

export type AdaptationRationaleContext = {
  triggerType: AdaptationRationaleTriggerType;
  triggerData: {
    sourceSessionId?: string;
    sourceSessionName?: string;
    verdictStatus?: string;
    verdictSummary?: string;
    feelData?: Record<string, unknown>;
    missedSessionName?: string;
    customReason?: string;
  };
  affectedSessions: Array<{
    id: string;
    date: string;
    sport: string;
    type: string;
    sessionName: string | null;
    isKey: boolean;
  }>;
  trainingBlock: {
    currentBlock: string;
    blockWeek: number;
    blockTotalWeeks: number;
    weekNumber: number;
  };
  recentVerdicts: Array<{
    sessionName: string;
    verdictStatus: string;
    adaptationType: string | null;
  }>;
};

// --- AI prompt ---

function buildRationaleInstructions(): string {
  return [
    "You are an expert triathlon coach explaining a plan modification to your athlete.",
    "Generate a clear, data-grounded rationale that the athlete sees BEFORE the modified session.",
    "",
    "Your rationale must:",
    "1. Be grounded in specific data — never vague. Reference the trigger (HR data, feel scores, missed sessions, etc.).",
    "2. Explain both what changed AND what was preserved (and why).",
    "3. Be written in first person as the coach ('I moved your intervals because...').",
    "4. Be concise and actionable — max 2-3 sentences for rationale_text.",
    "",
    "Rationale styles by trigger_type:",
    "- recovery_signal: Reference specific recovery metrics (HR, HRV, feel scores).",
    "- missed_session: Explain redistribution of volume/intensity across remaining sessions.",
    "- load_rebalance: Reference weekly/block load targets and where the athlete stands.",
    "- cross_discipline: Explain the discipline ratio tradeoff for the goal race.",
    "- feel_based: Reference the athlete's reported subjective state.",
    "- block_transition: Explain the phase change and what it means for session character.",
    "- athlete_request: Acknowledge the request and explain how the plan accommodates it.",
    "- schedule_change: Explain how sessions shift to fit the new availability.",
    "",
    "For changes_summary: list each session that changed with before/after state.",
    "For preserved_elements: list key elements intentionally kept unchanged and why.",
    "",
    "Rules:",
    "- Use only provided data. Do not invent facts.",
    "- Speak with direct authority. Do not hedge.",
    "- Return exactly one JSON object matching the required schema."
  ].join("\n");
}

// --- Deterministic fallback ---

function buildFallbackRationale(ctx: AdaptationRationaleContext): AdaptationRationaleOutput {
  const triggerLabels: Record<AdaptationRationaleTriggerType, string> = {
    recovery_signal: "Recovery signals suggest adjusting upcoming sessions.",
    missed_session: "A missed session has triggered a plan adjustment to preserve weekly training goals.",
    load_rebalance: "Training load is being rebalanced across the remaining sessions this week.",
    cross_discipline: "Cross-discipline balance has been adjusted for your race profile.",
    feel_based: "Your reported feel data suggests modifying upcoming intensity.",
    block_transition: "This week marks a training block transition — session character will shift.",
    athlete_request: "Plan adjusted based on your request.",
    schedule_change: "Sessions have been rearranged to fit your updated availability."
  };

  return {
    rationale_text: triggerLabels[ctx.triggerType] ?? "Plan has been adjusted.",
    changes_summary: ctx.affectedSessions.map(s => ({
      session_id: s.id,
      session_label: s.sessionName ?? `${s.sport} ${s.type}`,
      change_type: "unchanged" as const,
      before: "Original plan",
      after: "Under review"
    })),
    preserved_elements: ["Key sessions preserved where possible"]
  };
}

// --- Main generation function ---

export async function generateAdaptationRationale(
  ctx: AdaptationRationaleContext
): Promise<{ rationale: AdaptationRationaleOutput; source: "ai" | "fallback" }> {
  const fallback = buildFallbackRationale(ctx);

  const result = await callOpenAIWithFallback<AdaptationRationaleOutput>({
    logTag: "adaptation-rationale",
    fallback,
    logContext: { triggerType: ctx.triggerType },
    buildRequest: () => ({
      instructions: buildRationaleInstructions(),
      reasoning: { effort: "low" },
      max_output_tokens: 1200,
      text: {
        format: zodTextFormat(adaptationRationaleOutputSchema, "adaptation_rationale", {
          description: "Structured adaptation rationale for athlete."
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
    schema: adaptationRationaleOutputSchema
  });

  return { rationale: result.value, source: result.source };
}

// --- Helper: create rationale from verdict ---

export async function createRationaleFromVerdict(
  supabase: SupabaseClient,
  userId: string,
  verdict: {
    session_id: string;
    verdict_status: string;
    adaptation_type: string | null;
    adaptation_signal: string;
    affected_session_ids: string[] | null;
    discipline: string;
    purpose_statement: string;
    id?: string;
  },
  sessionName: string
): Promise<void> {
  if (!verdict.adaptation_type || verdict.adaptation_type === "proceed") return;

  // Map verdict adaptation_type to rationale trigger_type
  const triggerMap: Record<string, AdaptationRationaleTriggerType> = {
    flag_review: "recovery_signal",
    modify: "recovery_signal",
    redistribute: "load_rebalance"
  };
  const triggerType = triggerMap[verdict.adaptation_type] ?? "recovery_signal";

  // Fetch affected sessions
  const affectedIds = verdict.affected_session_ids ?? [];
  let affectedSessions: AdaptationRationaleContext["affectedSessions"] = [];
  if (affectedIds.length > 0) {
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id, date, sport, type, session_name, is_key")
      .in("id", affectedIds);
    affectedSessions = (sessions ?? []).map(s => ({
      id: s.id,
      date: s.date,
      sport: s.sport,
      type: s.type,
      sessionName: s.session_name ?? null,
      isKey: Boolean(s.is_key)
    }));
  }

  // Get macro context for block info
  let trainingBlock = { currentBlock: "Build", blockWeek: 1, blockTotalWeeks: 1, weekNumber: 1 };
  try {
    const { getMacroContext } = await import("@/lib/training/macro-context");
    const macro = await getMacroContext(supabase, userId);
    trainingBlock = {
      currentBlock: macro.currentBlock,
      blockWeek: macro.blockWeek,
      blockTotalWeeks: macro.blockTotalWeeks,
      weekNumber: macro.currentPlanWeek
    };
  } catch {
    // Use defaults
  }

  const ctx: AdaptationRationaleContext = {
    triggerType,
    triggerData: {
      sourceSessionId: verdict.session_id,
      sourceSessionName: sessionName,
      verdictStatus: verdict.verdict_status,
      verdictSummary: verdict.adaptation_signal
    },
    affectedSessions,
    trainingBlock,
    recentVerdicts: []
  };

  const { rationale } = await generateAdaptationRationale(ctx);

  // Delete any existing pending rationale for this verdict before inserting,
  // so regenerating a verdict doesn't accumulate duplicate coach notes
  if (verdict.id) {
    await supabase
      .from("adaptation_rationales")
      .delete()
      .eq("user_id", userId)
      .eq("source_verdict_id", verdict.id)
      .eq("status", "pending");
  }

  // Insert rationale
  await supabase.from("adaptation_rationales").insert({
    user_id: userId,
    trigger_type: triggerType,
    trigger_data: ctx.triggerData,
    rationale_text: rationale.rationale_text,
    changes_summary: rationale.changes_summary,
    preserved_elements: rationale.preserved_elements,
    week_number: trainingBlock.weekNumber,
    training_block: trainingBlock.currentBlock,
    affected_sessions: affectedIds,
    source_verdict_id: verdict.id ?? null,
    status: "pending"
  });
}
