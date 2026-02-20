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
      return "from-slate-600 to-slate-700";
    }

    if (summary.completionPct >= 90) {
      return "from-emerald-500 to-teal-500";
    }

    if (summary.completionPct >= 70) {
      return "from-cyan-500 to-blue-500";
    }

    return "from-amber-500 to-orange-500";
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
      <section className="overflow-hidden rounded-2xl border border-white/20 bg-white/80 shadow-xl backdrop-blur">
        <div className="border-b border-slate-200/80 bg-gradient-to-r from-slate-900 via-cyan-900 to-slate-900 px-5 py-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-cyan-200">Coach Console</p>
              <h2 className="text-lg font-semibold">Adaptive triathlon guidance</h2>
            </div>
            <button
              type="button"
              onClick={handleNewChat}
              className="rounded-lg border border-cyan-300/50 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-700/40"
            >
              New chat
            </button>
          </div>
        </div>

        <div className="max-h-[440px] space-y-3 overflow-y-auto p-5">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm shadow-sm ${
                  message.role === "user"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
          {isLoading ? <p className="text-sm text-slate-500">Coach is analyzing your training...</p> : null}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-slate-200 bg-white p-4">
          <label htmlFor="coach-input" className="sr-only">
            Ask your AI coach
          </label>
          <div className="flex gap-2">
            <input
              id="coach-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask for workout analysis, weekly suggestions, or plan tweaks..."
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none ring-cyan-500 focus:ring"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-cyan-300"
            >
              Send
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
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

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Workout analysis snapshot</h3>
          <p className="mt-2 text-sm text-slate-600">
            Dominant sport: <span className="font-medium capitalize text-slate-800">{summary?.dominantSport ?? "n/a"}</span>
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {(summary?.insights ?? ["Ask a question to generate personalized workout insights."]).map((insight) => (
              <li key={insight}>{insight}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">Recent conversations</h3>
          <ul className="mt-3 space-y-2">
            {conversations.length === 0 ? (
              <li className="text-sm text-slate-500">No saved chats yet.</li>
            ) : (
              conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => void handleConversationClick(conversation.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      conversationId === conversation.id
                        ? "border-cyan-400 bg-cyan-50 text-cyan-900"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <p className="truncate font-medium">{conversation.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(conversation.updated_at).toLocaleString()}</p>
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
