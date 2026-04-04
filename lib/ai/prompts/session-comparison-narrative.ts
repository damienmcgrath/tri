import "openai/shims/node";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";

export const SESSION_COMPARISON_NARRATIVE_PROMPT_VERSION = "v1";

export const sessionComparisonNarrativeSchema = z.object({
  summary: z.string().min(1).max(600),
  trend_direction: z.enum(["improving", "stable", "declining", "insufficient_data"]),
  trend_confidence: z.enum(["high", "moderate", "low"])
});

export type SessionComparisonNarrativeOutput = z.infer<typeof sessionComparisonNarrativeSchema>;

export type ComparisonNarrativeContext = {
  discipline: string;
  sessionType: string;
  weeksApart: number;
  trainingBlock: string;
  metricDeltas: Array<{
    metric: string;
    current: string;
    previous: string;
    delta: string;
    direction: "better" | "worse" | "neutral";
  }>;
};

function buildInstructions(): string {
  return [
    "You are an expert triathlon coach interpreting session comparison data for your athlete.",
    "Generate a coach-like narrative that helps the athlete understand what the comparison means for their training.",
    "",
    "Your summary must:",
    "- Be coach-like, not statistical. Interpret the data, don't just list numbers.",
    '- Explain why the trend matters: "That\'s genuine aerobic improvement, not just a good day."',
    "- Reference specific metrics and what they indicate about fitness.",
    "- Be 1-3 sentences max. Concise and insightful.",
    "- Never use emojis.",
    "",
    "For trend_direction:",
    '- "improving" = meaningful positive change in key metrics',
    '- "stable" = no significant change, which can be fine depending on context',
    '- "declining" = meaningful negative change that warrants attention',
    '- "insufficient_data" = not enough data points to determine trend',
    "",
    "For trend_confidence:",
    '- "high" = multiple metrics agree, clear pattern',
    '- "moderate" = some metrics improving, some stable',
    '- "low" = mixed signals or small sample'
  ].join("\n");
}

function buildInput(ctx: ComparisonNarrativeContext): string {
  const lines = [
    `Discipline: ${ctx.discipline}`,
    `Session type: ${ctx.sessionType}`,
    `Weeks apart: ${ctx.weeksApart}`,
    `Training block: ${ctx.trainingBlock}`,
    "",
    "Metric deltas:"
  ];

  for (const m of ctx.metricDeltas) {
    lines.push(`- ${m.metric}: ${m.previous} → ${m.current} (${m.delta}, ${m.direction})`);
  }

  return lines.join("\n");
}

export async function generateComparisonNarrative(
  ctx: ComparisonNarrativeContext
): Promise<SessionComparisonNarrativeOutput> {
  const betterCount = ctx.metricDeltas.filter((m) => m.direction === "better").length;
  const worseCount = ctx.metricDeltas.filter((m) => m.direction === "worse").length;

  const fallbackDirection =
    betterCount > worseCount
      ? "improving" as const
      : worseCount > betterCount
        ? "declining" as const
        : "stable" as const;

  const fallback: SessionComparisonNarrativeOutput = {
    summary: `Compared to ${ctx.weeksApart} week${ctx.weeksApart > 1 ? "s" : ""} ago: ${betterCount} metric${betterCount !== 1 ? "s" : ""} improved, ${worseCount} declined.`,
    trend_direction: fallbackDirection,
    trend_confidence: "low"
  };

  const result = await callOpenAIWithFallback({
    logTag: "session-comparison-narrative",
    fallback,
    schema: sessionComparisonNarrativeSchema,
    buildRequest: () => ({
      instructions: buildInstructions(),
      input: buildInput(ctx),
      text: {
        format: zodTextFormat(sessionComparisonNarrativeSchema, "session_comparison_narrative")
      }
    }),
    logContext: {
      discipline: ctx.discipline,
      sessionType: ctx.sessionType,
      weeksApart: ctx.weeksApart
    }
  });

  return result.value;
}
