/**
 * Coach chat orchestration logic.
 *
 * Extracted from app/api/coach/chat/route.ts so that the business logic
 * (LLM orchestration, tool execution, contextual state building) lives
 * in lib/ and the route handler is a thin HTTP adapter.
 */

import { z } from "zod";
import { buildContextualPrompts, buildRaceWeekPrompts, COACH_STRUCTURING_INSTRUCTIONS, COACH_SYSTEM_INSTRUCTIONS, RACE_COACH_INSTRUCTIONS } from "@/lib/coach/instructions";
import { executeCoachTool } from "@/lib/coach/tool-handlers";
import { coachToolSchemas, coachTools, type CoachToolName } from "@/lib/coach/tools";
import { loadRaceCoachContext } from "@/lib/coach/race-context";
import { getLatestFitness, getTsbTrend, getReadinessState } from "@/lib/training/fitness-model";
import { detectCrossDisciplineFatigue } from "@/lib/training/fatigue-detection";
import { getRaceWeekContext } from "@/lib/training/race-week";
import { coachStructuredResponseSchema, type CoachStructuredResponse } from "@/lib/coach/types";
import { getCoachModel, getOpenAIClient } from "@/lib/openai";
import { logCoachAudit } from "@/lib/coach/audit";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConversationMessageRow = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  citations?: unknown;
};

type StreamWriters = {
  onAnswerDelta?: (chunk: string) => void;
};

type CoachResponseFlowResult = {
  answer: string;
  structured: CoachStructuredResponse;
  responseId: string | undefined;
  previousResponseId: string | undefined;
};

type StreamedResponseResult = {
  responseId: string;
  outputText: string;
  toolCalls: Array<{ callId: string; name: string; argumentsJson: string }>;
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function isCoachToolName(name: string): name is CoachToolName {
  return Object.prototype.hasOwnProperty.call(coachToolSchemas, name);
}

function parseToolArgs(argumentsJson: string) {
  if (!argumentsJson || argumentsJson.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(argumentsJson) as Record<string, unknown>;
  } catch {
    throw new Error("Model provided invalid JSON tool arguments.");
  }
}

function extractOutputText(response: { output_text?: string }) {
  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("Model returned an empty response.");
  }
  return text;
}

function safeStructuredFallback(answer: string): CoachStructuredResponse {
  return {
    headline: "Coach recommendation",
    answer,
    insights: [],
    actions: [],
    warnings: [],
    citations: []
  };
}

// ─── Service fallback ────────────────────────────────────────────────────────

export function buildServiceFallback(): CoachResponseFlowResult {
  const answer = "I can\u2019t reach the coaching model right now. Please try again soon.";

  return {
    answer,
    structured: {
      headline: answer,
      answer,
      insights: [],
      actions: [],
      warnings: [],
      citations: []
    },
    responseId: undefined,
    previousResponseId: undefined
  };
}

// ─── OpenAI streaming ────────────────────────────────────────────────────────

async function collectResponseStream(params: {
  request: Parameters<ReturnType<typeof getOpenAIClient>["responses"]["create"]>[0];
  signal: AbortSignal;
  streamWriters?: StreamWriters;
  emitAnswerText: boolean;
}) {
  const client = getOpenAIClient();
  const stream = await client.responses.create({ ...params.request, stream: true }, { signal: params.signal });

  let responseId = "";
  let outputText = "";
  const toolCallMap = new Map<string, { callId: string; name: string; argumentsJson: string }>();

  for await (const event of stream) {
    if (event.type === "response.created") {
      responseId = event.response.id;
      continue;
    }

    if (event.type === "response.output_text.delta") {
      outputText += event.delta;
      if (params.emitAnswerText) {
        params.streamWriters?.onAnswerDelta?.(event.delta);
      }
      continue;
    }

    if (event.type === "response.output_item.added" && event.item.type === "function_call") {
      toolCallMap.set(event.item.call_id, {
        callId: event.item.call_id,
        name: event.item.name,
        argumentsJson: event.item.arguments ?? ""
      });
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const existing = toolCallMap.get(event.item_id);
      if (existing) {
        existing.argumentsJson += event.delta;
      }
      continue;
    }

    if (event.type === "response.output_item.done" && event.item.type === "function_call") {
      toolCallMap.set(event.item.call_id, {
        callId: event.item.call_id,
        name: event.item.name,
        argumentsJson: event.item.arguments ?? ""
      });
    }
  }

  if (!responseId) {
    throw new Error("Model response stream completed without response id.");
  }

  return {
    responseId,
    outputText,
    toolCalls: [...toolCallMap.values()]
  } satisfies StreamedResponseResult;
}

