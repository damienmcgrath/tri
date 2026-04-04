/**
 * Suggested questions generator.
 *
 * Generates 3-4 contextual suggested questions based on the athlete's
 * current training state. These appear as tappable pills in the chat UI.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type AthleteState = {
  raceName: string | null;
  daysToRace: number | null;
  readiness: "fresh" | "absorbing" | "fatigued" | "overreaching" | null;
  recentMissedSession: string | null; // session name if recent miss
  fatigueTrend: "rising" | "stable" | "declining" | null;
  hasActiveRebalancingRec: boolean;
  todaysSession: string | null; // upcoming session name
  currentBlock: string | null;
  weeklyCompletion: number | null; // 0-1
};

// ─── Generator ─────────────────────────────────────────────────────────────

/**
 * Generate 3-4 contextual suggested questions.
 * Rules are deterministic and prioritized.
 */
export function generateSuggestedQuestions(state: AthleteState): string[] {
  const questions: Array<{ q: string; priority: number }> = [];

  // After missed session
  if (state.recentMissedSession) {
    questions.push({
      q: `How should I adjust after missing ${state.recentMissedSession}?`,
      priority: 90,
    });
  }

  // High fatigue
  if (state.readiness === "overreaching" || state.readiness === "fatigued") {
    questions.push({
      q: "Should I reduce this week's volume?",
      priority: 85,
    });
  }

  // Discipline balance
  if (state.hasActiveRebalancingRec) {
    questions.push({
      q: "What's my biggest limiter right now?",
      priority: 80,
    });
  }

  // Race-specific
  if (state.raceName && state.daysToRace !== null && state.daysToRace > 0 && state.daysToRace <= 84) {
    questions.push({
      q: `How am I tracking for ${state.raceName}?`,
      priority: 75,
    });
  }

  // Before key session
  if (state.todaysSession) {
    questions.push({
      q: `How should I approach today's ${state.todaysSession}?`,
      priority: 70,
    });
  }

  // Block-level question
  if (state.currentBlock) {
    questions.push({
      q: "Should I adjust this week's plan?",
      priority: 60,
    });
  }

  // Weekly completion check
  if (state.weeklyCompletion !== null && state.weeklyCompletion < 0.6) {
    questions.push({
      q: "How do I salvage this week after missing sessions?",
      priority: 65,
    });
  }

  // General fallbacks
  questions.push(
    { q: "Explain my Training Score", priority: 40 },
    { q: "What should I focus on this week?", priority: 50 },
  );

  // Sort by priority and take top 4
  return questions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 4)
    .map((q) => q.q);
}
