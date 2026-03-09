"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

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

type PrimaryRecommendation = {
  headline: string;
  rationale: string;
  primaryAction: { label: string; href: string };
  secondaryAction: { label: string; href: string };
  confidenceNote: string | null;
  provisionalGuidance: string | null;
};

const defaultAssistantMessage: Message = {
  role: "assistant",
  content:
    "I can help you refine this week based on missed sessions, recovery needs, and schedule constraints. Ask for a recommendation and we’ll tune it together."
};

const quickPrompts = [
  "What matters most this week?",
  "Adjust this week",
  "Missed workout recovery",
  "Reduce load",
  "Taper advice",
  "Move sessions around recovery"
];

function formatRecencyLabel(updatedAt?: string): string {
  if (!updatedAt) {
    return "No recent sync";
  }

  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Synced just now";
  }

  if (diffMinutes < 60) {
    return `Synced ${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Synced ${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Synced ${diffDays}d ago`;
}

function buildPrimaryRecommendation(summary: CoachSummary | null): PrimaryRecommendation {
  if (!summary || summary.plannedMinutes === 0) {
    return {
      headline: "Start with 1–2 completed sessions to unlock stronger guidance",
      rationale:
        "Current recommendation is provisional until more training data is available. You can still get support for schedule changes, missed-session recovery, or conservative load planning.",
      primaryAction: { label: "Ask a follow-up", href: "#coaching-chat" },
      secondaryAction: { label: "Open weekly plan", href: "/plan" },
      confidenceNote: "Provisional guidance",
      provisionalGuidance: "Complete one or two sessions this week to improve recommendation quality."
    };
  }

  const remainingMinutes = Math.max(summary.plannedMinutes - summary.completedMinutes, 0);

  if (summary.completionPct < 65) {
    return {
      headline: "Reduce load 10–20% and prioritize completion",
      rationale:
        "Your recent completion pattern suggests this week will benefit more from consistency than from adding volume. Protect key sessions and reduce lower-priority load.",
      primaryAction: { label: "Apply to weekly plan", href: "/plan" },
      secondaryAction: { label: "Ask follow-up", href: "#coaching-chat" },
      confidenceNote: "Moderate confidence",
      provisionalGuidance:
        remainingMinutes > 0
          ? `You still have about ${remainingMinutes} minutes planned, so a smaller, focused finish is likely to be higher quality.`
          : null
    };
  }

  if (summary.completionPct < 85) {
    return {
      headline: "Hold current load and reassess after one key session",
      rationale:
        "You are in a workable range. The best next move is protecting quality workouts, then using one more completed session to confirm whether to progress or trim.",
      primaryAction: { label: "Review recommendation", href: "/plan" },
      secondaryAction: { label: "Open coaching chat", href: "#coaching-chat" },
      confidenceNote: null,
      provisionalGuidance: null
    };
  }

  return {
    headline: "Maintain load and consider a small quality progression",
    rationale:
      "Your completion is strong, so you can keep the weekly structure and cautiously progress one key session if recovery remains stable.",
    primaryAction: { label: "Apply to weekly plan", href: "/plan" },
    secondaryAction: { label: "Open coaching chat", href: "#coaching-chat" },
    confidenceNote: null,
    provisionalGuidance: null
  };
}

