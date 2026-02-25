"use client";

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

const defaultAssistantMessage = {
  role: "assistant" as const,
  content:
    "Hey! I’m your AI coach. Ask me to review your recent training, suggest a week plan, or adapt sessions around your schedule."
};

export function CoachChat() {
  const [messages, setMessages] = useState<Message[]>([defaultAssistantMessage]);
  const [summary, setSummary] = useState<CoachSummary | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const completionTone = useMemo(() => {
    if (!summary) {
      return "from-[hsl(var(--surface-2))] to-[hsl(var(--surface-1))]";
    }

    if (summary.completionPct >= 90) {
      return "from-[hsl(var(--signal-ready))] to-[hsl(var(--signal-recovery))]";
    }

    if (summary.completionPct >= 70) {
      return "from-[hsl(var(--signal-recovery))] to-[hsl(var(--ai-accent-core))]";
    }

    return "from-[hsl(var(--signal-load))] to-[hsl(var(--signal-risk))]";
  }, [summary]);

  const confidenceSignal = useMemo(() => {
    if (!summary) {
      return { label: "No data", tone: "signal-recovery" };
    }

    if (summary.completionPct >= 90) {
      return { label: "High confidence", tone: "signal-ready" };
    }

    if (summary.completionPct >= 70) {
      return { label: "Building confidence", tone: "signal-recovery" };
    }

    return { label: "Low confidence", tone: "signal-risk" };
  }, [summary]);

  const urgencySignal = useMemo(() => {
    if (!summary) {
      return { label: "Awaiting recommendation", tone: "signal-recovery" };
    }

    if (summary.completionPct >= 85) {
      return { label: "Low urgency", tone: "signal-ready" };
    }

    if (summary.completionPct >= 65) {
      return { label: "Moderate urgency", tone: "signal-load" };
    }

    return { label: "High urgency", tone: "signal-risk" };
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
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="surface overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] bg-gradient-to-r from-[hsl(var(--surface-1))] to-[hsl(var(--surface-2))] px-5 py-4">
          <p className="text-sm font-medium uppercase tracking-wide text-[hsl(var(--ai-accent-core))]">Coach Console</p>
          <h2 className="text-lg font-semibold">Adaptive triathlon guidance</h2>
        </div>

        <div className="max-h-[440px] space-y-3 overflow-y-auto p-5">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm transition ${
                  message.role === "user"
                    ? "bg-[hsl(var(--ai-accent-core))] text-white"
                    : "border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]"
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

        <form onSubmit={handleSubmit} className="border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-4">
          <label htmlFor="coach-input" className="sr-only">
            Ask your AI coach
          </label>
          <div className="flex gap-2">
            <input
              id="coach-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask for workout analysis, weekly suggestions, or plan tweaks..."
              className="input-base"
            />
            <button type="submit" disabled={isLoading} className="btn-primary disabled:opacity-70">
              Send
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
        </form>
      </section>

      <aside className="space-y-4">
        <div className={`rounded-2xl bg-gradient-to-r ${completionTone} p-5 text-white shadow-xl`}>
          <p className="text-xs uppercase tracking-wide text-white/90">Recent completion</p>
          <p className="mt-2 text-3xl font-bold">{summary?.completionPct ?? 0}%</p>
          <p className="mt-1 text-sm text-white/90">
            {summary?.completedMinutes ?? 0} min done / {summary?.plannedMinutes ?? 0} min planned
          </p>
        </div>



        <div className="surface p-5">
          <h3 className="text-sm font-semibold">Signal mapping</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`signal-chip ${confidenceSignal.tone}`}>Coach confidence: {confidenceSignal.label}</span>
            <span className={`signal-chip ${urgencySignal.tone}`}>Recommendation urgency: {urgencySignal.label}</span>
          </div>
        </div>

        <div className="surface p-5">
          <h3 className="text-sm font-semibold">Workout analysis snapshot</h3>
          <p className="mt-2 text-sm text-muted">
            Dominant sport: <span className="font-medium capitalize">{summary?.dominantSport ?? "n/a"}</span>
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
            {(summary?.insights ?? ["Ask a question to generate personalized workout insights."]).map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </div>

        <div className="surface p-5">
          <h3 className="text-sm font-semibold">Recent conversations</h3>
          <ul className="mt-3 space-y-2">
            {conversations.length === 0 ? (
              <li className="text-sm text-muted">No saved chats yet.</li>
            ) : (
              conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => void handleConversationClick(conversation.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      conversationId === conversation.id
                        ? "border-[hsl(var(--ai-accent-core)/0.5)] bg-[hsl(var(--ai-accent-core)/0.12)] text-[hsl(var(--text-primary))]"
                        : "border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--surface-1))]"
                    }`}
                  >
                    <p className="truncate font-medium">{conversation.title}</p>
                    <p className="mt-1 text-xs text-tertiary">{new Date(conversation.updated_at).toLocaleString()}</p>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </aside>
    </div>
  );
}
