import type { AthleteContextSnapshot } from "@/lib/athlete-context";
import { zodTextFormat } from "openai/helpers/zod";
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
import type { WeeklyFindings } from "./analytic-findings";

const SINGLE_PASS_INSTRUCTIONS = "You write Weekly Debrief copy for endurance athletes. Use only the provided facts and evidence. Be calm, precise, coach-like, and proportionate to evidence. Read the sport-specific activityEvidence closely: for runs, prioritize splits, HR drift, pace fade, elevation, and zone context over lap-by-lap narration; for swims, prioritize rep structure, rest, pool context, stroke metrics, and second-half fade over generic summary; for rides, prioritize power, load, cadence, and execution control. Distinguish facts, observations, and carry-forward suggestions. Avoid hype, diagnosis, and certainty beyond the data. If trendsThisWeek is provided, weave relevant session-over-session trends into observations (e.g. 'Your threshold run shows steady improvement over the last 3 weeks'). If scoreTrajectory is provided, reference the composite Training Score trajectory where it adds insight (e.g. score direction, which dimension is strongest/weakest). Do not over-emphasise scores — use them to contextualise, not replace, the evidence-based narrative. carryForward items must be complete, self-contained sentences — do not end mid-thought. Each carryForward item has a 280-character limit; use the full space when needed but always end with a complete sentence.\n" +
  "\n" +
  "nonObviousInsight (≤360 chars, required): surface one cross-session pattern the athlete would not see by skimming individual reviews — e.g. 'Every hard session this week was preceded by a poor sleep rating (2/5) — execution is holding but recovery signals are stacking.' or 'Threshold power has held the same 260W ceiling for three weeks while HR at that power has dropped 4bpm — aerobic base is expanding under the ceiling.' Ground every claim in a specific number, date, or trend visible in the facts/evidence/trendsThisWeek/scoreTrajectory. Do not repeat the executiveSummary. If no cross-session signal emerges, say so honestly ('Too few completed sessions this week to surface a cross-session pattern; focus on next week for a trend read.').\n" +
  "\n" +
  "Voice variance: avoid opening phrasings you have used in prior weeks (if recentFeedback or prior headlines are visible in the context, do not reuse them). Each week should sound distinct.";

const FINDINGS_DRIVEN_INSTRUCTIONS = "You write Weekly Debrief copy for endurance athletes. An analytic pass has already extracted structured findings — your job is voice and format, not re-analysis.\n" +
  "\n" +
  "How to use findings:\n" +
  "- nonObviousInsight: start from findings.primaryInsight.insight and phrase it for an athlete. Do NOT invent a different insight. If findings.primaryInsight.confidence is 'low', hedge the language ('appears', 'worth watching') instead of stating it as fact. Keep ≤360 chars.\n" +
  "- executiveSummary: lead with findings.weekCharacter as the angle, then ground it in 1–2 specifics from facts/evidence. Do not reuse weekCharacter verbatim — translate it into prose.\n" +
  "- highlights: 3 concrete wins grounded in evidence; draw from findings.patterns where relevant.\n" +
  "- observations: 1–3 items. Prefer findings.patterns and findings.tensions — these are the cross-session signals the athlete needs surfaced.\n" +
  "- carryForward: 2 items. Adopt or refine from findings.carryForwardCandidates; each must be a complete self-contained sentence ≤280 chars.\n" +
  "\n" +
  "Voice rules:\n" +
  "- Calm, precise, coach-like. No hype. No diagnosis beyond the data.\n" +
  "- Sport-specific: for runs weigh splits, HR drift, pace fade; for swims weigh rep structure, rest, stroke metrics; for rides weigh power, load, cadence.\n" +
  "- Avoid opening phrasings from prior weeks — each week must sound distinct.\n" +
  "- If findings.confidenceNote is present, honour it: don't overclaim signals the analytic pass already flagged as under-evidenced.\n" +
  "- Do not repeat the executiveSummary inside nonObviousInsight. They serve different purposes.";

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
  findings?: WeeklyFindings | null;
}) {
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

  const hasFindings = args.findings != null;
  const baseInstructions = hasFindings ? FINDINGS_DRIVEN_INSTRUCTIONS : SINGLE_PASS_INSTRUCTIONS;

  const result = await callOpenAIWithFallback<WeeklyDebriefNarrative>({
    logTag: "weekly-debrief",
    fallback: args.deterministicFallback,
    buildRequest: () => ({
      instructions: baseInstructions + calibrationNote,
      reasoning: { effort: "low" },
      max_output_tokens: 4000,
      text: {
        format: zodTextFormat(weeklyDebriefNarrativeSchema, "weekly_debrief_narrative", {
          description: "Structured weekly debrief narrative."
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
                findings: args.findings ?? null
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
