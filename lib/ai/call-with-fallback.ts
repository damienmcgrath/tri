/**
 * Shared OpenAI call pipeline with deterministic fallback.
 *
 * Both execution-review.ts and weekly-debrief.ts follow the same pattern:
 *   1. Check OPENAI_API_KEY
 *   2. Call OpenAI with model/instructions/input
 *   3. Extract text → parse JSON → validate with Zod schema
 *   4. Fall back to a deterministic result on any failure
 *
 * This module extracts that pipeline into a single generic function.
 */

import type { ZodType } from "zod";
import { getCoachModel, getCoachRequestTimeoutMs, getOpenAIClient, extractJsonObject } from "@/lib/openai";

type OpenAIRequestInput = Parameters<ReturnType<typeof getOpenAIClient>["responses"]["create"]>[0];

export type CallWithFallbackOptions<T> = {
  /** Tag used in console.warn messages, e.g. "[session-review-ai]" */
  logTag: string;
  /** The deterministic fallback value returned when AI is unavailable or fails. */
  fallback: T;
  /** Build the OpenAI request params (model, instructions, input, etc.). */
  buildRequest: () => Omit<OpenAIRequestInput, "model"> & { model?: string };
  /** Zod schema to validate the parsed JSON output. */
  schema: ZodType<T>;
  /**
   * Optional transform applied to the raw parsed JSON before Zod validation.
   * Use this for payload normalization or hydration.
   */
  normalizePayload?: (raw: unknown) => unknown;
  /**
   * Optional post-validation sanity check. Return a string to reject with a
   * fallback (the string is the warning reason), or undefined to accept.
   */
  sanityCheck?: (parsed: T) => string | undefined;
  /**
   * Optional post-validation transform applied to the successfully parsed data
   * before returning. Use this for unit normalization, etc.
   */
  postProcess?: (parsed: T) => T;
  /** Extra context fields included in console.warn log entries. */
  logContext?: Record<string, unknown>;
};

export type CallWithFallbackResult<T> = {
  value: T;
  source: "ai" | "fallback";
};

/**
 * Call OpenAI with a structured JSON schema expectation, falling back to a
 * deterministic value on any failure (missing API key, empty output, parse
 * errors, schema validation failures, or request exceptions).
 */
export async function callOpenAIWithFallback<T>(
  opts: CallWithFallbackOptions<T>
): Promise<CallWithFallbackResult<T>> {
  const { logTag, fallback, logContext } = opts;

  if (!process.env.OPENAI_API_KEY) {
    console.warn(`[${logTag}] Falling back: missing OPENAI_API_KEY`, logContext);
    return { value: fallback, source: "fallback" };
  }

  try {
    const client = getOpenAIClient();
    const timeoutMs = getCoachRequestTimeoutMs();
    const startedAt = Date.now();

    const requestParams = opts.buildRequest();
    const response = await client.responses.create(
      { model: getCoachModel(), ...requestParams },
      { timeout: timeoutMs }
    );

    const text = response.output_text?.trim();
    if (!text) {
      console.warn(`[${logTag}] Falling back: empty model output`, {
        ...logContext,
        incompleteReason: response.incomplete_details?.reason ?? null,
        elapsedMs: Date.now() - startedAt
      });
      return { value: fallback, source: "fallback" };
    }

    const rawJson = extractJsonObject(text);
    if (rawJson == null) {
      console.warn(`[${logTag}] Falling back: could not parse model output as JSON`, {
        ...logContext,
        incompleteReason: response.incomplete_details?.reason ?? null,
        outputLength: text.length,
        elapsedMs: Date.now() - startedAt
      });
      return { value: fallback, source: "fallback" };
    }

    const normalized = opts.normalizePayload ? opts.normalizePayload(rawJson) : rawJson;
    const parsed = opts.schema.safeParse(normalized);

    if (!parsed.success) {
      console.warn(`[${logTag}] Falling back: model JSON failed schema validation`, {
        ...logContext,
        incompleteReason: response.incomplete_details?.reason ?? null,
        elapsedMs: Date.now() - startedAt,
        formErrors: parsed.error.flatten().formErrors,
        fieldErrors: parsed.error.flatten().fieldErrors
      });
      return { value: fallback, source: "fallback" };
    }

    if (opts.sanityCheck) {
      const rejectReason = opts.sanityCheck(parsed.data);
      if (rejectReason) {
        console.warn(`[${logTag}] Falling back: ${rejectReason}`, {
          ...logContext,
          elapsedMs: Date.now() - startedAt
        });
        return { value: fallback, source: "fallback" };
      }
    }

    const value = opts.postProcess ? opts.postProcess(parsed.data) : parsed.data;
    return { value, source: "ai" };
  } catch (error) {
    const timeoutMs = getCoachRequestTimeoutMs();
    const message =
      error instanceof Error && error.message === "Request timed out."
        ? `OpenAI request timed out after ${Math.round(timeoutMs / 1000)}s`
        : error instanceof Error
          ? error.message
          : String(error);
    console.warn(`[${logTag}] Falling back: model request failed`, {
      ...logContext,
      timeoutMs,
      error: message
    });
    return { value: fallback, source: "fallback" };
  }
}
