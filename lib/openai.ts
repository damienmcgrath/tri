import "openai/shims/node";
import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

const COACH_MODEL = process.env.OPENAI_COACH_MODEL?.trim() || "gpt-5-mini";
const COACH_DEEP_MODEL = process.env.OPENAI_COACH_DEEP_MODEL?.trim() || "gpt-5.4";
const DEFAULT_COACH_TIMEOUT_MS = 60_000;

export function getCoachModel(options?: { deep?: boolean }) {
  return options?.deep ? COACH_DEEP_MODEL : COACH_MODEL;
}

export function getCoachRequestTimeoutMs() {
  const raw = process.env.OPENAI_COACH_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_COACH_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_COACH_TIMEOUT_MS;
  }

  return parsed;
}

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }

  return cachedClient;
}

/**
 * Extract a JSON object from text that may contain markdown fences or surrounding prose.
 * Tries: direct parse → fenced code block → brace extraction → null.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to fence/object extraction.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Fall through to brace extraction.
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  return null;
}
