import "openai/shims/node";
import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

export const COACH_MODEL = process.env.OPENAI_COACH_MODEL?.trim() || "gpt-5-mini";
export const COACH_DEEP_MODEL = process.env.OPENAI_COACH_DEEP_MODEL?.trim() || "gpt-5.4";
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
