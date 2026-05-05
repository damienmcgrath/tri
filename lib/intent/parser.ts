// LLM-backed athlete intent parser.
// Spec: tri.ai Findings Pipeline Spec §3.4.

import { z } from "zod";

import { extractJsonObject, getOpenAIClient } from "@/lib/openai";
import type { AthletePhysModel } from "@/lib/findings/types";
import type {
  IntendedBlock,
  IntendedBlockType,
  IntentSource,
  ResolvedIntent,
  SessionIntentType,
  SessionStructure,
} from "@/lib/intent/types";

import {
  INTENT_PARSER_SYSTEM_PROMPT,
  buildIntentParserUserPrompt,
} from "./parser-prompt";

export const PARSER_VERSION = "1.0.0";

const DEFAULT_INTENT_MODEL = "gpt-4o-mini";
const DEFAULT_INTENT_TIMEOUT_MS = 30_000;
// Confidence below this threshold → fall back to open/inferred.
const LOW_CONFIDENCE_THRESHOLD = 0.5;

const SESSION_INTENT_TYPES = [
  "endurance",
  "tempo",
  "threshold",
  "vo2",
  "race_prep",
  "recovery",
  "open",
  "race_simulation",
] as const satisfies readonly SessionIntentType[];

const SESSION_STRUCTURES = [
  "steady",
  "progressive",
  "intervals",
  "over_under",
  "race_simulation",
  "open",
] as const satisfies readonly SessionStructure[];

const INTENT_SOURCES = [
  "plan",
  "athlete_described",
  "inferred",
  "open",
] as const satisfies readonly IntentSource[];

const BLOCK_TYPES = [
  "warmup",
  "work",
  "easy",
  "cooldown",
  "tail",
] as const satisfies readonly IntendedBlockType[];

const numericPair = z.tuple([z.number(), z.number()]);
const stringPair = z.tuple([z.string(), z.string()]);

const intendedBlockSchema: z.ZodType<IntendedBlock> = z.object({
  index: z.number().int().nonnegative(),
  duration_min: z.number().positive(),
  type: z.enum(BLOCK_TYPES),
  target_watts: numericPair.optional(),
  target_hr: numericPair.optional(),
  target_pace: stringPair.optional(),
  target_rpe: z.number().min(1).max(10).optional(),
  description: z.string().optional(),
});

const resolvedIntentSchema: z.ZodType<ResolvedIntent> = z.object({
  source: z.enum(INTENT_SOURCES),
  type: z.enum(SESSION_INTENT_TYPES),
  structure: z.enum(SESSION_STRUCTURES),
  blocks: z.array(intendedBlockSchema).optional(),
  athlete_notes: z.string().optional(),
  resolved_at: z.string(),
  parser_version: z.string().optional(),
});

// Schema for the raw LLM JSON output (no source / resolved_at — those are
// stamped server-side by parseAthleteIntent).
const llmOutputSchema = z.object({
  type: z.enum(SESSION_INTENT_TYPES),
  structure: z.enum(SESSION_STRUCTURES),
  blocks: z.array(intendedBlockSchema).optional(),
  athlete_notes: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export interface IntentParserContext {
  session_sport: string;
  session_duration_min: number;
  athlete: AthletePhysModel;
}

function getIntentModel(): string {
  return process.env.OPENAI_INTENT_MODEL?.trim() || DEFAULT_INTENT_MODEL;
}

function getIntentTimeoutMs(): number {
  const raw = process.env.OPENAI_INTENT_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_INTENT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTENT_TIMEOUT_MS;
  return parsed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildOpenFallback(athleteNotes?: string): ResolvedIntent {
  return {
    source: "inferred",
    type: "open",
    structure: "open",
    blocks: [],
    ...(athleteNotes ? { athlete_notes: athleteNotes } : {}),
    resolved_at: nowIso(),
    parser_version: PARSER_VERSION,
  };
}

/**
 * Validate an arbitrary value as a ResolvedIntent. Throws a descriptive Error
 * on any structural mismatch — useful when consumers want hard guarantees
 * about LLM output before persisting it.
 */
export function validateIntent(raw: unknown): ResolvedIntent {
  const parsed = resolvedIntentSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid ResolvedIntent: ${issues}`);
  }
  return parsed.data;
}

/**
 * Parse an athlete's free-text workout description into a typed ResolvedIntent.
 *
 * Behaviour:
 * - Calls OPENAI_INTENT_MODEL (default: gpt-4o-mini) in JSON mode.
 * - Resolves relative targets like "at threshold" into concrete watt ranges
 *   using `context.athlete.ftp`.
 * - Falls back to `{ source: 'inferred', structure: 'open' }` on low LLM
 *   confidence, parse failure, schema mismatch, missing API key, or any
 *   network/timeout error.
 * - Always stamps `resolved_at` and `parser_version`.
 */
export async function parseAthleteIntent(
  text: string,
  context: IntentParserContext
): Promise<ResolvedIntent> {
  const trimmed = text.trim();
  if (!trimmed) return buildOpenFallback();

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return buildOpenFallback();
  }

  const userPrompt = buildIntentParserUserPrompt(trimmed, context);
  const model = getIntentModel();
  const timeoutMs = getIntentTimeoutMs();

  let outputText: string | null = null;
  try {
    const client = getOpenAIClient();
    const response = await client.chat.completions.create(
      {
        model,
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          { role: "system", content: INTENT_PARSER_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      },
      { timeout: timeoutMs }
    );
    outputText = response.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.warn("[intent-parser] Falling back: model request failed", {
      model,
      error: error instanceof Error ? error.message : String(error),
    });
    return buildOpenFallback();
  }

  if (!outputText || !outputText.trim()) {
    console.warn("[intent-parser] Falling back: empty model output", { model });
    return buildOpenFallback();
  }

  const rawJson = extractJsonObject(outputText);
  if (rawJson == null || typeof rawJson !== "object") {
    console.warn("[intent-parser] Falling back: could not parse model output as JSON", {
      model,
      outputLength: outputText.length,
    });
    return buildOpenFallback();
  }

  const parsed = llmOutputSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.warn("[intent-parser] Falling back: model JSON failed schema validation", {
      model,
      formErrors: parsed.error.flatten().formErrors,
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
    return buildOpenFallback();
  }

  const llm = parsed.data;
  const confidence = llm.confidence ?? 0.7;
  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    return buildOpenFallback(llm.athlete_notes);
  }

  const blocks = (llm.blocks ?? []).map((block, idx) => ({
    ...block,
    index: typeof block.index === "number" ? block.index : idx,
  }));

  return {
    source: "athlete_described",
    type: llm.type,
    structure: llm.structure,
    blocks,
    ...(llm.athlete_notes ? { athlete_notes: llm.athlete_notes } : {}),
    resolved_at: nowIso(),
    parser_version: PARSER_VERSION,
  };
}
