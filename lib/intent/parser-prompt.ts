// Prompt construction for the LLM-backed athlete-intent parser.
// Spec: tri.ai Findings Pipeline Spec §3.4.

import type { AthletePhysModel } from "@/lib/findings/types";

export interface IntentParserPromptContext {
  session_sport: string;
  session_duration_min: number;
  athlete: AthletePhysModel;
}

export const INTENT_PARSER_SYSTEM_PROMPT = `You convert a triathlete's free-text description of a workout into a strict JSON object describing the session intent.

OUTPUT — return a single JSON object with these fields ONLY:
- "type": one of "endurance" | "tempo" | "threshold" | "vo2" | "race_prep" | "recovery" | "open" | "race_simulation"
- "structure": one of "steady" | "progressive" | "intervals" | "over_under" | "race_simulation" | "open"
- "blocks": array of block objects (may be empty for unstructured/open sessions)
- "athlete_notes": short verbatim quote of the most important descriptive phrase (optional, ≤120 chars)
- "confidence": number 0..1 — how clearly the description maps to a structured intent

BLOCK SHAPE — every entry in "blocks" must include:
- "index": 0-based ordinal
- "duration_min": positive number (resolve "long warmup" ≈ 15 min; "short warmup" ≈ 8 min; "warmup" ≈ 12 min; "cooldown" ≈ 10 min)
- "type": one of "warmup" | "work" | "easy" | "cooldown" | "tail"
- "target_watts": [low, high] integer pair (cycling work blocks; OMIT for run/swim or non-power blocks)
- "target_hr": [low, high] bpm pair (optional)
- "target_pace": [fast, slow] strings like "4:30" / "5:00" (running pace blocks; OMIT for cycling power blocks)
- "target_rpe": integer 1..10 (optional)
- "description": short label, e.g. "5x4min @ threshold"

RESOLUTION — convert relative targets to concrete numbers using the athlete model the user provides:
- "at threshold" / "FTP" / "100% FTP" → target_watts = [round(0.97 * FTP), round(1.03 * FTP)]
- "tempo" / "sweet spot" → target_watts = [round(0.85 * FTP), round(0.95 * FTP)]
- "VO2" / "VO2max" → target_watts = [round(1.06 * FTP), round(1.20 * FTP)]
- "endurance" / "Z2" / "aerobic" → target_watts = [round(0.55 * FTP), round(0.75 * FTP)]
- "recovery" / "Z1" → target_watts = [round(0.40 * FTP), round(0.55 * FTP)]
- For run targets relative to threshold pace, use threshold_pace seconds-per-km when given.
- If FTP / threshold_pace is not provided, OMIT the numeric target rather than inventing one.

STRUCTURE TYPING — pick "structure":
- "steady": one continuous effort at one intensity (long ride at Z2, easy run, recovery spin)
- "progressive": ramps from easier to harder across the session (negative split, build run)
- "intervals": discrete repeats with rest (5x4min @ threshold, 8x400m, 10x30s)
- "over_under": alternating above/below threshold within a sustained block
- "race_simulation": race-pace effort approximating event demands (brick, sustained race-effort tempo)
- "open": athlete didn't describe a clear structure → output structure="open" with blocks=[]

CONFIDENCE — set "confidence":
- 0.9+ when explicit structure, intensity, and durations are given
- 0.6–0.8 when intent is clear but durations or targets are vague (you inferred them)
- ≤0.4 when the description is too generic to commit to a structure (set structure="open", blocks=[])

INFERENCE RULES:
- If the athlete says only "easy run" / "recovery ride" with no segments → structure="steady", one block spanning the full session_duration_min.
- For interval sessions where the athlete gives reps × duration but no warmup/cooldown, ADD a warmup block (~12 min) and a cooldown block (~10 min) so block durations sum to ~session_duration_min.
- If reps×duration+warmup+cooldown overshoots session_duration_min, scale down warmup/cooldown proportionally rather than dropping the work block.
- Sport-specific defaults: cycling work blocks emit target_watts (when FTP available); running work blocks emit target_pace; swim blocks emit description + duration only (no power/pace targets).
- Echo any vivid athlete language in "athlete_notes" verbatim.

Return ONLY the JSON object — no prose, no markdown fences, no commentary.`;

export function buildIntentParserUserPrompt(
  text: string,
  context: IntentParserPromptContext
): string {
  const athleteFields: string[] = [];
  if (context.athlete.ftp !== undefined) athleteFields.push(`ftp: ${context.athlete.ftp}`);
  if (context.athlete.threshold_pace !== undefined)
    athleteFields.push(`threshold_pace_sec_per_km: ${context.athlete.threshold_pace}`);
  if (context.athlete.css !== undefined) athleteFields.push(`css: ${context.athlete.css}`);
  if (context.athlete.hr_max !== undefined) athleteFields.push(`hr_max: ${context.athlete.hr_max}`);
  if (context.athlete.weight !== undefined) athleteFields.push(`weight_kg: ${context.athlete.weight}`);

  const athleteBlock = athleteFields.length > 0 ? athleteFields.join(", ") : "(none provided)";

  return [
    `Session sport: ${context.session_sport}`,
    `Session duration: ${context.session_duration_min} min`,
    `Athlete physiology: ${athleteBlock}`,
    "",
    "Athlete description:",
    text.trim(),
  ].join("\n");
}
