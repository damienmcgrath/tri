/**
 * Race-week morning brief prompt generation.
 *
 * When the athlete is within 14 days of a race, the standard morning brief
 * is replaced with a race-week-specific variant that shifts coaching priorities
 * toward reassurance, taper management, and practical race-day preparation.
 */

import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import type { RaceWeekContext } from "@/lib/training/race-week";
import { formatRaceDistance, getConfidenceStatement } from "@/lib/training/race-week";

export const RACE_WEEK_BRIEF_PROMPT_VERSION = "v1";

export const raceWeekBriefOutputSchema = z.object({
  session_preview: z.string().max(300).nullable(),
  readiness_context: z.string().max(300).nullable(),
  week_context: z.string().min(1).max(200),
  pending_actions: z.array(z.string().max(120)).max(4),
  brief_text: z.string().min(1).max(800),
  race_guidance: z.string().max(400).nullable(),
  readiness_summary: z.string().max(200).nullable(),
});

export type RaceWeekBriefOutput = z.infer<typeof raceWeekBriefOutputSchema>;

type TodaySessionInfo = {
  sport: string;
  type: string;
  sessionName: string | null;
  durationMinutes: number;
  target: string | null;
  isKey: boolean;
  notes: string | null;
} | null;

function buildRaceWeekInstructions(raceCtx: RaceWeekContext): string {
  const lines: string[] = [
    "You are a calm, experienced triathlon coach providing a race-week morning brief.",
    "Your athlete is approaching a race. Your coaching priorities have shifted:",
    "",
    "1. REASSURANCE over optimisation. The training is done. Build confidence.",
    "2. TAPER MANAGEMENT. Normalise flat feelings, restlessness, or anxiety.",
    "3. PRACTICAL GUIDANCE. Logistics, nutrition, pacing, sleep, gear.",
    "4. EMOTIONAL INTELLIGENCE. Read the feel data and adapt your tone.",
    "",
    "Generate a JSON object with:",
    "- session_preview: Today's session context (null if rest day)",
    "- readiness_context: Recovery/readiness with race-week framing (null if insufficient data)",
    "- week_context: Race countdown and taper/race-week status",
    "- pending_actions: Actionable items for today (logistics, prep, session)",
    "- brief_text: The full assembled brief (4-6 lines)",
    "- race_guidance: Race-specific coaching cue for today (null if not applicable)",
    "- readiness_summary: One-line readiness verdict grounded in data (null if insufficient)",
    "",
    "Guidelines:",
    "- Sound like a human coach, not a notification system.",
    "- Be reassuring but not patronising. Acknowledge nerves, don't dismiss them.",
    "- Ground every statement in the athlete's actual data.",
    "- Never use emojis.",
    "- Keep it warm but professional. No forced enthusiasm.",
    "- Do NOT suggest adding training sessions during taper.",
    "- Do NOT suggest major changes to nutrition, equipment, or strategy.",
    "- Do NOT undermine confidence. If their data supports it, say so directly.",
  ];

  // Carry-forward lives at the top of the per-proximity rules so it
  // outranks the brevity/structure prescriptions below. We inline the
  // EXACT instruction text — the model cannot truncate or paraphrase
  // across a section break it never sees. A post-AI override
  // (enforceCarryForwardOnAiOutput) backs this up so non-compliant
  // outputs are still corrected after the fact.
  if (
    raceCtx.carryForward &&
    (raceCtx.proximity === "race_day" || raceCtx.proximity === "day_before")
  ) {
    lines.push(
      "",
      "MANDATORY CARRY-FORWARD — non-negotiable, overrides every other rule below:",
      `- The athlete's prior race produced this portable lesson from ${raceCtx.carryForward.fromRaceName ?? `the race on ${raceCtx.carryForward.fromRaceDate}`}:`,
      `    Headline: "${raceCtx.carryForward.headline}"`,
      `    Instruction: "${raceCtx.carryForward.instruction}"`,
      `    Success criterion: "${raceCtx.carryForward.successCriterion}"`,
      "- `race_guidance` MUST contain the Instruction string verbatim. Do not paraphrase, summarise, or omit it. If you only have room for one sentence today, that sentence is the Instruction.",
      "- `brief_text` MUST also include the Instruction (or its key number — e.g. the wattage or pace target — written naturally into the sentence) so the athlete sees it as part of the brief.",
      "- Do NOT invent new pacing/equipment/strategy advice that contradicts the Instruction.",
      "- The brevity rules in the proximity block below DO NOT exempt you from including the carry-forward."
    );
  } else if (raceCtx.carryForward && raceCtx.proximity !== "post_race") {
    // Earlier in race week — surface for context but no mandatory repeat yet.
    lines.push(
      "",
      "CARRY-FORWARD from prior race (context only this far out):",
      "- See the 'Carry-forward from {{race}}' section in the input.",
      "- Do NOT invent advice that contradicts it.",
      "- The mandatory verbatim repeat kicks in on day_before / race_day."
    );
  }

  if (raceCtx.proximity === "day_before") {
    lines.push(
      "",
      "This is the DAY BEFORE the race. Include:",
      "- A practical checklist for tonight (gear, nutrition, sleep) — 3-4 bullet points.",
      "- A warm, confident race-eve message.",
      "- No training advice beyond a shakeout if one is planned."
    );
  }

  if (raceCtx.proximity === "race_day") {
    lines.push(
      "",
      "This is RACE DAY. Be brief, warm, and focused.",
      "- No training advice. Just confidence and a pacing reminder.",
      "- Keep the brief to 2-3 lines maximum (carry-forward included).",
      "- Remind them of their pacing plan if data is available."
    );
  }

  if (raceCtx.proximity === "post_race") {
    const daysSince = Math.abs(raceCtx.race.daysUntil);
    lines.push(
      "",
      `This is ${daysSince} day${daysSince === 1 ? "" : "s"} AFTER the race. Shift to recovery mode:`,
      "- Day 1: Complete rest. Walk, stretch, eat well.",
      "- Day 2-3: Easy movement only if it feels good. No running.",
      "- Day 4-5: Light swimming is fine. No intensity.",
      "- Day 6-7: Easy sessions can resume. Rebuild gradually.",
      "- Celebrate the achievement. Be warm and encouraging."
    );
  }

  return lines.join("\n");
}

