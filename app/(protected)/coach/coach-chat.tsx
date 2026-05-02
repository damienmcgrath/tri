"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CoachBriefingContext } from "./types";
import { getDiagnosisDataState } from "@/lib/ui/sparse-data";
import type { CoachCitation } from "@/lib/coach/types";
import { CoachMessage, type Message } from "./components/coach-message";
import {
  buildOpeningMessage,
  deriveTopInsight,
  executionScoreBandTone,
  pluralize,
  rankFlaggedSessions,
  scoreHeadline,
  statusChip,
  type SessionDiagnosis
} from "./components/coach-briefing-insight";
import {
  CoachConversationHistory,
  formatRecencyLabel,
  groupConversations,
  type Conversation
} from "./components/coach-conversation-list";

type CoachSummary = {
  plannedMinutes: number;
  completedMinutes: number;
  completionPct: number;
  dominantSport: string;
  insights: string[];
};

type StreamCompletePayload = {
  conversationId: string;
  responseId?: string;
  structured: {
    headline: string;
    answer: string;
    insights: string[];
    actions: Array<{ type: string; label: string; payload?: Record<string, unknown> }>;
    warnings: string[];
    citations?: CoachCitation[];
  };
};

function createMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CoachChat({
  diagnosisSessions,
  briefingContext,
  initialPrompt,
  showBriefingPanel = true,
  raceBundleId,
  seededPrompts,
  openingOverride,
  onCitationClick
}: {
  diagnosisSessions: SessionDiagnosis[];
  briefingContext: CoachBriefingContext;
  initialPrompt?: string;
  showBriefingPanel?: boolean;
  /** Race scope. When set, chat requests are tagged with this bundle. */
  raceBundleId?: string;
  /** Replaces the generic quickPrompts when in race mode. */
  seededPrompts?: string[];
  /** Override the default opening message (race-coach surface uses this). */
  openingOverride?: string;
  /** Called when a citation chip is clicked. Return true to claim the
   *  click (chip will preventDefault — used by race-coach surface to open
   *  the slide-up panel). Return void to let the chip's Link navigate. */
  onCitationClick?: (citation: CoachCitation) => boolean | void;
}) {
  const router = useRouter();
  const openingMessage = useMemo<Message>(() => {
    if (openingOverride && openingOverride.trim().length > 0) {
      return { id: "coach-default", role: "assistant", content: openingOverride };
    }
    return buildOpeningMessage(briefingContext, diagnosisSessions);
  }, [briefingContext, diagnosisSessions, openingOverride]);
  const [messages, setMessages] = useState<Message[]>([openingMessage]);

  // When the review-backfill effect triggers router.refresh(), props update but the
  // opening message in state goes stale. Replace it as long as the user hasn't
  // started a conversation yet (only the opening message is present).
  useEffect(() => {
    setMessages((current) => {
      if (current.length !== 1 || current[0].role !== "assistant") return current;
      if (current[0].content === openingMessage.content) return current;
      return [openingMessage];
    });
  }, [openingMessage]);
  const [summary, setSummary] = useState<CoachSummary | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [hasRequestedReviewBackfill, setHasRequestedReviewBackfill] = useState(false);
  const [showOlderConversations, setShowOlderConversations] = useState(false);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const activeRequestRef = useRef<AbortController | null>(null);

  const memoizedGroups = useMemo(() => groupConversations(conversations), [conversations]);
  const sessionDiagnoses = useMemo(() => diagnosisSessions, [diagnosisSessions]);
  const flaggedSessions = useMemo(() => rankFlaggedSessions(sessionDiagnoses), [sessionDiagnoses]);
  const matchedSessions = useMemo(() => sessionDiagnoses.filter((session) => session.status === "matched"), [sessionDiagnoses]);
  const topInsight = useMemo(() => deriveTopInsight(sessionDiagnoses, briefingContext), [sessionDiagnoses, briefingContext]);
  const dataState = useMemo(() => getDiagnosisDataState(sessionDiagnoses.length), [sessionDiagnoses.length]);
  const latestScoredSession = useMemo(
    () => sessionDiagnoses.find((session) => session.executionScoreBand || session.executionScore !== null) ?? null,
    [sessionDiagnoses]
  );
  const scoreTrendSummary = useMemo(() => {
    if (sessionDiagnoses.length === 0) return "No reviewed sessions yet.";
    const onTarget = sessionDiagnoses.filter((session) => session.executionScoreBand === "On target").length;
    const partial = sessionDiagnoses.filter((session) => session.executionScoreBand === "Partial match").length;
    const missed = sessionDiagnoses.filter((session) => session.executionScoreBand === "Missed intent").length;
    const provisional = sessionDiagnoses.filter((session) => session.executionScoreProvisional).length;
    const pieces = [
      onTarget > 0 ? `${onTarget} on target` : null,
      partial > 0 ? `${partial} partial` : null,
      missed > 0 ? `${missed} missed` : null
    ].filter((value): value is string => Boolean(value));
    const trend = pieces.length > 0 ? pieces.join(", ") : "scores still building";
    return provisional > 0 ? `Execution trend: ${trend}. ${provisional} provisional.` : `Execution trend: ${trend}.`;
  }, [sessionDiagnoses]);
  const emptyAttentionText = useMemo(() => {
    if (briefingContext.pendingReviewCount > 0) {
      return `${briefingContext.pendingReviewCount} linked session${briefingContext.pendingReviewCount > 1 ? "s are" : " is"} waiting for review analysis. Coach can already see the uploads; it is waiting for scored session reviews.`;
    }

    if (briefingContext.linkedSessionCount > 0) {
      return `${briefingContext.linkedSessionCount} linked session${briefingContext.linkedSessionCount > 1 ? "s are" : " is"} connected, but no session reviews are ready yet.`;
    }

    if (briefingContext.uploadedSessionCount > 0) {
      return `${briefingContext.uploadedSessionCount} uploaded activit${briefingContext.uploadedSessionCount === 1 ? "y is" : "ies are"} available. Link them to planned sessions to unlock review guidance.`;
    }

    return dataState.unlockText;
  }, [briefingContext, dataState.unlockText]);

  const strongestTheme = flaggedSessions[0]?.themes[0] ?? null;

  const nextActions = useMemo(() => {
    if (sessionDiagnoses.length < 2) {
      return [
        "Protect 2–3 key sessions this week and keep the rest deliberately easy.",
        "Use Calendar to move sessions instead of stacking missed work.",
        "Ask for a conservative adjustment if recovery feels off."
      ];
    }

    const actions = new Set<string>();

    if (strongestTheme === "easy_drift") {
      actions.add("Keep easy days truly easy for the next 2 sessions.");
    }
    if (strongestTheme === "recovery_slip") {
      actions.add("Protect recovery before the weekend long ride.");
    }
    if (strongestTheme === "threshold_inconsistent") {
      actions.add("Reduce the next quality session by ~10% and prioritise control.");
    }

    flaggedSessions.forEach((session) => actions.add(session.nextAction));

    if (flaggedSessions.length === 0) {
      actions.add("Repeat current aerobic intent before progressing load.");
    }

    if ((summary?.completionPct ?? 100) < 75) {
      actions.add("Keep volume steady until session execution quality stabilises.");
    }

    return [...actions].slice(0, 4);
  }, [summary?.completionPct, sessionDiagnoses, flaggedSessions, strongestTheme]);

  const quickPrompts = useMemo(() => {
    // Race-coach surface supplies its own deterministic, race-specific
    // seeded prompts. When provided, they fully replace the general
    // quickPrompts heuristics below.
    if (seededPrompts && seededPrompts.length > 0) {
      return seededPrompts.slice(0, 5);
    }

    // No diagnosis data — generic but useful starters
    if (sessionDiagnoses.length < 2) {
      return [
        "Which session should I protect this week?",
        "How should I adjust this week?",
        "What should stay easy vs key?"
      ];
    }

    const prompts: string[] = [];

    // Context-aware lead question based on week state
    const skippedCount = sessionDiagnoses.filter((s) => s.status === "missed").length;
    const completionPct = summary?.completionPct ?? 100;

    if (skippedCount > 0) {
      prompts.push(`How should I make up for the ${skippedCount} missed session${skippedCount > 1 ? "s" : ""}?`);
    } else if (completionPct >= 90) {
      prompts.push("Am I ready to increase volume next week?");
    }

    // Theme-specific question
    const themeQuestion =
      strongestTheme === "easy_drift" ? "How do I keep Z2 truly easy?" :
      strongestTheme === "recovery_slip" ? "How do I protect recovery this week?" :
      strongestTheme === "threshold_inconsistent" ? "Was this fatigue or pacing?" :
      latestScoredSession ? `Why was ${latestScoredSession.sessionName ?? "this session"} flagged?` :
      null;

    if (themeQuestion && !prompts.includes(themeQuestion)) {
      prompts.push(themeQuestion);
    }

    // Key session awareness
    const upcomingKey = briefingContext.upcomingKeySessionNames?.[0];
    if (upcomingKey && prompts.length < 3) {
      prompts.push(`What should I focus on for ${upcomingKey}?`);
    }

    // Fill remaining with universal follow-ups
    const fallbacks = ["What would move this to On target?", "What matters most now?"];
    for (const fb of fallbacks) {
      if (prompts.length >= 3) break;
      prompts.push(fb);
    }

    return prompts.slice(0, 3);
  }, [seededPrompts, sessionDiagnoses, strongestTheme, summary?.completionPct, latestScoredSession, briefingContext.upcomingKeySessionNames]);

  const dataRecency = useMemo(() => {
    const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
    return formatRecencyLabel(activeConversation?.updated_at ?? conversations[0]?.updated_at);
  }, [conversationId, conversations]);
  const activeConversation = useMemo(() => conversations.find((conversation) => conversation.id === conversationId) ?? null, [conversations, conversationId]);
  const condensedRationale = useMemo(() => {
    const compact = topInsight.rationale.replace(/\s+/g, " ").trim();
    if (compact.length <= 170) {
      return compact;
    }
    return `${compact.slice(0, 167).trimEnd()}…`;
  }, [topInsight.rationale]);

  async function loadConversations() {
    try {
      const response = await fetch("/api/coach/chat", { method: "GET" });
      const data = (await response.json()) as { conversations?: Conversation[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load conversations.");
      }

      setConversations(data.conversations ?? []);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Failed to load conversations.");
    }
  }

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    if (hasRequestedReviewBackfill || briefingContext.pendingReviewCount <= 0) {
      return;
    }

    let cancelled = false;

    async function requestReviewBackfill() {
      setHasRequestedReviewBackfill(true);

      try {
        const response = await fetch("/api/coach/review-backfill", { method: "POST" });
        const data = (await response.json()) as { updated?: number; error?: string };

        if (!response.ok || cancelled) {
          return;
        }

        if ((data.updated ?? 0) > 0) {
          router.refresh();
        }
      } catch {
        // Keep Coach usable even if background backfill fails.
      }
    }

    void requestReviewBackfill();

    return () => {
      cancelled = true;
    };
  }, [briefingContext.pendingReviewCount, hasRequestedReviewBackfill, router]);

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim().length > 0) {
      setInput(initialPrompt.trim());
    }
  }, [initialPrompt]);

  useEffect(() => {
    const viewport = messagesViewportRef.current;

    if (!viewport || !shouldAutoScrollRef.current) {
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight, behavior: isLoading ? "auto" : "smooth" });
  }, [messages, isLoading]);

  async function handleConversationClick(nextConversationId: string) {
    setError(null);

    try {
      const response = await fetch(`/api/coach/chat?conversationId=${nextConversationId}`, { method: "GET" });
      const data = (await response.json()) as {
        messages?: Array<{ role: "user" | "assistant"; content: string; created_at: string; citations?: unknown }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load conversation.");
      }

      setConversationId(nextConversationId);
      const hydrated: Message[] = (data.messages ?? []).map((row, idx) => ({
        id: `history-${nextConversationId}-${idx}`,
        role: row.role,
        content: row.content,
        citations: Array.isArray(row.citations) ? (row.citations as CoachCitation[]) : []
      }));
      setMessages(hydrated.length ? hydrated : [openingMessage]);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Failed to load conversation.");
    }
  }

  function handleNewChat() {
    activeRequestRef.current?.abort();
    setConversationId(null);
    setMessages([openingMessage]);
    setSummary(null);
    setError(null);
    setPendingMessageId(null);
  }

  function handleStopStreaming() {
    if (!activeRequestRef.current || !pendingMessageId) {
      return;
    }

    activeRequestRef.current.abort();
    setMessages((prev) =>
      prev.map((message) =>
        message.id === pendingMessageId
          ? {
              ...message,
              pending: false,
              failed: true,
              retryText: message.retryText,
              content: message.content.trim().length > 0 ? message.content : "Response stopped."
            }
          : message
      )
    );
    setPendingMessageId(null);
  }

  function buildConversationTitle(conversation: Conversation, index: number) {
    const trimmed = conversation.title.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return `Conversation ${conversations.length - index}`;
  }

  async function handleRenameConversation(conversation: Conversation, index: number) {
    const nextTitle = window.prompt("Rename conversation", buildConversationTitle(conversation, index));

    if (!nextTitle || nextTitle.trim().length === 0) {
      return;
    }

    try {
      const response = await fetch("/api/coach/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, title: nextTitle.trim() })
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not rename conversation.");
      }

      await loadConversations();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename conversation.");
    }
  }

  async function handleDeleteConversation(conversationIdToDelete: string) {
    const confirmed = window.confirm("Delete this conversation? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/coach/chat?conversationId=${conversationIdToDelete}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete conversation.");
      }

      if (conversationIdToDelete === conversationId) {
        handleNewChat();
      }

      await loadConversations();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete conversation.");
    }
  }

  async function streamAssistantReply(trimmed: string) {
    setError(null);
    setIsLoading(true);
    const userMessageId = createMessageId();
    const assistantMessageId = createMessageId();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setPendingMessageId(assistantMessageId);
    setMessages((prev) => [...prev, { id: userMessageId, role: "user", content: trimmed }, { id: assistantMessageId, role: "assistant", content: "", pending: true, retryText: trimmed }]);

    try {
      const response = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId, raceBundleId }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({ error: "Could not get a coaching response." }))) as { error?: string };
        throw new Error(data.error ?? "Could not get a coaching response.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const updateAssistant = (delta: string) => {
        setMessages((prev) => {
          return prev.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: `${message.content}${delta}`, pending: true, failed: false }
              : message
          );
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const eventLine = frame.split("\n").find((line) => line.startsWith("event:"));
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (!eventLine || !dataLine) {
            continue;
          }

          const eventName = eventLine.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;

          if (eventName === "message_start" && typeof data.conversationId === "string") {
            setConversationId(data.conversationId);
            continue;
          }

          if (eventName === "message_delta" && typeof data.chunk === "string") {
            updateAssistant(data.chunk);
            continue;
          }

          if (eventName === "error") {
            throw new Error(typeof data.error === "string" ? data.error : "Could not get a coaching response.");
          }

          if (eventName === "message_complete") {
            const completion = data as unknown as StreamCompletePayload;
            if (completion.conversationId) {
              setConversationId(completion.conversationId);
            }
            if (completion.structured) {
              setSummary(null);
              setMessages((prev) => {
                return prev.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: completion.structured.answer ?? message.content,
                        citations: Array.isArray(completion.structured.citations) ? completion.structured.citations : [],
                        pending: false,
                        failed: false
                      }
                    : message
                );
              });
            }
          }
        }
      }

      await loadConversations();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Something went wrong.";
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === assistantMessageId
            ? {
                ...entry,
                pending: false,
                failed: true,
                retryText: trimmed,
                content: entry.content.trim().length > 0 ? entry.content : `Could not get a coaching response. ${message}`
              }
            : entry
        )
      );
    } finally {
      setPendingMessageId(null);
      activeRequestRef.current = null;
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = input.trim();

    if (trimmed.length < 3 || isLoading) {
      return;
    }

    setInput("");
    await streamAssistantReply(trimmed);
  }

  function handleRetry(message: Message) {
    const retryText = message.retryText?.trim();
    if (!retryText || isLoading) {
      return;
    }

    void streamAssistantReply(retryText);
  }

  const historyGroups = (
    <CoachConversationHistory
      conversations={conversations}
      groups={memoizedGroups}
      activeId={conversationId}
      showOlder={showOlderConversations}
      onToggleOlder={() => setShowOlderConversations((prev) => !prev)}
      onSelect={(id) => void handleConversationClick(id)}
      onRename={(conversation, index) => void handleRenameConversation(conversation, index)}
      onDelete={(id) => void handleDeleteConversation(id)}
    />
  );

  return (
    <div className="space-y-4">
      {showBriefingPanel ? (
        <section className="surface p-5">
          <div className="border-b border-[hsl(var(--border))] pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--ai-accent-core))]">Coach briefing</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">{topInsight.headline}</h2>
            <p className="mt-1.5 max-w-3xl text-sm text-muted">{condensedRationale}</p>
          </div>
          <div className="mt-3 grid gap-3.5 lg:grid-cols-[1.25fr_0.75fr]">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">What to do next</p>
              <ul className="mt-1.5 space-y-1">
                {nextActions.slice(0, 2).map((action) => (
                  <li key={action} className="text-sm text-[hsl(var(--text-secondary))]">• {action}</li>
                ))}
              </ul>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Link
                  href={topInsight.primaryAction.href}
                  className={topInsight.primaryAction.label === "Ask why" ? "btn-secondary" : "btn-primary"}
                >
                  {topInsight.primaryAction.label}
                </Link>
                <a
                  href={topInsight.secondaryAction.href}
                  className="inline-flex items-center rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-[hsl(var(--text-secondary))] transition hover:border-[hsl(var(--ai-accent-core)/0.3)] hover:text-white"
                >
                  {topInsight.secondaryAction.label}
                </a>
              </div>
              <p className="mt-2 text-xs text-tertiary">{scoreTrendSummary}</p>
              <p className="mt-2 text-[11px] text-tertiary">
                {briefingContext.uploadedSessionCount} uploaded · {briefingContext.linkedSessionCount} linked · {briefingContext.reviewedSessionCount} reviewed
                {briefingContext.pendingReviewCount > 0 ? ` · ${briefingContext.pendingReviewCount} pending review` : ""}
              </p>
            </div>
            <div id="sessions-needing-attention" className="rounded-xl bg-[hsl(var(--surface-subtle))] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Sessions needing attention</p>
                <span className="text-xs text-tertiary">{flaggedSessions.length}</span>
              </div>
              {flaggedSessions.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted">{emptyAttentionText}</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {flaggedSessions.slice(0, 2).map((session) => (
                    <li key={session.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/sessions/${session.id}`} className="truncate text-[hsl(var(--text-secondary))] underline-offset-2 hover:text-white hover:underline">
                          {session.sessionName}
                        </Link>
                        <span className={`signal-chip ${statusChip(session.status).className}`}>{statusChip(session.status).label}</span>
                      </div>
                      {session.executionScoreBand ? (
                        <div className="mt-1">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${executionScoreBandTone(session.executionScoreBand)}`}>
                            {scoreHeadline(session)}
                          </span>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {latestScoredSession ? (
                <p className="mt-1.5 text-xs text-tertiary">
                  Latest reviewed session:{" "}
                  <Link href={`/sessions/${latestScoredSession.id}`} className="underline-offset-2 hover:text-white hover:underline">
                    {latestScoredSession.sessionName}
                  </Link>
                  {" · "}
                  {scoreHeadline(latestScoredSession)}
                </p>
              ) : null}
              {matchedSessions.length > 0 ? <p className="mt-1.5 text-xs text-tertiary">{matchedSessions.length} sessions on target.</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      <section id="coaching-chat" className="surface overflow-hidden">
        <div className="flex min-h-[420px] h-[calc(100dvh-var(--mobile-chrome)-80px)] flex-col lg:grid lg:h-[68vh] lg:max-h-[780px] lg:min-h-[560px] lg:grid-cols-[248px_1fr]">
          <aside className="hidden min-h-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-2.5 lg:flex">
            <button type="button" onClick={handleNewChat} className="rounded-md border border-[rgba(190,255,0,0.35)] bg-transparent px-3 py-1.5 text-sm text-[var(--color-accent)]">
              New conversation
            </button>
            <div className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {historyGroups}
            </div>
          </aside>

          <details className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className="font-medium text-white">History</span>
              <span className="text-xs text-tertiary">{conversations.length}</span>
            </summary>
            <div className="max-h-[40vh] space-y-3 overflow-y-auto p-2.5">
              <button type="button" onClick={handleNewChat} className="w-full rounded-md border border-[rgba(190,255,0,0.35)] bg-transparent px-3 py-1.5 text-sm text-[var(--color-accent)]">
                New conversation
              </button>
              {historyGroups}
            </div>
          </details>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-[hsl(var(--border))] bg-gradient-to-r from-[hsl(var(--surface-1))] to-[hsl(var(--surface-2))] px-4 py-2 sm:py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="label hidden sm:block">Active conversation</p>
                  <h3 className="truncate text-sm font-semibold sm:mt-0.5 sm:text-base">{activeConversation ? activeConversation.title || "Untitled conversation" : "New conversation"}</h3>
                  <p className="text-[11px] text-muted sm:mt-0.5 sm:text-sm">{dataRecency}</p>
                </div>
              </div>
            </div>
            <div className="hidden border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-4 py-2 sm:block">
              <p className="text-xs text-[hsl(var(--text-secondary))]">
                {sessionDiagnoses.length > 0
                  ? `${sessionDiagnoses.length} reviewed this week${flaggedSessions.length > 0 ? ` · ${flaggedSessions.length} needing attention` : ""}. Focus: ${nextActions[0] ?? "Stabilise execution quality."}`
                  : briefingContext.pendingReviewCount > 0
                    ? `${briefingContext.pendingReviewCount} linked session${briefingContext.pendingReviewCount > 1 ? "s" : ""} waiting for review. Use chat for missed-workout decisions, week adjustments, or upload interpretation in the meantime.`
                    : "Reviews are still building. Use chat for missed-workout decisions, week adjustments, or upload interpretation in the meantime."}
              </p>
            </div>

            <div
              ref={messagesViewportRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                shouldAutoScrollRef.current = distanceToBottom < 40;
              }}
              className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3"
            >
              {messages.map((message) => (
                <CoachMessage
                  key={message.id}
                  message={message}
                  onRetry={handleRetry}
                  raceBundleId={raceBundleId}
                  onCitationClick={onCitationClick}
                />
              ))}
            </div>

            <form onSubmit={handleSubmit} className="sticky bottom-0 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] sm:pb-2.5">
              <label htmlFor="coach-input" className="sr-only">
                Ask your triathlon coach
              </label>
              <div className="-mx-4 mb-1.5 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="shrink-0 whitespace-nowrap rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1 text-[12px] font-medium text-[rgba(255,255,255,0.55)] transition hover:border-[rgba(255,255,255,0.16)] hover:text-[rgba(255,255,255,0.75)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  id="coach-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask how to execute better and what to adjust next..."
                  className="w-full min-w-0 rounded-md border border-[rgba(255,255,255,0.08)] bg-[#18181C] px-3 py-2 text-[rgba(255,255,255,0.8)] placeholder:text-[rgba(255,255,255,0.25)] focus:border-[rgba(190,255,0,0.30)]"
                  disabled={isLoading}
                  inputMode="text"
                  enterKeyHint="send"
                  autoComplete="off"
                  autoCapitalize="sentences"
                />
                <button type="submit" disabled={isLoading} aria-label="Send" className="btn-primary inline-flex shrink-0 items-center justify-center px-3 disabled:opacity-70 sm:px-4">
                  <span className="hidden sm:inline">Send</span>
                  <svg className="sm:hidden" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                </button>
                {isLoading ? (
                  <button type="button" onClick={handleStopStreaming} aria-label="Stop" className="inline-flex shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border))] px-3 text-sm text-[hsl(var(--text-secondary))] hover:text-white">
                    <span className="hidden sm:inline">Stop</span>
                    <svg className="sm:hidden" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
                  </button>
                ) : null}
              </div>
              {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