export function CoachChat() {
  const [messages, setMessages] = useState<Message[]>([defaultAssistantMessage]);
  const [summary, setSummary] = useState<CoachSummary | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const primaryRecommendation = useMemo(() => buildPrimaryRecommendation(summary), [summary]);

  const dataRecency = useMemo(() => {
    const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
    return formatRecencyLabel(activeConversation?.updated_at ?? conversations[0]?.updated_at);
  }, [conversationId, conversations]);

  const evidenceItems = useMemo(() => {
    if (!summary || summary.plannedMinutes === 0) {
      return [
        { label: "Current state", value: "Recommendation is provisional with limited recent training data." },
        { label: "How to improve guidance", value: "Complete 1–2 sessions or sync another recent activity." },
        { label: "Still useful now", value: "Ask about schedule changes, missed-session recovery, or load adjustment." }
      ];
    }

    const remainingMinutes = Math.max(summary.plannedMinutes - summary.completedMinutes, 0);
    const recoverySignal =
      summary.completionPct >= 85 ? "Stable recovery trend" : summary.completionPct >= 65 ? "Watch fatigue over 48h" : "Elevated recovery risk";

    return [
      { label: "Completion this week", value: `${summary.completedMinutes} / ${summary.plannedMinutes} min (${summary.completionPct}%)` },
      { label: "Recovery signal", value: recoverySignal },
      { label: "Load trend", value: remainingMinutes > 0 ? `${remainingMinutes} min still planned this week.` : "Weekly load mostly completed." },
      { label: "Dominant concern", value: summary.insights[0] ?? "Preserve key sessions while managing fatigue." },
      { label: "How to improve guidance", value: "Complete one more quality workout before the next adjustment." }
    ];
  }, [summary]);

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
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--ai-accent-core))]">Coach briefing</p>
        <h2 className="mt-2 text-2xl font-semibold text-[hsl(var(--text-primary))]">{primaryRecommendation.headline}</h2>
        <p className="mt-3 max-w-3xl text-sm text-muted">{primaryRecommendation.rationale}</p>
        {primaryRecommendation.confidenceNote ? (
          <p className="mt-3 inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-1 text-xs text-[hsl(var(--text-secondary))]">
            {primaryRecommendation.confidenceNote}
          </p>
        ) : null}
        {primaryRecommendation.provisionalGuidance ? <p className="mt-3 text-sm text-tertiary">{primaryRecommendation.provisionalGuidance}</p> : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={primaryRecommendation.primaryAction.href} className="btn-primary">
            {primaryRecommendation.primaryAction.label}
          </Link>
          <a
            href={primaryRecommendation.secondaryAction.href}
            className="inline-flex items-center rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-[hsl(var(--text-secondary))] transition hover:border-[hsl(var(--ai-accent-core)/0.35)] hover:text-[hsl(var(--text-primary))]"
          >
            {primaryRecommendation.secondaryAction.label}
          </a>
        </div>
      </section>

      <section className="surface-subtle p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[hsl(var(--text-primary))]">Why this recommendation</h3>
          <span className="text-xs text-tertiary">{dataRecency}</span>
        </div>
        <ul className="mt-4 space-y-2">
          {evidenceItems.map((item) => (
            <li key={item.label} className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{item.label}</p>
              <p className="mt-1 text-sm text-[hsl(var(--text-secondary))]">{item.value}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="coaching-chat" className="surface overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] bg-gradient-to-r from-[hsl(var(--surface-1))] to-[hsl(var(--surface-2))] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--ai-accent-core))]">Coaching chat</p>
              <h3 className="mt-1 text-lg font-semibold">Refine this recommendation through conversation</h3>
              <p className="mt-1 text-sm text-muted">Ask for tradeoffs, alternatives, or schedule-specific adjustments.</p>
            </div>
            <button type="button" onClick={handleNewChat} className="text-xs font-medium text-[hsl(var(--ai-accent-core))] hover:underline">
              New conversation
            </button>
          </div>
        </div>

        {conversations.length > 0 ? (
          <div className="border-b border-[hsl(var(--border))] px-5 py-3">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Recent threads</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {conversations.slice(0, 4).map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => void handleConversationClick(conversation.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    conversationId === conversation.id
                      ? "border-[hsl(var(--ai-accent-core)/0.4)] bg-[hsl(var(--ai-accent-core)/0.12)] text-[hsl(var(--text-primary))]"
                      : "border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]"
                  }`}
                >
                  {conversation.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="max-h-[460px] space-y-3 overflow-y-auto p-5">
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

        <details className="border-t border-[hsl(var(--border))] px-5 py-3">
          <summary className="cursor-pointer text-sm font-medium text-[hsl(var(--text-secondary))]">Why this recommendation (details)</summary>
          <p className="mt-2 text-sm text-muted">
            This recommendation prioritizes completion quality, recovery context, and weekly load risk. Use chat to challenge assumptions, compare alternatives,
            or adapt around travel and schedule constraints.
          </p>
        </details>

        <form onSubmit={handleSubmit} className="border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-4">
          <label htmlFor="coach-input" className="sr-only">
            Ask your triathlon coach
          </label>
          <div className="mb-3 flex flex-wrap gap-2">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setInput(prompt)}
                className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-3 py-1 text-xs font-medium text-[hsl(var(--text-secondary))] transition hover:border-[hsl(var(--ai-accent-core)/0.3)] hover:text-[hsl(var(--text-primary))]"
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
              placeholder="Ask what to adjust, why, and what to do next..."
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
