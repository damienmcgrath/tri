/**
 * Dynamic context assembly for coach conversations.
 *
 * Instead of loading all context every turn, the assembler selects
 * and fetches only the relevant data slices based on the topic
 * classifier output, and budgets the total context to fit within
 * the model's context window.
 */

import type { ContextSliceConfig } from "./topic-classifier";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ContextSlice = {
  label: string;
  content: string;
  priority: number; // higher = keep first when trimming
  tokens: number; // estimated token count
};

export type AssembledContext = {
  slices: ContextSlice[];
  totalTokens: number;
  trimmed: boolean;
};

// ─── Token estimation ──────────────────────────────────────────────────────

/**
 * Rough token count estimation. Uses the chars/4 heuristic which is
 * reasonable for English text with the OpenAI tokeniser.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Context budgeting ─────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 12_000; // leave room for system prompt + response

/**
 * Budget context slices to fit within a token limit.
 * Higher-priority slices are kept first.
 */
export function budgetContext(
  slices: ContextSlice[],
  maxTokens = DEFAULT_MAX_TOKENS
): AssembledContext {
  const sorted = [...slices].sort((a, b) => b.priority - a.priority);
  const kept: ContextSlice[] = [];
  let total = 0;
  let trimmed = false;

  for (const slice of sorted) {
    if (total + slice.tokens <= maxTokens) {
      kept.push(slice);
      total += slice.tokens;
    } else {
      trimmed = true;
    }
  }

  return { slices: kept, totalTokens: total, trimmed };
}

/**
 * Build a context slice from a label and content string.
 */
export function makeSlice(label: string, content: string, priority: number): ContextSlice {
  return {
    label,
    content,
    priority,
    tokens: estimateTokenCount(content),
  };
}

/**
 * Format assembled context into a single string for the system prompt.
 */
export function formatAssembledContext(assembled: AssembledContext): string {
  if (assembled.slices.length === 0) return "";

  return assembled.slices
    .map((s) => `--- ${s.label} ---\n${s.content}`)
    .join("\n\n");
}

/**
 * Determine which context slices to fetch based on the config.
 * This returns the slice labels that should be assembled.
 * The actual data fetching happens in chat-flow.ts using existing tool handlers.
 */
export function getRequiredSliceLabels(config: ContextSliceConfig): string[] {
  const labels: string[] = [];

  if (config.includeRecentVerdicts) labels.push("recent_verdicts");
  if (config.includeRecentFeels) labels.push("recent_feels");
  if (config.includeTrainingScore) labels.push("training_score");
  if (config.includeUpcomingSessions) labels.push("upcoming_sessions");
  if (config.includeWeeklyDebrief) labels.push("weekly_debrief");
  if (config.includeDisciplineBalance) labels.push("discipline_balance");
  if (config.includeSeasonContext) labels.push("season_context");
  if (config.includeComparisonTrends) labels.push("comparison_trends");
  if (config.includeMorningBrief) labels.push("morning_brief");
  if (config.includePastConversations) labels.push("past_conversations");

  return labels;
}
