import "openai/shims/node";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";

export const WEEK_TRANSITION_PROMPT_VERSION = "v1";

// --- Zod schema for AI output ---

export const weekTransitionOutputSchema = z.object({
  last_week_takeaway: z.string().min(1).max(400),
  this_week_focus: z.string().min(1).max(400),
  adaptation_context: z.string().max(400).nullable(),
  coaching_prompt: z.string().min(1).max(200)
});

export type WeekTransitionOutput = z.infer<typeof weekTransitionOutputSchema>;

// --- Context ---

export type WeekTransitionContext = {
  priorWeekDebrief: {
    weekLabel: string;
    completionPct: number;
    completedSessions: number;
    plannedSessions: number;
    keySessionsCompleted: number;
    keySessionsTotal: number;
    statusLine: string;
    primaryTakeaway: string;
    factualBullets: string[];
    carryForwardNote: string | null;
  } | null;
  currentWeekSessions: Array<{
    date: string;
    sport: string;
    type: string;
    sessionName: string | null;
    durationMinutes: number;
    isKey: boolean;
  }>;
  trainingBlock: {
    currentBlock: string;
    blockWeek: number;
    blockTotalWeeks: number;
    weekNumber: number;
  };
  pendingRationales: Array<{
    id: string;
    rationaleText: string;
    triggerType: string;
  }>;
  athleteName: string | null;
};

// --- AI prompt ---

function buildInstructions(): string {
  return [
    "You are an expert triathlon coach generating a Monday morning transitional briefing for your athlete.",
    "This briefing bridges last week and the coming week. It should feel like a calm, knowledgeable coach checking in.",
    "",
    "Generate a JSON object with these fields:",
    '- last_week_takeaway: 1-2 sentences summarizing the key outcome of the prior week. Reference specific sessions or metrics.',
    '- this_week_focus: 1-2 sentences describing what matters most this week. Mention the key sessions by day.',
    '- adaptation_context: If there are pending adaptation rationales, briefly explain them. Null if none.',
    '- coaching_prompt: An open-ended question to the athlete (max 200 chars). e.g. "How are you feeling heading into the week?"',
    "",
    "Guidelines:",
    "- Be concise and coach-like, not clinical or chatbot-like.",
    "- Reference specific data: session names, completion counts, trends.",
    "- If the prior week is missing (no debrief), focus entirely on the coming week.",
    "- Never use emojis.",
    "- The coaching_prompt should invite useful information, not be generic."
  ].join("\n");
}

function buildInput(ctx: WeekTransitionContext): string {
  const lines: string[] = [];

  if (ctx.priorWeekDebrief) {
    const d = ctx.priorWeekDebrief;
    lines.push("## Last Week");
    lines.push(`${d.weekLabel}: ${d.statusLine}`);
    lines.push(`Sessions: ${d.completedSessions}/${d.plannedSessions} completed (${d.completionPct}%)`);
    lines.push(`Key sessions: ${d.keySessionsCompleted}/${d.keySessionsTotal}`);
    lines.push(`Primary takeaway: ${d.primaryTakeaway}`);
    if (d.factualBullets.length > 0) {
      lines.push(`Facts: ${d.factualBullets.join("; ")}`);
    }
    if (d.carryForwardNote) {
      lines.push(`Carry-forward: ${d.carryForwardNote}`);
    }
  } else {
    lines.push("## Last Week");
    lines.push("No debrief available for the prior week.");
  }

  lines.push("");
  lines.push("## This Week");
  lines.push(`Training block: ${ctx.trainingBlock.currentBlock}, Week ${ctx.trainingBlock.blockWeek} of ${ctx.trainingBlock.blockTotalWeeks}`);

  if (ctx.currentWeekSessions.length === 0) {
    lines.push("No sessions planned this week.");
  } else {
    for (const session of ctx.currentWeekSessions) {
      const keyLabel = session.isKey ? " [KEY]" : "";
      lines.push(`- ${session.date} ${session.sport} ${session.sessionName ?? session.type} (${session.durationMinutes}min)${keyLabel}`);
    }
  }

  if (ctx.pendingRationales.length > 0) {
    lines.push("");
    lines.push("## Pending Adaptations");
    for (const r of ctx.pendingRationales) {
      lines.push(`- ${r.triggerType}: ${r.rationaleText.slice(0, 200)}`);
    }
  }

  return lines.join("\n");
}

// --- Generate ---

export async function generateWeekTransitionBriefingAI(
  ctx: WeekTransitionContext
): Promise<WeekTransitionOutput> {
  const fallback: WeekTransitionOutput = {
    last_week_takeaway: ctx.priorWeekDebrief
      ? `Last week: ${ctx.priorWeekDebrief.completedSessions}/${ctx.priorWeekDebrief.plannedSessions} sessions completed.`
      : "No prior week data available.",
    this_week_focus: ctx.currentWeekSessions.length > 0
      ? `${ctx.currentWeekSessions.length} sessions planned this week in ${ctx.trainingBlock.currentBlock} phase.`
      : "No sessions planned this week.",
    adaptation_context: ctx.pendingRationales.length > 0
      ? `${ctx.pendingRationales.length} adaptation(s) pending review.`
      : null,
    coaching_prompt: "How are you feeling heading into the week?"
  };

  const result = await callOpenAIWithFallback({
    logTag: "week-transition-briefing",
    fallback,
    schema: weekTransitionOutputSchema,
    buildRequest: () => ({
      instructions: buildInstructions(),
      input: buildInput(ctx),
      text: {
        format: zodTextFormat(weekTransitionOutputSchema, "week_transition_briefing")
      }
    }),
    logContext: {
      weekStart: ctx.currentWeekSessions[0]?.date ?? "unknown",
      hasDebrief: Boolean(ctx.priorWeekDebrief)
    }
  });

  return result.value;
}
