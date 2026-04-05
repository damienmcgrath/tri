/**
 * Topic classifier for coach conversations.
 *
 * Classifies athlete messages into intent categories to determine
 * which context slices to assemble for the coaching response.
 * Uses keyword-based classification first, with AI fallback for ambiguous cases.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type TopicCategory =
  | "session_review"
  | "plan_question"
  | "adaptation_request"
  | "fatigue_concern"
  | "race_prep"
  | "general_question"
  | "performance_analysis"
  | "discipline_balance";

export type TopicClassification = {
  primary: TopicCategory;
  secondary: TopicCategory | null;
  confidence: "high" | "medium" | "low";
};

export type ContextSliceConfig = {
  includeRecentVerdicts: boolean;
  includeRecentFeels: boolean;
  includeTrainingScore: boolean;
  includeUpcomingSessions: boolean;
  includeWeeklyDebrief: boolean;
  includeDisciplineBalance: boolean;
  includeSeasonContext: boolean;
  includeComparisonTrends: boolean;
  includeMorningBrief: boolean;
  includePastConversations: boolean;
  maxConversationHistory: number; // how many prior messages to include
};

// ─── Keyword patterns ──────────────────────────────────────────────────────

const PATTERNS: Array<{ category: TopicCategory; keywords: RegExp }> = [
  {
    category: "session_review",
    keywords: /\b(session|workout|today['']?s|yesterday['']?s|this morning|last run|last swim|last ride|long run|threshold|interval|tempo|how did|review|execution)\b/i,
  },
  {
    category: "fatigue_concern",
    keywords: /\b(tired|fatigue[d]?|exhausted|sore|recovery|overreaching|burned out|rest|sleep|under[- ]?recovered|need a break|too much)\b/i,
  },
  {
    category: "adaptation_request",
    keywords: /\b(change|swap|move|adjust|modify|reschedule|cancel|skip|replace|add a session|remove|shorten|lengthen|plan change)\b/i,
  },
  {
    category: "race_prep",
    keywords: /\b(race|taper|peak|race day|race week|pacing|goal time|target time|finish time|race strategy|race plan|weeks? (to|until|before))\b/i,
  },
  {
    category: "discipline_balance",
    keywords: /\b(balance|limiter|swim.*(vs|versus|or).*bike|bike.*(vs|versus|or).*run|distribution|over.?invest|under.?invest|too much (swim|bike|run)|not enough (swim|bike|run)|weakest|strongest)\b/i,
  },
  {
    category: "performance_analysis",
    keywords: /\b(trend|progress|improving|declining|plateau|score|ftp|power|pace|heart rate|hr|cadence|compare|comparison|tracking|how am i)\b/i,
  },
  {
    category: "plan_question",
    keywords: /\b(this week|next week|upcoming|what['']?s planned|schedule|block|phase|base|build|what should i)\b/i,
  },
];

// ─── Classification ────────────────────────────────────────────────────────

/**
 * Classify an athlete's message into topic categories.
 * Uses keyword matching. No AI call needed for most messages.
 */
export function classifyTopic(message: string): TopicClassification {
  const matches: Array<{ category: TopicCategory; score: number }> = [];

  for (const pattern of PATTERNS) {
    const match = message.match(pattern.keywords);
    if (match) {
      // Score by match position (earlier = more likely the main topic)
      const position = match.index ?? message.length;
      const score = 1 - position / message.length;
      matches.push({ category: pattern.category, score });
    }
  }

  if (matches.length === 0) {
    return {
      primary: "general_question",
      secondary: null,
      confidence: "low",
    };
  }

  matches.sort((a, b) => b.score - a.score);
  const primary = matches[0]!;
  const secondary = matches.length > 1 ? matches[1]! : null;

  return {
    primary: primary.category,
    secondary: secondary?.category ?? null,
    confidence: matches.length >= 2 && primary.score > 0.5 ? "high" : "medium",
  };
}

/**
 * Select context slices based on topic classification.
 */
export function selectContextSlices(classification: TopicClassification): ContextSliceConfig {
  const base: ContextSliceConfig = {
    includeRecentVerdicts: false,
    includeRecentFeels: false,
    includeTrainingScore: false,
    includeUpcomingSessions: false,
    includeWeeklyDebrief: false,
    includeDisciplineBalance: false,
    includeSeasonContext: false,
    includeComparisonTrends: false,
    includeMorningBrief: false,
    includePastConversations: false,
    maxConversationHistory: 10,
  };

  const topics = [classification.primary, classification.secondary].filter(Boolean) as TopicCategory[];

  for (const topic of topics) {
    switch (topic) {
      case "session_review":
        base.includeRecentVerdicts = true;
        base.includeRecentFeels = true;
        break;
      case "fatigue_concern":
        base.includeRecentFeels = true;
        base.includeRecentVerdicts = true;
        base.includeTrainingScore = true;
        break;
      case "adaptation_request":
        base.includeUpcomingSessions = true;
        base.includeRecentVerdicts = true;
        base.includeSeasonContext = true;
        break;
      case "race_prep":
        base.includeSeasonContext = true;
        base.includeTrainingScore = true;
        base.includeComparisonTrends = true;
        base.includeDisciplineBalance = true;
        break;
      case "discipline_balance":
        base.includeDisciplineBalance = true;
        base.includeComparisonTrends = true;
        base.includeSeasonContext = true;
        break;
      case "performance_analysis":
        base.includeTrainingScore = true;
        base.includeComparisonTrends = true;
        base.includeRecentVerdicts = true;
        break;
      case "plan_question":
        base.includeUpcomingSessions = true;
        base.includeWeeklyDebrief = true;
        base.includeMorningBrief = true;
        base.includeSeasonContext = true;
        break;
      case "general_question":
        base.includeTrainingScore = true;
        base.includeRecentVerdicts = true;
        base.includeUpcomingSessions = true;
        base.includePastConversations = true;
        base.maxConversationHistory = 12;
        break;
    }
  }

  return base;
}
