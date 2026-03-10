"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { CoachDiagnosisSession } from "./types";

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

type IntentMatchStatus = "matched" | "partial" | "missed";
type SessionDiagnosis = CoachDiagnosisSession;

type TopCoachingInsight = {
  headline: string;
  rationale: string;
  primaryAction: { label: string; href: string };
  secondaryAction: { label: string; href: string };
  confidenceNote: string | null;
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

  const missedCount = sessions.filter((session) => session.status === "missed").length;
  const partialCount = sessions.filter((session) => session.status === "partial").length;

  const strongestFlag = sessions.find((session) => session.status !== "matched");

  if (strongestFlag?.status === "missed") {
    return {
      headline: strongestFlag.executionSummary,
      rationale: strongestFlag.whyItMatters,
      primaryAction: { label: "Adjust this week", href: "/plan" },
      secondaryAction: { label: "Review flagged sessions", href: "#sessions-needing-attention" },
      confidenceNote: "Diagnosis confidence: useful"
    };
  }

  if (missedCount === 1 || partialCount >= 1) {
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
      "Most completed sessions appear aligned with intended purpose. Keep the current structure and only make small progression decisions if recovery remains stable.",
    primaryAction: { label: "Review recommendation", href: "/plan" },
    secondaryAction: { label: "What matters most now?", href: "#coaching-chat" },
    confidenceNote: null
  };
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
  const flaggedSessions = useMemo(
    () => sessionDiagnoses.filter((session) => session.status !== "matched").slice(0, 3),
    [sessionDiagnoses]
  );
  const matchedSessions = useMemo(() => sessionDiagnoses.filter((session) => session.status === "matched"), [sessionDiagnoses]);
  const topInsight = useMemo(() => deriveTopInsight(sessionDiagnoses), [sessionDiagnoses]);

  const nextActions = useMemo(() => {
    if (sessionDiagnoses.length < 2) {
      return [
        "Protect 2–3 key sessions this week and keep the rest deliberately easy.",
        "Use Calendar to move sessions instead of stacking missed work.",
        "Ask for a conservative adjustment if recovery feels off."
      ];
    }

    const actions = flaggedSessions.map((session) => session.nextAction);
    if ((summary?.completionPct ?? 100) < 75) {
      actions.push("Keep easy days easy until execution signals stabilise.");
    } else {
      actions.push("Keep volume steady this week and improve pacing quality before progressing.");
    }
    return actions.slice(0, 4);
  }, [summary?.completionPct, sessionDiagnoses, flaggedSessions]);

  const quickPrompts = useMemo(() => {
    if (sessionDiagnoses.length < 2) {
      return [
        "What matters most now?",
        "How should I adjust this week?",
        "Missed workout recovery",
        "Build a conservative week"
      ];
    }

    return [
      "Why was this session flagged?",
      "How do I keep Z2 truly easy?",
      "Should I repeat this workout?",
      "Adjust the rest of my week",
      "Was this fatigue or pacing?",
      "What matters most now?"
    ];
  }, [sessionDiagnoses]);

  const dataRecency = useMemo(() => {
    const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
    return formatRecencyLabel(activeConversation?.updated_at ?? conversations[0]?.updated_at);
  }, [conversationId, conversations]);

  const meaningfulRecentThreads = useMemo(
    () =>
      conversations
        .filter((conversation) => conversation.title.trim().length > 0)
        .slice(0, 4),
    [conversations]
  );

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = input.trim();

    if (trimmed.length < 3 || isLoading) {
      return;
    }

    setError(null);
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");

    try {
      const response = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId })
      });

      const data = (await response.json()) as {
        answer?: string;
        error?: string;
        summary?: CoachSummary;
        conversationId?: string;
      };

      if (!response.ok || !data.answer) {
        throw new Error(data.error ?? "Could not get a coaching response.");
      }

      if (data.conversationId) {
        setConversationId(data.conversationId);
      }

      setSummary(data.summary ?? null);
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer! }]);
      await loadConversations();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--ai-accent-core))]">Top coaching insight</p>
        <h2 className="mt-2 text-2xl font-semibold text-[hsl(var(--text-primary))]">{topInsight.headline}</h2>
        <p className="mt-3 max-w-3xl text-sm text-muted">{topInsight.rationale}</p>
        {topInsight.confidenceNote ? (
          <p className="mt-3 inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-2.5 py-1 text-xs text-[hsl(var(--text-secondary))]">
            {topInsight.confidenceNote}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={topInsight.primaryAction.href} className="btn-primary">
            {topInsight.primaryAction.label}
          </Link>
          <a
            href={topInsight.secondaryAction.href}
            className="inline-flex items-center rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-[hsl(var(--text-secondary))] transition hover:border-[hsl(var(--ai-accent-core)/0.35)] hover:text-[hsl(var(--text-primary))]"
          >
            {topInsight.secondaryAction.label}
          </a>
        </div>
      </section>

      <section id="sessions-needing-attention" className="surface-subtle p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[hsl(var(--text-primary))]">Sessions needing attention</h3>
          <span className="text-xs text-tertiary">{dataRecency}</span>
        </div>

        {flaggedSessions.length === 0 ? (
          <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-3">
            <p className="text-sm text-muted">No high-confidence session flags yet.</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-tertiary">
              <li>Once a few completed workouts have intent-match results, this section will rank the top sessions needing attention.</li>
              <li>Each card will explain what happened, why it matters, and exactly what to do in the next similar session.</li>
            </ul>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {flaggedSessions.map((session) => {
              const status = statusChip(session.status);

              return (
                <article key={session.id} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">{session.sessionName}</p>
                    <div className="flex items-center gap-2">
                      {session.executionScore !== null && session.executionScoreBand ? (
                        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-2.5 py-2 text-right">
                          <p className="text-[10px] uppercase tracking-[0.14em] text-tertiary">Execution Score</p>
                          <p className="mt-1 text-sm font-semibold text-[hsl(var(--text-primary))]">
                            {session.executionScore} · {session.executionScoreBand}
                            {session.executionScoreProvisional ? " · Provisional" : ""}
                          </p>
                        </div>
                      ) : null}
                      <span className={`signal-chip ${status.className}`}>{status.label}</span>
                    </div>
                  </div>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Planned</dt>
                      <dd className="text-[hsl(var(--text-secondary))]">{session.plannedIntent}</dd>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2.5">
                      {session.executionScoreBand ? (
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${executionScoreBandTone(session.executionScoreBand)}`}
                        >
                          {session.executionScoreBand}
                        </span>
                      ) : null}
                      <dt className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Actual</dt>
                      <dd className="mt-1 text-[hsl(var(--text-secondary))]">{session.executionSummary}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Why it matters</dt>
                      <dd className="text-[hsl(var(--text-secondary))]">{session.whyItMatters}</dd>
                    </div>
                    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2.5">
                      <dt className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Next time</dt>
                      <dd className="mt-1 font-medium text-[hsl(var(--text-primary))]">{session.nextAction}</dd>
                    </div>
                    {session.confidenceNote ? (
                      <div>
                        <dt className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Confidence</dt>
                        <dd className="text-[hsl(var(--text-secondary))]">{session.confidenceNote}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="mt-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Why this was flagged</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
                      {session.evidence.map((signal) => (
                        <li key={signal}>{signal}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/sessions/${session.id}`} className="text-xs font-medium text-[hsl(var(--ai-accent-core))] hover:underline">
                      Open session review
                    </Link>
                    <a href="#coaching-chat" className="text-xs font-medium text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]">
                      Ask about this workout
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {matchedSessions.length > 0 ? (
          <p className="mt-3 text-xs text-tertiary">{matchedSessions.length} completed session(s) matched intended purpose and were not flagged.</p>
        ) : null}
      </section>

      <section className="surface p-5">
        <h3 className="text-sm font-semibold text-[hsl(var(--text-primary))]">What to do next</h3>
        <ul className="mt-3 space-y-2">
          {nextActions.map((action) => (
            <li key={action} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-2 text-sm text-[hsl(var(--text-secondary))]">
              {action}
            </li>
          ))}
        </ul>
      </section>

      <section id="coaching-chat" className="surface overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] bg-gradient-to-r from-[hsl(var(--surface-1))] to-[hsl(var(--surface-2))] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--ai-accent-core))]">Coaching chat</p>
              <h3 className="mt-0.5 text-base font-semibold">Refine today&apos;s diagnosis</h3>
              <p className="mt-0.5 text-sm text-muted">Ask what caused a mismatch, how to execute better, and whether this week should adapt.</p>
            </div>
            <button type="button" onClick={handleNewChat} className="text-xs font-medium text-[hsl(var(--ai-accent-core))] hover:underline">
              New conversation
            </button>
          </div>
        </div>

        {meaningfulRecentThreads.length > 0 ? (
          <div className="border-b border-[hsl(var(--border))] px-4 py-2">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Recent threads</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {meaningfulRecentThreads.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => void handleConversationClick(conversation.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    conversationId === conversation.id
                      ? "border-[hsl(var(--ai-accent-core)/0.4)] bg-[hsl(var(--ai-accent-core)/0.12)] text-[hsl(var(--text-primary))]"
                      : "border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"
                  }`}
                >
                  {conversation.title.trim()} · {formatRecencyLabel(conversation.updated_at)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="max-h-[320px] space-y-2 overflow-y-auto p-4">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm ${
                  message.role === "user"
                    ? "bg-[hsl(var(--ai-accent-core))] text-white"
                    : "border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] text-[hsl(var(--text-secondary))]"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-4 w-4/5 animate-pulse rounded bg-[hsl(var(--bg-card))]" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-[hsl(var(--bg-card))]" />
            </div>
          ) : null}
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
      </section>
    </div>
  );
}
