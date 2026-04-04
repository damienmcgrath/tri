import "openai/shims/node";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";

export const MORNING_BRIEF_PROMPT_VERSION = "v1";

export const morningBriefOutputSchema = z.object({
  session_preview: z.string().max(300).nullable(),
  readiness_context: z.string().max(300).nullable(),
  week_context: z.string().min(1).max(200),
  pending_actions: z.array(z.string().max(120)).max(4),
  brief_text: z.string().min(1).max(800)
});

export type MorningBriefOutput = z.infer<typeof morningBriefOutputSchema>;

export type MorningBriefContext = {
  todaySession: {
    sport: string;
    type: string;
    sessionName: string | null;
    durationMinutes: number;
    target: string | null;
    isKey: boolean;
    notes: string | null;
  } | null;
  isRestDay: boolean;
  recentFeels: Array<{
    overallFeel: number;
    energyLevel: string | null;
    legsFeel: string | null;
    sleepQuality: string | null;
    lifeStress: string | null;
    note: string | null;
    date: string;
  }>;
  recentVerdicts: Array<{
    sessionName: string;
    verdictStatus: string;
    discipline: string;
    date: string;
  }>;
  weekCompletion: {
    completed: number;
    planned: number;
    weekLabel: string;
  };
  trainingBlock: {
    currentBlock: string;
    blockWeek: number;
    blockTotalWeeks: number;
  };
  pendingRationales: number;
  unreviewedDebriefs: number;
  athleteName: string | null;
};

function buildInstructions(): string {
  return [
    "You are a calm, knowledgeable triathlon coach writing a morning check-in for your athlete.",
    "Write 3-5 short lines max. Not a wall of text — a crisp coaching check-in.",
    "",
    "Generate a JSON object with:",
    "- session_preview: Today's session focus (null if rest day with nothing to say)",
    "- readiness_context: Recovery/readiness observation based on feel data (null if insufficient data)",
    "- week_context: Where they are in the week (always present)",
    "- pending_actions: Array of actionable items (e.g. '1 adaptation to review')",
    "- brief_text: The full assembled brief as the athlete sees it (3-5 lines)",
    "",
    "Guidelines:",
    "- Sound like a human coach, not a chatbot or notification system.",
    "- On rest days, still provide a coaching touchpoint.",
    "- Reference specific sessions, feel trends, and training position.",
    "- Never use emojis.",
    "- Keep it warm but professional. No forced enthusiasm.",
    "- If reporting feel trends, name the specific signals (e.g. 'sleep has been poor')."
  ].join("\n");
}

function buildInput(ctx: MorningBriefContext): string {
  const lines: string[] = [];

  if (ctx.todaySession) {
    const s = ctx.todaySession;
    lines.push("## Today's Session");
    lines.push(`${s.sport} — ${s.sessionName ?? s.type} (${s.durationMinutes} min)${s.isKey ? " [KEY]" : ""}`);
    if (s.target) lines.push(`Target: ${s.target}`);
    if (s.notes) lines.push(`Notes: ${s.notes.slice(0, 200)}`);
  } else {
    lines.push("## Today");
    lines.push(ctx.isRestDay ? "Rest day — no session planned." : "No session scheduled.");
  }

  if (ctx.recentFeels.length > 0) {
    lines.push("");
    lines.push("## Recent Feel Data (last 5)");
    for (const f of ctx.recentFeels.slice(0, 5)) {
      const parts = [`${f.date}: Overall ${f.overallFeel}/5`];
      if (f.energyLevel) parts.push(`Energy: ${f.energyLevel}`);
      if (f.legsFeel) parts.push(`Legs: ${f.legsFeel}`);
      if (f.sleepQuality) parts.push(`Sleep: ${f.sleepQuality}`);
      if (f.lifeStress) parts.push(`Stress: ${f.lifeStress}`);
      lines.push(`- ${parts.join(" | ")}`);
      if (f.note) lines.push(`  Note: "${f.note}"`);
    }
  }

  if (ctx.recentVerdicts.length > 0) {
    lines.push("");
    lines.push("## Recent Session Verdicts");
    for (const v of ctx.recentVerdicts.slice(0, 5)) {
      lines.push(`- ${v.date}: ${v.sessionName} (${v.discipline}) → ${v.verdictStatus}`);
    }
  }

  lines.push("");
  lines.push("## Week Status");
  lines.push(`${ctx.weekCompletion.weekLabel}: ${ctx.weekCompletion.completed}/${ctx.weekCompletion.planned} sessions completed`);
  lines.push(`Training block: ${ctx.trainingBlock.currentBlock}, Week ${ctx.trainingBlock.blockWeek} of ${ctx.trainingBlock.blockTotalWeeks}`);

  if (ctx.pendingRationales > 0) {
    lines.push(`Pending adaptations: ${ctx.pendingRationales}`);
  }
  if (ctx.unreviewedDebriefs > 0) {
    lines.push(`Unreviewed weekly debriefs: ${ctx.unreviewedDebriefs}`);
  }

  return lines.join("\n");
}

export async function generateMorningBriefAI(
  ctx: MorningBriefContext
): Promise<MorningBriefOutput> {
  const sessionLine = ctx.todaySession
    ? `Today: ${ctx.todaySession.sessionName ?? ctx.todaySession.type} (${ctx.todaySession.durationMinutes} min ${ctx.todaySession.sport}).`
    : "No session today.";
  const weekLine = `Session ${ctx.weekCompletion.completed + 1} of ${ctx.weekCompletion.planned} this week.`;

  const fallback: MorningBriefOutput = {
    session_preview: ctx.todaySession ? sessionLine : null,
    readiness_context: null,
    week_context: weekLine,
    pending_actions: ctx.pendingRationales > 0
      ? [`${ctx.pendingRationales} adaptation${ctx.pendingRationales > 1 ? "s" : ""} to review`]
      : [],
    brief_text: [sessionLine, weekLine].filter(Boolean).join(" ")
  };

  const result = await callOpenAIWithFallback({
    logTag: "morning-brief",
    fallback,
    schema: morningBriefOutputSchema,
    buildRequest: () => ({
      instructions: buildInstructions(),
      input: buildInput(ctx),
      text: {
        format: zodTextFormat(morningBriefOutputSchema, "morning_brief")
      }
    }),
    logContext: {
      hasSession: Boolean(ctx.todaySession),
      feelCount: ctx.recentFeels.length,
      verdictCount: ctx.recentVerdicts.length
    }
  });

  return result.value;
}
