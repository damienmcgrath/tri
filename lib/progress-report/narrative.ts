import "openai/shims/node";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import { getCoachModel } from "@/lib/openai";
import {
  progressReportNarrativeSchema,
  type ProgressReportFacts,
  type ProgressReportNarrative
} from "./types";

const INSTRUCTIONS = `You write the Progress Report for an endurance athlete, comparing their most recent 4-week training block against the block immediately before it. This is flagship content: the athlete should finish reading it knowing exactly which systems are improving, which are stalling, and what is the one non-obvious cross-block signal they would not have spotted from weekly debriefs alone.

Inputs (all inside the user message JSON):
- facts.volume: minutes, sessions, key sessions, per-sport minutes for current vs prior block.
- facts.fitnessTrajectory: CTL start/end per discipline + total, plus delta vs prior-block end.
- facts.paceAtHrByDiscipline: per-discipline pace-at-HR (run pace, bike power, swim pace) for each block with a direction label ("improving", "declining", "stable", "insufficient").
- facts.durability: aerobic decoupling aggregates across ≥45-min endurance sessions in each block.
- facts.peakPerformances: best run pace / bike power / swim pace in each block with a delta vs the prior block.
- facts.factualBullets + facts.confidenceNote: deterministic summary lines and caveats.

Voice rules:
- Calm, precise, coach-like. No hype. No diagnosis beyond the data. No emoji.
- Every claim must cite a specific number or comparison from facts. Do not restate generic advice.
- Honour facts.confidenceNote: if sample is small, hedge ("appears", "worth watching") rather than state as fact.
- Treat "insufficient" directions as exactly that — say so, do not manufacture a trend from noise.
- Do not repeat the executiveSummary inside nonObviousInsight or fitnessReport.

Field-by-field guidance:
- coachHeadline (≤120): one line capturing the block's dominant story — a specific adaptation shift, a stalled system, or a durability shift.
- executiveSummary (≤460): 2–3 sentences grounding the headline in specific numbers (CTL delta, pace-at-HR deltas, peak deltas, volume deltas).
- fitnessReport (≤340): CTL trajectory per discipline + total. Cite numbers. If ramp rate matters, mention it.
- durabilityReport (≤340): aerobic decoupling shift and what it means. If insufficient, say so and explain what would unlock a read.
- peakPerformancesReport (≤340): the most meaningful peak delta, in context (pace/power/duration). Avoid listing every peak.
- disciplineVerdicts (1–3): one per discipline that has enough signal. Each ≤260 chars. Must cite the pace-at-HR or peak delta for that discipline.
- nonObviousInsight (≤380, required): one cross-block observation an athlete would not see by skimming weekly debriefs. Prefer cross-discipline or cross-signal patterns (e.g. "Run pace-at-HR improved 6s/km while bike power held flat — adaptation is concentrating on running even though total CTL split was 50/50"). Ground every claim in a number or dated event. If no cross-block signal emerges, say so honestly.
- teach (optional, ≤220): when the block exposes a mechanistically important metric (CTL ramp, aerobic decoupling, pace-at-HR, durability fade, variability index), explain in one sentence *why* that metric matters for training. Null when no mechanism is worth teaching.
- carryForward (exactly 2, each ≤280 chars): complete self-contained sentences — the two highest-leverage things to change or protect in the next block. Avoid ending mid-thought.`;

export async function generateProgressReportNarrative(args: {
  facts: ProgressReportFacts;
  deterministicFallback: ProgressReportNarrative;
}): Promise<{ narrative: ProgressReportNarrative; source: "ai" | "fallback" }> {
  const result = await callOpenAIWithFallback<ProgressReportNarrative>({
    logTag: "progress-report",
    fallback: args.deterministicFallback,
    buildRequest: () => ({
      model: getCoachModel({ deep: true }),
      instructions: INSTRUCTIONS,
      reasoning: { effort: "medium" },
      max_output_tokens: 6000,
      text: {
        format: zodTextFormat(progressReportNarrativeSchema, "progress_report_narrative", {
          description: "Structured progress report narrative."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify({
                facts: args.facts
              })
            }
          ]
        }
      ]
    }),
    schema: progressReportNarrativeSchema
  });

  return { narrative: result.value, source: result.source };
}