function buildRaceWeekInput(
  raceCtx: RaceWeekContext,
  todaySession: TodaySessionInfo,
  isRestDay: boolean
): string {
  const lines: string[] = [];
  const absdays = Math.abs(raceCtx.race.daysUntil);

  lines.push("## Race Context");
  if (raceCtx.proximity === "post_race") {
    lines.push(`Race: ${raceCtx.race.name} (${raceCtx.race.type}, ${raceCtx.race.priority}-race)`);
    lines.push(`Completed: ${absdays} day${absdays === 1 ? "" : "s"} ago`);
  } else {
    lines.push(`Race: ${raceCtx.race.name} (${raceCtx.race.type}, ${raceCtx.race.priority}-race)`);
    lines.push(`Days until race: ${raceCtx.race.daysUntil}`);
    lines.push(`Proximity: ${raceCtx.proximity}`);
  }
  lines.push(`Distance: ${formatRaceDistance(raceCtx)}`);
  if (raceCtx.race.courseType) lines.push(`Course: ${raceCtx.race.courseType}`);
  if (raceCtx.race.expectedConditions) lines.push(`Expected conditions: ${raceCtx.race.expectedConditions}`);

  lines.push("");
  lines.push("## Athlete Readiness");
  lines.push(`TSB: ${raceCtx.readiness.tsb} (${raceCtx.readiness.readinessState})`);
  lines.push(`CTL trend: ${raceCtx.readiness.ctlTrend}`);

  if (raceCtx.recentExecution.lastWeekScore !== null) {
    lines.push(`Training score: ${raceCtx.recentExecution.lastWeekScore}/100`);
  }
  if (raceCtx.recentExecution.keySessionsTotal > 0) {
    lines.push(`Key sessions hit: ${raceCtx.recentExecution.keySessionsHit}/${raceCtx.recentExecution.keySessionsTotal}`);
  }
  if (raceCtx.recentExecution.feelTrend.length > 0) {
    lines.push(`Recent feel scores: ${raceCtx.recentExecution.feelTrend.join(", ")} (avg: ${raceCtx.recentExecution.averageFeel})`);
  }

  if (raceCtx.taperStatus.inTaper) {
    lines.push("");
    lines.push("## Taper Status");
    lines.push(`In taper: week ${raceCtx.taperStatus.taperWeek}`);
    if (raceCtx.taperStatus.volumeReductionPct) {
      lines.push(`Volume reduced: ~${raceCtx.taperStatus.volumeReductionPct}%`);
    }
  }

  if (raceCtx.carryForward) {
    lines.push("");
    lines.push(`## Carry-forward from ${raceCtx.carryForward.fromRaceName ?? `prior race on ${raceCtx.carryForward.fromRaceDate}`}`);
    lines.push(`Headline: ${raceCtx.carryForward.headline}`);
    lines.push(`Instruction: ${raceCtx.carryForward.instruction}`);
    lines.push(`Success criterion: ${raceCtx.carryForward.successCriterion}`);
  }

  if (todaySession) {
    lines.push("");
    lines.push("## Today's Session");
    lines.push(`${todaySession.sport} — ${todaySession.sessionName ?? todaySession.type} (${todaySession.durationMinutes} min)${todaySession.isKey ? " [KEY]" : ""}`);
    if (todaySession.target) lines.push(`Target: ${todaySession.target}`);
    if (todaySession.notes) lines.push(`Notes: ${todaySession.notes.slice(0, 200)}`);
  } else {
    lines.push("");
    lines.push("## Today");
    lines.push(isRestDay ? "Rest day — no session planned." : "No planned session remaining.");
  }

  return lines.join("\n");
}

