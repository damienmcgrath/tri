import "openai/shims/node";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { getCoachModel } from "@/lib/openai";
import type {
  WeeklyDebriefFacts,
  WeeklyDebriefEvidenceItem,
  WeeklyDebriefActivityEvidence,
  WeeklyDebriefCheckIn
} from "./types";
import type { WeeklyDebriefPriorHeadline } from "./variance-corpus";

export const weeklyFindingsSchema = z.object({
  weekCharacter: z.string().min(1).max(120),
  patterns: z.array(z.object({
    claim: z.string().min(1).max(220),
    evidence: z.string().min(1).max(240)
  })).min(1).max(4),
  primaryInsight: z.object({
    insight: z.string().min(1).max(320),
    sourceSignals: z.array(z.string().min(1).max(80)).min(1).max(4),
    confidence: z.enum(["high", "medium", "low"])
  }),
  tensions: z.array(z.string().min(1).max(220)).max(3),
  carryForwardCandidates: z.array(z.string().min(1).max(280)).min(2).max(3),
  confidenceNote: z.string().min(1).max(220).nullable()
});

export type WeeklyFindings = z.infer<typeof weeklyFindingsSchema>;

const FINDINGS_FALLBACK_SENTINEL: WeeklyFindings = {
  weekCharacter: "unavailable",
  patterns: [{ claim: "unavailable", evidence: "unavailable" }],
  primaryInsight: {
    insight: "unavailable",
    sourceSignals: ["unavailable"],
    confidence: "low"
  },
  tensions: [],
  carryForwardCandidates: ["unavailable", "unavailable"],
  confidenceNote: null
};

const ANALYTIC_INSTRUCTIONS = `You are an analytic pass. Your job is to extract structured findings for an endurance athlete's weekly debrief. A later narrative pass will turn these into prose — you do not write for the athlete, you write for the narrative pass.

Output structured JSON only. No prose, no coach voice.

Goals, ranked:
1. Spot cross-session patterns the athlete would not see by skimming individual reviews (e.g. "every threshold session this week was preceded by fatigue 4+ — execution held but the cost is stacking").
2. Name tensions where signals disagree (e.g. HR suggests easy, RPE suggests hard; composite score up while durability down).
3. Surface ONE primaryInsight — the most important non-obvious finding. It must reference specific numbers, dates, or trends visible in facts/evidence/trendsThisWeek/scoreTrajectory/activityEvidence, and cite which signals grounded it via sourceSignals (e.g. ["decoupling", "historical-comparable", "z2-pace-at-hr"]).
4. Propose 2–3 carryForwardCandidates as complete, self-contained sentences the narrative pass may refine or adopt.
5. Summarise the week in one weekCharacter phrase (≤120 chars) — an archetype the narrative voice can hang off (e.g. "Consolidation week under rising CTL", "Recovery stalled — intensity bled into easy days").
6. confidenceNote: what the analytic pass could not pin down (small sample, missing HR data, only one key session completed, etc.). Null if nothing material.

Hard constraints:
- Every patterns[].evidence must cite at least one specific number, date, or named session from the input.
- primaryInsight.confidence: "high" only if the pattern is supported by ≥3 sessions OR a multi-week trend; "medium" for a 2-session or cross-signal pattern; "low" when the signal is present but under-evidenced.
- Do not repeat claims verbatim across patterns. Distinct patterns only.
- If the week has too few completed sessions to detect a meaningful pattern, say so in primaryInsight.insight and set confidence: "low".
- No hype, no diagnosis, no certainty beyond the data.

Variance (priorHeadlines):
- priorHeadlines is a list of the athlete's most recent weekly debriefs (coachHeadline, executiveSummary, nonObviousInsight, takeawayTitle). Treat it as a "do not repeat" corpus — not as evidence about training.
- weekCharacter, every patterns[].claim, and primaryInsight.insight must avoid reusing the opening phrasings, metaphors, or framings that appear in priorHeadlines. If this week's signals genuinely match a prior pattern, describe the continuation in fresh language rather than restating the previous phrasing.
- Specifically do not echo prior takeawayTitle phrases (e.g. "The week had one clear strength and one clear wobble") inside weekCharacter or primaryInsight.
- Reusing concrete numbers, dates, or session names is fine — only the prose framings must be different.`;

export async function generateAnalyticFindings(args: {
  facts: WeeklyDebriefFacts;
  evidence: WeeklyDebriefEvidenceItem[];
  activityEvidence: WeeklyDebriefActivityEvidence[];
  athleteContext: AthleteContextSnapshot | null;
  checkIn: WeeklyDebriefCheckIn | null;
  recentFeedback?: Array<{ weekStart: string; helpful: boolean | null; accurate: boolean | null; note: string | null }>;
  trendsThisWeek?: Array<{ discipline: string; trend: string; confidence: string; summary: string }> | null;
  scoreTrajectory?: Array<{ date: string; composite: number; execution: number | null; progression: number | null; balance: number | null }> | null;
  priorHeadlines?: WeeklyDebriefPriorHeadline[];
}): Promise<{ findings: WeeklyFindings | null; source: "ai" | "fallback" }> {
  const result = await callOpenAIWithFallback<WeeklyFindings>({
    logTag: "weekly-debrief-findings",
    fallback: FINDINGS_FALLBACK_SENTINEL,
    buildRequest: () => ({
      model: getCoachModel({ deep: true }),
      instructions: ANALYTIC_INSTRUCTIONS,
      reasoning: { effort: "medium" },
      max_output_tokens: 8000,
      text: {
        format: zodTextFormat(weeklyFindingsSchema, "weekly_findings", {
          description: "Structured analytic findings for the weekly debrief narrative pass."
        })
      },
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
                priorHeadlines: args.priorHeadlines && args.priorHeadlines.length > 0 ? args.priorHeadlines : null
              })
            }
          ]
        }
      ]
    }),
    schema: weeklyFindingsSchema
  });

  if (result.source === "fallback") {
    return { findings: null, source: "fallback" };
  }
  return { findings: result.value, source: "ai" };
}
