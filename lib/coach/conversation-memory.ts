/**
 * Conversation memory: summarization and cross-conversation retrieval.
 *
 * Generates summaries of conversations for long-term memory,
 * and retrieves relevant past conversations based on topic similarity.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TopicCategory } from "./topic-classifier";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConversationSummary = {
  id: string;
  conversationId: string;
  summary: string;
  keyTopics: string[];
  keyDecisions: string[];
  createdAt: string;
};

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

// ─── Summary generation ────────────────────────────────────────────────────

/**
 * Generate a concise summary of a conversation.
 * Uses deterministic extraction (no AI call) for speed.
 */
export function generateConversationSummarySync(messages: ConversationMessage[]): {
  summary: string;
  keyTopics: string[];
  keyDecisions: string[];
} {
  if (messages.length === 0) {
    return { summary: "Empty conversation", keyTopics: [], keyDecisions: [] };
  }

  // Extract the first user message as the conversation topic
  const firstUserMsg = messages.find((m) => m.role === "user")?.content ?? "";
  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";

  // Build summary from first question + last answer
  const topicPreview = firstUserMsg.slice(0, 120).replace(/\n/g, " ");
  const answerPreview = lastAssistantMsg.slice(0, 120).replace(/\n/g, " ");

  const summary = `Asked about: ${topicPreview}${answerPreview ? `. Coach responded: ${answerPreview}` : ""}`;

  // Extract key topics from user messages
  const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content);
  const keyTopics = extractTopics(userMessages.join(" "));

  // Look for decisions (keywords in assistant messages)
  const assistantText = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .join(" ");
  const keyDecisions = extractDecisions(assistantText);

  return { summary, keyTopics, keyDecisions };
}

/**
 * Determine if a conversation should be summarized.
 * Heuristic: summarize when there are 6+ message pairs.
 */
export function shouldSummarize(messageCount: number, hasExistingSummary: boolean): boolean {
  return messageCount >= 12 && !hasExistingSummary;
}

// ─── Retrieval ─────────────────────────────────────────────────────────────

/**
 * Retrieve relevant past conversation summaries for the current topic.
 */
export async function getRelevantPastConversations(
  supabase: SupabaseClient,
  userId: string,
  topic: TopicCategory,
  limit = 3
): Promise<ConversationSummary[]> {
  // Simple approach: query summaries that contain topic-related keywords
  const topicKeywords = TOPIC_SEARCH_TERMS[topic] ?? [];

  if (topicKeywords.length === 0) {
    // Fallback: return most recent summaries
    const { data } = await supabase
      .from("conversation_summaries")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    return (data ?? []).map(mapSummaryRow);
  }

  // Search by topic overlap
  const { data } = await supabase
    .from("conversation_summaries")
    .select("*")
    .eq("user_id", userId)
    .overlaps("key_topics", topicKeywords)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map(mapSummaryRow);
}

/**
 * Persist a conversation summary.
 */
export async function persistConversationSummary(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  summary: { summary: string; keyTopics: string[]; keyDecisions: string[] }
): Promise<void> {
  await supabase.from("conversation_summaries").upsert(
    {
      user_id: userId,
      athlete_id: userId,
      conversation_id: conversationId,
      summary: summary.summary,
      key_topics: summary.keyTopics,
      key_decisions: summary.keyDecisions,
    },
    { onConflict: "conversation_id" }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const TOPIC_SEARCH_TERMS: Partial<Record<TopicCategory, string[]>> = {
  session_review: ["session", "workout", "run", "swim", "bike", "execution"],
  fatigue_concern: ["fatigue", "tired", "recovery", "rest", "overreaching"],
  adaptation_request: ["change", "adjust", "modify", "plan"],
  race_prep: ["race", "taper", "peak", "goal"],
  discipline_balance: ["balance", "limiter", "distribution"],
  performance_analysis: ["trend", "progress", "score", "pace", "power"],
};

function extractTopics(text: string): string[] {
  const topics: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["session", /\b(session|workout|run|swim|bike|ride)\b/i],
    ["fatigue", /\b(tired|fatigue|recovery|rest)\b/i],
    ["plan", /\b(plan|schedule|week|block)\b/i],
    ["race", /\b(race|taper|peak|goal)\b/i],
    ["balance", /\b(balance|limiter|distribution)\b/i],
    ["performance", /\b(trend|progress|score|pace|power)\b/i],
  ];

  for (const [topic, regex] of patterns) {
    if (regex.test(text)) topics.push(topic);
  }

  return topics.slice(0, 5);
}

function extractDecisions(text: string): string[] {
  const decisions: string[] = [];
  const patterns = [
    /I['']ll (move|change|adjust|reduce|add|extend|shorten) .{10,80}/gi,
    /(?:recommend|suggest|propose) (?:that |you )?(?:we |you )?(.{10,80})/gi,
    /Applied: (.{10,60})/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      decisions.push((match[1] ?? match[0]).trim().slice(0, 120));
    }
  }

  return decisions.slice(0, 5);
}

function mapSummaryRow(row: any): ConversationSummary {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    summary: row.summary,
    keyTopics: row.key_topics ?? [],
    keyDecisions: row.key_decisions ?? [],
    createdAt: row.created_at,
  };
}