/**
 * Deterministic fallback for the race-week brief. Used when OpenAI is
 * unavailable, returns nothing, or fails schema validation. Exported so
 * tests can verify the fallback surfaces Phase 1D carry-forward — the AI
 * prompt path is not the only place the carry-forward must appear.
 */
export function buildRaceWeekBriefFallback(
  raceCtx: RaceWeekContext,
  todaySession: TodaySessionInfo
): RaceWeekBriefOutput {
  const confidenceStatement = getConfidenceStatement(raceCtx);

  // Carry-forward (Phase 1D) is the single most important coaching cue on
  // race morning. Surface it in the deterministic fallback the same way the
  // AI prompt is asked to — otherwise on any AI fallback / schema failure
  // the athlete loses the exact instruction the prior race left them with.
  const carryForwardLine = raceCtx.carryForward
    ? `${raceCtx.carryForward.headline} — ${raceCtx.carryForward.instruction}`
    : null;

  const fallbackBrief = raceCtx.proximity === "post_race"
    ? `Recovery mode — ${Math.abs(raceCtx.race.daysUntil)} days since ${raceCtx.race.name}. Take it easy and let your body recover.`
    : raceCtx.proximity === "race_day"
      ? `Race day. ${carryForwardLine ?? confidenceStatement}`
      : `${raceCtx.race.name} in ${raceCtx.race.daysUntil} days. ${confidenceStatement}`;

  // Surface the carry-forward in race_guidance for race_day / day_before
  // (the morning when the athlete will read it). Outside of those windows
  // the confidence statement is the better default.
  const fallbackRaceGuidance =
    carryForwardLine && (raceCtx.proximity === "race_day" || raceCtx.proximity === "day_before")
      ? carryForwardLine
      : confidenceStatement;

  return {
    session_preview: todaySession
      ? `${todaySession.sessionName ?? todaySession.type} (${todaySession.durationMinutes} min ${todaySession.sport})`
      : null,
    readiness_context: `TSB: ${raceCtx.readiness.tsb} — ${raceCtx.readiness.readinessState}`,
    week_context: raceCtx.proximity === "post_race"
      ? `Recovery: ${Math.abs(raceCtx.race.daysUntil)} days post-race`
      : `${raceCtx.race.name} in ${raceCtx.race.daysUntil} day${raceCtx.race.daysUntil === 1 ? "" : "s"}`,
    pending_actions: [],
    brief_text: fallbackBrief,
    race_guidance: fallbackRaceGuidance,
    readiness_summary: `${raceCtx.readiness.readinessState} — TSB ${raceCtx.readiness.tsb}`
  };
}

