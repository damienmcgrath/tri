"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CoachDiagnosisSession } from "./types";
import { getDiagnosisDataState } from "@/lib/ui/sparse-data";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type CoachSummary = {
  plannedMinutes: number;
  completedMinutes: number;
  completionPct: number;
  dominantSport: string;
  insights: string[];
};

type Conversation = {
  id: string;
  title: string;
  updated_at: string;
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
  };
};

type IntentMatchStatus = "matched" | "partial" | "missed";
type SessionDiagnosis = CoachDiagnosisSession;

type TopCoachingInsight = {
  headline: string;
  rationale: string;
  primaryAction: { label: string; href: string };
  secondaryAction: { label: string; href: string };
  confidenceNote: string | null;
};

type DiagnosisTheme = "easy_drift" | "recovery_slip" | "threshold_inconsistent" | "endurance_strong" | "general";

type RankedSession = SessionDiagnosis & {
  rankingScore: number;
  themes: DiagnosisTheme[];
};

const defaultAssistantMessage: Message = {
  role: "assistant",
  content:
    "I can diagnose whether completed sessions matched their intended purpose, then help you decide exactly how to adjust the rest of your week."
};

function formatRecencyLabel(updatedAt?: string): string {
  if (!updatedAt) {
    return "Ready to start";
  }

  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Updated just now";
  }

  if (diffMinutes < 60) {
    return `Updated ${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

function deriveTopInsight(sessions: SessionDiagnosis[]): TopCoachingInsight {
  const hasEnoughDiagnosis = sessions.length >= 2;
  if (!hasEnoughDiagnosis) {
    return {
      headline: "Start with 1–2 completed sessions to unlock intent-match coaching",
      rationale:
        "You can already ask about missed-session recovery, schedule adjustments, and conservative load planning. As soon as more workouts are completed, session-quality diagnosis becomes specific.",
      primaryAction: { label: "Ask why", href: "#coaching-chat" },
      secondaryAction: { label: "Review weekly plan", href: "/plan" },
      confidenceNote: "Provisional insight"
    };
  }

  const rankedSessions = rankFlaggedSessions(sessions);
  const strongestFlag = rankedSessions[0];

  if (!strongestFlag) {
    const strongEnduranceSignal = sessions.some((session) => inferThemes(session).includes("endurance_strong"));

    return {
      headline: strongEnduranceSignal ? "Endurance execution is strong — stay the course" : "Execution quality is strong — stay the course",
      rationale:
        "Recent completed sessions are aligning with intended purpose. Maintain current structure and only progress if recovery remains stable.",
      primaryAction: { label: "Review recommendation", href: "/plan" },
      secondaryAction: { label: "What matters most now?", href: "#coaching-chat" },
      confidenceNote: null
    };
  }

  const missedCount = rankedSessions.filter((session) => session.status === "missed").length;
  const partialCount = rankedSessions.filter((session) => session.status === "partial").length;

  if (strongestFlag.themes.includes("easy_drift")) {
    return {
      headline: "Easy sessions are drifting too hard",
      rationale:
        "Diagnosis is repeatedly detecting intensity drift away from easy intent. Protecting low-intensity execution now improves recovery and quality-session readiness.",
      primaryAction: { label: "See what to change", href: "#sessions-needing-attention" },
      secondaryAction: { label: "How to keep Z2 easy", href: "#coaching-chat" },
      confidenceNote: "Diagnosis confidence: useful"
    };
  }

  if (strongestFlag.themes.includes("recovery_slip")) {
    return {
      headline: "Recovery quality is slipping",
      rationale: strongestFlag.whyItMatters,
      primaryAction: { label: "Protect recovery", href: "/plan" },
      secondaryAction: { label: "Review flagged sessions", href: "#sessions-needing-attention" },
      confidenceNote: strongestFlag.confidenceNote ?? null
    };
  }

  if (strongestFlag.themes.includes("threshold_inconsistent")) {
    return {
      headline: "Threshold execution is inconsistent",
      rationale:
        "Quality-session diagnosis shows uneven control versus planned intent. Tightening pacing before adding load will improve adaptation quality.",
      primaryAction: { label: "Adjust this week", href: "/plan" },
      secondaryAction: { label: "Ask why", href: "#coaching-chat" },
      confidenceNote: strongestFlag.confidenceNote ?? null
    };
  }

  if (strongestFlag.status === "missed") {
    return {
      headline: strongestFlag.executionSummary,
      rationale: strongestFlag.whyItMatters,
      primaryAction: { label: "Adjust this week", href: "/plan" },
      secondaryAction: { label: "Review flagged sessions", href: "#sessions-needing-attention" },
      confidenceNote: "Diagnosis confidence: useful"
    };
  }

  if (missedCount >= 1 || partialCount >= 1) {
    return {
      headline: strongestFlag?.executionSummary ?? "Execution quality is mixed — tighten intent on easy days",
      rationale:
        strongestFlag?.whyItMatters ??
        "You have enough completion to progress, but easy/recovery intent is not consistently protected. Small execution changes now can improve adaptation quality this week.",
      primaryAction: { label: "See what to change", href: "#sessions-needing-attention" },
      secondaryAction: { label: "Ask why", href: "#coaching-chat" },
      confidenceNote: null
    };
  }

  return {
    headline: "Execution quality is strong — stay the course",
    rationale:
      "Recent completed sessions are aligning with intended purpose. Maintain current structure and only progress if recovery remains stable.",
    primaryAction: { label: "Review recommendation", href: "/plan" },
    secondaryAction: { label: "What matters most now?", href: "#coaching-chat" },
    confidenceNote: null
  };
}

function inferThemes(session: SessionDiagnosis): DiagnosisTheme[] {
  const searchable = [session.plannedIntent, session.executionSummary, session.nextAction, session.whyItMatters, ...session.evidence]
    .join(" ")
    .toLowerCase();
  const themes = new Set<DiagnosisTheme>();

  if (/(easy|z1|z2|recovery ride|recovery run|too hard|high intensity)/.test(searchable)) {
    themes.add("easy_drift");
  }

  if (/(recover|fatigue|fresh|sleep|rest|carryover)/.test(searchable)) {
    themes.add("recovery_slip");
  }

  if (/(threshold|tempo|interval|vo2|quality)/.test(searchable)) {
    themes.add("threshold_inconsistent");
  }

  if (session.status === "matched" && /(endurance|long|aerobic|z2)/.test(searchable)) {
    themes.add("endurance_strong");
  }

  if (themes.size === 0) {
    themes.add("general");
  }

  return [...themes];
}

function rankFlaggedSessions(sessions: SessionDiagnosis[]): RankedSession[] {
  return sessions
    .filter((session) => session.status !== "matched")
    .map((session) => {
      const themes = inferThemes(session);
      const statusWeight = session.status === "missed" ? 40 : 20;
      const scorePenalty = session.executionScore === null ? 0 : Math.max(0, 30 - Math.round(session.executionScore / 3));
      const bandWeight = session.executionScoreBand === "Missed intent" ? 20 : session.executionScoreBand === "Partial match" ? 10 : 0;
      const evidenceWeight = Math.min(session.evidence.length * 3, 9);
      const rankingScore = statusWeight + scorePenalty + bandWeight + evidenceWeight + session.importance;

      return { ...session, rankingScore, themes };
    })
    .sort((a, b) => b.rankingScore - a.rankingScore)
    .slice(0, 3);
}

function statusChip(status: IntentMatchStatus): { label: string; className: string } {
  if (status === "matched") {
    return { label: "Matched intent", className: "signal-ready" };
  }
  if (status === "partial") {
    return { label: "Partially matched", className: "signal-load" };
  }
  return { label: "Missed intent", className: "signal-risk" };
}

function executionScoreBandTone(band: SessionDiagnosis["executionScoreBand"]): string {
  if (band === "On target") {
    return "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]";
  }
  if (band === "Partial match") {
    return "border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] text-[hsl(var(--warning))]";
  }
  return "border-[hsl(var(--danger)/0.3)] bg-[hsl(var(--danger)/0.08)] text-[hsl(var(--danger))]";
}

export function CoachChat({ diagnosisSessions, initialPrompt }: { diagnosisSessions: SessionDiagnosis[]; initialPrompt?: string }) {
  const [messages, setMessages] = useState<Message[]>([defaultAssistantMessage]);
  const [summary, setSummary] = useState<CoachSummary | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const sessionDiagnoses = useMemo(() => diagnosisSessions, [diagnosisSessions]);
  const flaggedSessions = useMemo(() => rankFlaggedSessions(sessionDiagnoses), [sessionDiagnoses]);
  const matchedSessions = useMemo(() => sessionDiagnoses.filter((session) => session.status === "matched"), [sessionDiagnoses]);
  const topInsight = useMemo(() => deriveTopInsight(sessionDiagnoses), [sessionDiagnoses]);
  const dataState = useMemo(() => getDiagnosisDataState(sessionDiagnoses.length), [sessionDiagnoses.length]);

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
    if (sessionDiagnoses.length < 2) {
      return [
        "Which session should I protect this week?",
        "How should I adjust this week?",
        "Missed workout recovery",
        "What should stay easy vs key?"
      ];
    }

    const prompts = ["Why was this session flagged?", "Should I repeat this workout?", "How should I adjust the rest of the week?"];

    if (strongestTheme === "easy_drift") {
      prompts.splice(1, 0, "How do I keep Z2 truly easy?");
    }
    if (strongestTheme === "recovery_slip") {
      prompts.splice(1, 0, "How do I protect recovery this week?");
    }
    if (strongestTheme === "threshold_inconsistent") {
      prompts.splice(1, 0, "Was this fatigue or pacing?");
    }

    prompts.push("What matters most now?");
    return prompts;
  }, [sessionDiagnoses, strongestTheme]);

  const dataRecency = useMemo(() => {
    const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
    return formatRecencyLabel(activeConversation?.updated_at ?? conversations[0]?.updated_at);
  }, [conversationId, conversations]);
  const activeConversation = useMemo(() => conversations.find((conversation) => conversation.id === conversationId) ?? null, [conversations, conversationId]);

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
    if (initialPrompt && initialPrompt.trim().length > 0) {
      setInput(initialPrompt.trim());
    }
  }, [initialPrompt]);

  async function handleConversationClick(nextConversationId: string) {
    setError(null);

    try {
      const response = await fetch(`/api/coach/chat?conversationId=${nextConversationId}`, { method: "GET" });
      const data = (await response.json()) as { messages?: Message[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load conversation.");
      }

      setConversationId(nextConversationId);
      setMessages(data.messages?.length ? data.messages : [defaultAssistantMessage]);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Failed to load conversation.");
    }
  }

  function handleNewChat() {
    setConversationId(null);
    setMessages([defaultAssistantMessage]);
    setSummary(null);
    setError(null);
  }

  function conversationTitle(conversation: Conversation, index: number) {
    const trimmed = conversation.title.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return `Conversation ${conversations.length - index}`;
  }

  async function handleRenameConversation(conversation: Conversation, index: number) {
    const nextTitle = window.prompt("Rename conversation", conversationTitle(conversation, index));

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = input.trim();

    if (trimmed.length < 3 || isLoading) {
      return;
    }

    setError(null);
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }, { role: "assistant", content: "" }]);
    setInput("");

    try {
      const response = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId })
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
          const next = [...prev];
          const lastIndex = next.length - 1;
          if (lastIndex >= 0 && next[lastIndex]?.role === "assistant") {
            next[lastIndex] = { ...next[lastIndex], content: `${next[lastIndex].content}${delta}` };
          }
          return next;
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
                const next = [...prev];
                const lastIndex = next.length - 1;
                if (lastIndex >= 0 && next[lastIndex]?.role === "assistant") {
                  next[lastIndex] = { ...next[lastIndex], content: completion.structured.answer ?? next[lastIndex].content };
                }
                return next;
              });
            }
          }
        }
      }

      await loadConversations();
    } catch (submitError) {
      setMessages((prev) => {
        const next = [...prev];
        const lastIndex = next.length - 1;
        if (lastIndex >= 0 && next[lastIndex]?.role === "assistant" && next[lastIndex].content.trim().length === 0) {
          next.pop();
        }
        return next;
      });
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface p-5">
        <div className="border-b border-[hsl(var(--border))] pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--ai-accent-core))]">Coach briefing</p>
          <h2 className="mt-2 text-2xl font-semibold text-[hsl(var(--text-primary))]">{topInsight.headline}</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">{topInsight.rationale}</p>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">What to do next</p>
            <ul className="mt-2 space-y-1.5">
              {nextActions.slice(0, 2).map((action) => (
                <li key={action} className="text-sm text-[hsl(var(--text-secondary))]">• {action}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={topInsight.primaryAction.href} className="btn-primary">
                {topInsight.primaryAction.label}
              </Link>
              <a href={topInsight.secondaryAction.href} className="text-sm font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]">
                {topInsight.secondaryAction.label}
              </a>
            </div>
          </div>
          <div className="rounded-xl bg-[hsl(var(--surface-subtle))] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Sessions needing attention</p>
              <span className="text-xs text-tertiary">{flaggedSessions.length}</span>
            </div>
            {flaggedSessions.length === 0 ? (
              <p className="mt-2 text-xs text-muted">{dataState.unlockText}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {flaggedSessions.slice(0, 2).map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-[hsl(var(--text-secondary))]">{session.sessionName}</span>
                    <span className={`signal-chip ${statusChip(session.status).className}`}>{statusChip(session.status).label}</span>
                  </li>
                ))}
              </ul>
            )}
            {matchedSessions.length > 0 ? <p className="mt-2 text-xs text-tertiary">{matchedSessions.length} sessions on target.</p> : null}
          </div>
        </div>
      </section>

      <section id="coaching-chat" className="surface overflow-hidden">
        <div className="grid min-h-[560px] lg:grid-cols-[280px_1fr]">
          <aside className="border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <button type="button" onClick={handleNewChat} className="btn-primary w-full justify-center">
              New conversation
            </button>
            <div className="mt-3 space-y-1">
              {conversations.map((conversation, index) => {
                const isActive = conversation.id === conversationId;

                return (
                  <div key={conversation.id} className={`rounded-xl border px-2 py-2 ${isActive ? "border-[hsl(var(--ai-accent-core)/0.4)] bg-[hsl(var(--ai-accent-core)/0.1)]" : "border-transparent hover:border-[hsl(var(--border))]"}`}>
                    <div className="flex items-start justify-between gap-1">
                      <button type="button" onClick={() => void handleConversationClick(conversation.id)} className="min-w-0 flex-1 text-left">
                        <p className={`truncate text-sm font-medium ${isActive ? "text-[hsl(var(--text-primary))]" : "text-[hsl(var(--text-secondary))]"}`}>
                          {conversationTitle(conversation, index)}
                        </p>
                        <p className="mt-0.5 text-xs text-tertiary">{formatRecencyLabel(conversation.updated_at)}</p>
                      </button>
                      <details className="relative">
                        <summary className="cursor-pointer list-none px-1 text-sm text-tertiary hover:text-[hsl(var(--text-primary))]">⋯</summary>
                        <div className="absolute right-0 z-10 mt-1 w-28 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-1 text-xs shadow-md">
                          <button type="button" onClick={() => void handleRenameConversation(conversation, index)} className="block w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--surface-2))]">Rename</button>
                          <button type="button" onClick={() => void handleDeleteConversation(conversation.id)} className="block w-full rounded px-2 py-1 text-left text-rose-300 hover:bg-[hsl(var(--surface-2))]">Delete</button>
                        </div>
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          <div className="flex flex-col">
        <div className="border-b border-[hsl(var(--border))] bg-gradient-to-r from-[hsl(var(--surface-1))] to-[hsl(var(--surface-2))] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--ai-accent-core))]">Active conversation</p>
              <h3 className="mt-0.5 text-base font-semibold">{activeConversation ? activeConversation.title || "Untitled conversation" : "New conversation"}</h3>
              <p className="mt-0.5 text-sm text-muted">{dataRecency}</p>
            </div>
          </div>
        </div>
        <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-4 py-2 text-xs text-[hsl(var(--text-secondary))]">
          <p className="font-medium text-[hsl(var(--text-primary))]">Current coaching context</p>
          <p className="mt-0.5">Insight: {topInsight.headline} · Focus this week: {nextActions[0] ?? "Stabilise execution quality."}</p>
          <p className="mt-0.5">Flagged sessions: {flaggedSessions.length} · Diagnosis context: {dataState.guidanceText}</p>
        </div>

        <div className="max-h-[360px] flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                  message.role === "user"
                    ? "bg-[hsl(var(--ai-accent-core))] text-white"
                    : "bg-[hsl(var(--surface-2))] text-[hsl(var(--text-secondary))]"
                }`}
              >
                {message.content}{isLoading && message.role === "assistant" && index === messages.length - 1 ? " ▍" : ""}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-3">
          <label htmlFor="coach-input" className="sr-only">
            Ask your triathlon coach
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setInput(prompt)}
                className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--text-secondary))] transition hover:border-[hsl(var(--ai-accent-core)/0.3)] hover:text-[hsl(var(--text-primary))]"
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
              className="input-base"
            />
            <button type="submit" disabled={isLoading} className="btn-primary disabled:opacity-70">
              Send
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
        </form>
          </div>
        </div>
      </section>
    </div>
  );
}