// ─── Contextual state ────────────────────────────────────────────────────────

export async function buildContextualState(deps: Parameters<typeof executeCoachTool>[2]) {
  try {
    const [fitness, tsbTrend, crossFatigue] = await Promise.all([
      getLatestFitness(deps.supabase, deps.ctx.userId).catch(() => null),
      getTsbTrend(deps.supabase, deps.ctx.userId).catch(() => null),
      detectCrossDisciplineFatigue(deps.supabase, deps.ctx.userId).catch(() => null)
    ]);

    const totalFitness = fitness?.total ?? null;
    const readiness = totalFitness ? getReadinessState(totalFitness.tsb, tsbTrend) : null;

    // Check for recent partial/missed sessions
    const { data: recentSessions } = await deps.supabase
      .from("sessions")
      .select("id,date,sport,type,session_name,execution_result")
      .eq("user_id", deps.ctx.userId)
      .eq("status", "completed")
      .order("date", { ascending: false })
      .limit(5);

    const recentPartial = (recentSessions ?? [])
      .filter((s) => {
        const exec = s.execution_result as { status?: string } | null;
        return exec?.status === "partial_intent" || exec?.status === "missed_intent";
      })
      .slice(0, 2)
      .map((s) => ({
        name: (s.session_name as string) ?? (s.type as string) ?? s.sport,
        date: s.date as string,
        status: ((s.execution_result as { status?: string })?.status ?? "partial").replace("_", " ")
      }));

    // Check for pending follow-ups from recent assistant messages
    const { data: recentAssistantMsgs } = await deps.supabase
      .from("ai_messages")
      .select("content,metadata")
      .eq("user_id", deps.ctx.userId)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(3);

    const pendingFollowups: string[] = [];
    for (const msg of recentAssistantMsgs ?? []) {
      const meta = msg.metadata as { pending_followups?: string[] } | null;
      if (meta?.pending_followups) {
        pendingFollowups.push(...meta.pending_followups);
      }
    }

    return {
      readiness,
      fatigueSignals: crossFatigue ? [crossFatigue] : [],
      imbalances: [] as Array<{ sport: string; direction: string; deltaPp: number }>,
      recentPartialSessions: recentPartial,
      pendingFollowups: pendingFollowups.slice(0, 3)
    };
  } catch {
    return null;
  }
}

// ─── Main response flow ──────────────────────────────────────────────────────

