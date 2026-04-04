import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import type {
  WeeklyDebriefFacts,
  WeeklyDebriefNarrative,
  WeeklyDebriefEvidenceItem,
  WeeklyDebriefActivityEvidence,
  WeeklyDebriefCheckIn
} from "./types";
import { weeklyDebriefNarrativeSchema } from "./types";
import { normalizeNarrativePayload, hydrateNarrativePayload } from "./deterministic";

export async function generateNarrative(args: {
  facts: WeeklyDebriefFacts;
  evidence: WeeklyDebriefEvidenceItem[];
  activityEvidence: WeeklyDebriefActivityEvidence[];
  athleteContext: AthleteContextSnapshot | null;
  checkIn: WeeklyDebriefCheckIn | null;
  deterministicFallback: WeeklyDebriefNarrative;
  recentFeedback?: Array<{ weekStart: string; helpful: boolean | null; accurate: boolean | null; note: string | null }>;
  trendsThisWeek?: Array<{ discipline: string; trend: string; confidence: string; summary: string }> | null;
  scoreTrajectory?: Array<{ date: string; composite: number; execution: number | null; progression: number | null; balance: number | null }> | null;
}) {
  // Build calibration note from recent feedback
  let calibrationNote = "";
  if (args.recentFeedback && args.recentFeedback.length > 0) {
    const inaccurateCount = args.recentFeedback.filter((f) => f.accurate === false).length;
    const unhelpfulCount = args.recentFeedback.filter((f) => f.helpful === false).length;
    const notes = args.recentFeedback.filter((f) => f.note).map((f) => f.note);
    if (inaccurateCount > 0 || unhelpfulCount > 0) {
      calibrationNote = ` CALIBRATION: The athlete rated ${inaccurateCount} of the last ${args.recentFeedback.length} debriefs as inaccurate and ${unhelpfulCount} as unhelpful. Be more conservative in claims and stick closer to the data.`;
      if (notes.length > 0) {
        calibrationNote += ` Athlete notes: ${notes.slice(0, 2).join("; ")}.`;
      }
    }
  }

  const result = await callOpenAIWithFallback<WeeklyDebriefNarrative>({
    logTag: "weekly-debrief",
    fallback: args.deterministicFallback,
    buildRequest: () => ({
      instructions:
        "You write Weekly Debrief copy for endurance athletes. Use only the provided facts and evidence. Be calm, precise, coach-like, and proportionate to evidence. Read the sport-specific activityEvidence closely: for runs, prioritize splits, HR drift, pace fade, elevation, and zone context over lap-by-lap narration; for swims, prioritize rep structure, rest, pool context, stroke metrics, and second-half fade over generic summary; for rides, prioritize power, load, cadence, and execution control. Distinguish facts, observations, and carry-forward suggestions. Avoid hype, diagnosis, and certainty beyond the data. If trendsThisWeek is provided, weave relevant session-over-session trends into observations (e.g. 'Your threshold run shows steady improvement over the last 3 weeks'). If scoreTrajectory is provided, reference the composite Training Score trajectory where it adds insight (e.g. score direction, which dimension is strongest/weakest). Do not over-emphasise scores — use them to contextualise, not replace, the evidence-based narrative. carryForward items must be complete, self-contained sentences — do not end mid-thought. Each carryForward item has a 280-character limit; use the full space when needed but always end with a complete sentence. Return valid JSON only with executiveSummary, highlights, observations, carryForward." + calibrationNote,
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify({
                facts: args.facts,
                evidence: args.evidence,
                activityEvidence: args.activityEvidence,
                athleteContext: args.athleteContext ? {
                  weeklyState: args.athleteContext.weeklyState,
                  declared: {
                    weeklyConstraints: args.athleteContext.declared.weeklyConstraints,
                    limiters: args.athleteContext.declared.limiters.slice(0, 3).map((limiter) => limiter.value)
                  }
                } : null,
                checkIn: args.checkIn ? {
                  fatigue: args.checkIn.fatigueScore,
                  stress: args.checkIn.stressScore,
                  motivation: args.checkIn.motivationScore,
                  notes: args.checkIn.weekNotes
                } : null,
                recentFeedback: args.recentFeedback ?? null,
                trendsThisWeek: args.trendsThisWeek ?? null,
                scoreTrajectory: args.scoreTrajectory ?? null,
              })
            }
          ]
        }
      ]
    }),
    schema: weeklyDebriefNarrativeSchema,
    normalizePayload: (raw) =>
      hydrateNarrativePayload(normalizeNarrativePayload(raw), args.deterministicFallback)
  });

  return { narrative: result.value, source: result.source };
}