/**
 * Deterministic post-AI override that guarantees the carry-forward
 * Instruction is present in `race_guidance` (and woven into `brief_text`)
 * on race_day / day_before — regardless of what the model wrote.
 *
 * The model is instructed to repeat the Instruction verbatim, but model
 * output is non-deterministic and brevity prescriptions for race_day
 * historically beat the carry-forward rule. Rather than hope the prompt
 * wins, we treat the Instruction as a hard contract and fix any output
 * that fails to honor it.
 *
 * No-op when:
 *   - There is no carry-forward in context.
 *   - Proximity is anywhere other than race_day or day_before.
 *   - The AI output already contains the Instruction (substring match).
 */
export function enforceCarryForwardOnAiOutput(
  output: RaceWeekBriefOutput,
  raceCtx: RaceWeekContext
): RaceWeekBriefOutput {
  const cf = raceCtx.carryForward;
  if (!cf) return output;
  if (raceCtx.proximity !== "race_day" && raceCtx.proximity !== "day_before") {
    return output;
  }

  const instruction = cf.instruction.trim();
  const guidance = (output.race_guidance ?? "").trim();
  const briefText = (output.brief_text ?? "").trim();

  // Substring match is intentionally lenient: if the model wrote the
  // Instruction verbatim, even with surrounding sentences, the contract
  // is satisfied. Otherwise we replace race_guidance and prepend to
  // brief_text. The headline is included so the cue is read as guidance,
  // not just an isolated number.
  const carryForwardLine = `${cf.headline} — ${instruction}`;

  const guidanceHasInstruction = guidance.includes(instruction);
  const briefHasInstruction = briefText.includes(instruction);

  if (guidanceHasInstruction && briefHasInstruction) return output;

  const nextRaceGuidance = guidanceHasInstruction ? output.race_guidance : carryForwardLine;
  const nextBriefText = briefHasInstruction
    ? output.brief_text
    : briefText.length > 0
      ? `${carryForwardLine} ${briefText}`
      : carryForwardLine;

  return {
    ...output,
    race_guidance: nextRaceGuidance,
    brief_text: nextBriefText
  };
}

export async function generateRaceWeekBriefAI(
  raceCtx: RaceWeekContext,
  todaySession: TodaySessionInfo,
  isRestDay: boolean
): Promise<RaceWeekBriefOutput> {
  const fallback: RaceWeekBriefOutput = buildRaceWeekBriefFallback(raceCtx, todaySession);

  const result = await callOpenAIWithFallback({
    logTag: "race-week-brief",
    fallback,
    schema: raceWeekBriefOutputSchema,
    buildRequest: () => ({
      instructions: buildRaceWeekInstructions(raceCtx),
      input: buildRaceWeekInput(raceCtx, todaySession, isRestDay),
      text: {
        format: zodTextFormat(raceWeekBriefOutputSchema, "race_week_brief"),
      },
    }),
    logContext: {
      proximity: raceCtx.proximity,
      raceName: raceCtx.race.name,
      daysUntil: raceCtx.race.daysUntil,
      priority: raceCtx.race.priority,
    },
  });

  return enforceCarryForwardOnAiOutput(result.value, raceCtx);
}