export async function runCoachResponseFlow(params: {
  userMessage: string;
  priorMessages: ConversationMessageRow[];
  previousResponseId?: string;
  supabaseConversationId: string;
  /**
   * When set, this conversation is scoped to a race bundle. Phase 2 wires
   * the actual race-context loading and tool exposure; this param is the
   * plumbing seam.
   */
  raceBundleId?: string;
  toolDeps: Parameters<typeof executeCoachTool>[2];
  signal: AbortSignal;
  streamWriters?: StreamWriters;
}): Promise<CoachResponseFlowResult> {
  const history = params.priorMessages.slice(-10).map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n");

  // Build contextual prompts from current training state
  const trainingState = await buildContextualState(params.toolDeps);
  const contextualPrompts = trainingState ? buildContextualPrompts(trainingState) : [];

  // Add race-week coaching directives when the athlete is near a race
  const todayIso = new Date().toISOString().slice(0, 10);
  const raceWeekCtx = await getRaceWeekContext(params.toolDeps.supabase, params.toolDeps.ctx.userId, todayIso).catch(() => null);
  if (raceWeekCtx && raceWeekCtx.proximity !== "normal") {
    const raceWeekPrompts = buildRaceWeekPrompts({
      proximity: raceWeekCtx.proximity,
      raceName: raceWeekCtx.race.name,
      raceType: raceWeekCtx.race.type,
      daysUntil: raceWeekCtx.race.daysUntil,
      priority: raceWeekCtx.race.priority,
      inTaper: raceWeekCtx.taperStatus.inTaper,
      readinessState: raceWeekCtx.readiness.readinessState,
    });
    contextualPrompts.push(...raceWeekPrompts);
  }

  const directivesBlock = contextualPrompts.length > 0
    ? `\n\nCoaching directives for this conversation:\n${contextualPrompts.map((p) => `- ${p}`).join("\n")}`
    : "";

  // Race-scoped conversations get the race object pre-loaded into context
  // and the race-coach instruction block appended to the system prompt.
  const raceCoachContext = params.raceBundleId
    ? await loadRaceCoachContext(params.toolDeps.supabase, params.toolDeps.ctx.userId, params.raceBundleId).catch(() => null)
    : null;

  const systemInstructions = raceCoachContext
    ? `${COACH_SYSTEM_INSTRUCTIONS}\n\n${RACE_COACH_INSTRUCTIONS}`
    : COACH_SYSTEM_INSTRUCTIONS;

  const raceBlock = raceCoachContext
    ? `\n\n${raceCoachContext.promptBlock}`
    : "";

  let response = await collectResponseStream({
    request: {
      model: getCoachModel(),
      instructions: systemInstructions,
      previous_response_id: params.previousResponseId,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: `<context>\nConversation ID: ${params.supabaseConversationId}\nRecent chat:\n${history || "(none)"}${directivesBlock}${raceBlock}\n</context>` }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: params.userMessage }]
        }
      ],
      tools: coachTools,
      tool_choice: "auto"
    },
    signal: params.signal,
    emitAnswerText: false
  });

  const seededPreviousResponseId = params.previousResponseId;

  for (let i = 0; i < 6; i += 1) {
    const toolCalls = response.toolCalls;

    if (toolCalls.length === 0) {
      break;
    }

    const toolOutputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];

    for (const call of toolCalls) {
      if (!isCoachToolName(call.name)) {
        logCoachAudit("warn", "coach.tool.unknown", {
          ctx: params.toolDeps.ctx,
          route: "POST /api/coach/chat",
          toolName: call.name,
          success: false,
          reason: "Tool name not registered"
        });

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: JSON.stringify({ error: `Unsupported tool: ${call.name}` })
        });

        continue;
      }

      const toolName: CoachToolName = call.name;
      const parsedArgs = parseToolArgs(call.argumentsJson);

      try {
        const output = await executeCoachTool(
          toolName,
          parsedArgs,
          { ...params.toolDeps, raceBundleId: params.raceBundleId }
        );
        toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(output) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown tool error";
        toolOutputs.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ error: message }) });
      }
    }

    response = await collectResponseStream({
      request: {
        model: getCoachModel(),
        previous_response_id: response.responseId,
        input: toolOutputs,
        instructions: systemInstructions
      },
      signal: params.signal,
      emitAnswerText: false
    });
  }

  const finalAnswerResponse = await collectResponseStream({
    request: {
      model: getCoachModel(),
      previous_response_id: response.responseId,
      instructions: systemInstructions,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Now provide the final athlete-facing answer only. Do not include tool-call traces, function arguments, raw JSON payloads, or internal reasoning." }]
        }
      ]
    },
    signal: params.signal,
    streamWriters: params.streamWriters,
    emitAnswerText: true
  });

  const draftAnswer = extractOutputText({ output_text: finalAnswerResponse.outputText });

  const formatterResponse = await collectResponseStream({
    request: {
      model: getCoachModel(),
      instructions: COACH_STRUCTURING_INSTRUCTIONS,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: `Return strict JSON only.\n\n${draftAnswer}` }]
        }
      ]
    },
    signal: params.signal,
    emitAnswerText: false
  });

  const structuredJson = extractOutputText({ output_text: formatterResponse.outputText });
  const parsed = z.string().transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Formatter response was not JSON." });
      return z.NEVER;
    }
  }).pipe(coachStructuredResponseSchema).safeParse(structuredJson);

  return {
    answer: draftAnswer,
    structured: parsed.success ? parsed.data : safeStructuredFallback(draftAnswer),
    responseId: finalAnswerResponse.responseId,
    previousResponseId: seededPreviousResponseId
  };
}
