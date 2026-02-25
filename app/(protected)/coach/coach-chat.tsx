"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type DecisionCard = {
  id: string;
  title: string;
  recommendation: string;
  detail: string;
  tone: "signal-ready" | "signal-recovery" | "signal-load" | "signal-risk";
  actionLabel: string;
  actionHref: string;
};

type StructuredCoachResponse = {
  summaryBlock: string;
  reasoning: string;
  actionOptions: string[];
  cautionNote: string | null;
  confidence: string;
  actionLabel: string;
  actionHref: string;
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
    "Performance briefing ready. Ask for load adjustments, session prioritization, or schedule changes based on your latest training data."
};

function parseStructuredResponse(content: string, summary: CoachSummary | null): StructuredCoachResponse {
  const lines = content.split("\n").map((line) => line.trim());
  const summaryLine = lines.find((line) => line.toLowerCase().startsWith("summary:"));
  const reasoningLine = lines.find((line) => line.toLowerCase().startsWith("reasoning:"));
  const recommendationLine = lines.find((line) => line.toLowerCase().startsWith("recommendation:"));
  const whyLine = lines.find((line) => line.toLowerCase().startsWith("why:"));
  const confidenceLine = lines.find((line) => line.toLowerCase().startsWith("confidence:"));
  const actionLine = lines.find((line) => line.toLowerCase().startsWith("action:"));
  const actionOptionsLine = lines.find(
    (line) => line.toLowerCase().startsWith("action options:") || line.toLowerCase().startsWith("options:") || line.toLowerCase().startsWith("actions:")
  );
  const cautionLine = lines.find((line) => line.toLowerCase().startsWith("caution:") || line.toLowerCase().startsWith("note:"));

  const summaryBlock =
    summaryLine?.split(":").slice(1).join(":").trim() ||
    recommendationLine?.split(":").slice(1).join(":").trim() ||
    "Keep your plan adaptive this week.";
  const reasoning =
    reasoningLine?.split(":").slice(1).join(":").trim() ||
    whyLine?.split(":").slice(1).join(":").trim() ||
    (summary
      ? `${summary.completedMinutes} of ${summary.plannedMinutes} planned minutes are complete.`
      : "Your latest summary will sharpen this recommendation.");
  const confidence =
    confidenceLine?.split(":").slice(1).join(":").trim() ||
    (summary?.completionPct ? `${summary.completionPct >= 80 ? "High" : "Moderate"} confidence` : "Low confidence");

  const actionText = actionLine?.split(":").slice(1).join(":").trim().toLowerCase();

  const actionOptions = actionOptionsLine
    ?.split(":")
    .slice(1)
    .join(":")
    .split(/[|;,]/)
    .map((option) => option.trim())
    .filter(Boolean);

  const defaultActionOptions = summary
    ? ["Adjust remaining weekly minutes", "Protect key intensity days", "Shift optional recovery if needed"]
    : ["Ask for this week adjustment", "Get recovery-first recommendation", "Review taper options for events"];

  const cautionNote = cautionLine?.split(":").slice(1).join(":").trim() || null;

  if (actionText?.includes("calendar")) {
    return {
      summaryBlock,
      reasoning,
      actionOptions: actionOptions?.length ? actionOptions : defaultActionOptions,
      cautionNote,
      confidence,
      actionLabel: "Open calendar actions",
      actionHref: "/calendar"
    };
  }

  return {
    summaryBlock,
    reasoning,
    actionOptions: actionOptions?.length ? actionOptions : defaultActionOptions,
    cautionNote,
    confidence,
    actionLabel: "Apply in weekly plan",
    actionHref: "/plan"
  };
}

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

  const decisionCards = useMemo<DecisionCard[]>(() => {
    const completionPct = summary?.completionPct ?? 0;
    const remainingMinutes = Math.max((summary?.plannedMinutes ?? 0) - (summary?.completedMinutes ?? 0), 0);

    return [
      {
        id: "adjust-load",
        title: "Adjust load",
        recommendation:
          completionPct >= 90
            ? "Maintain load with a slight intensity bump"
            : completionPct >= 70
              ? "Hold current load and reassess after next key session"
              : "Reduce load 10–20% and prioritize completion",
        detail:
          summary && remainingMinutes > 0
            ? `${remainingMinutes} minutes remain this week based on your current completion.`
            : "Log one completed session to unlock tighter load guidance.",
        tone: completionPct >= 85 ? "signal-ready" : completionPct >= 65 ? "signal-load" : "signal-risk",
        actionLabel: "Adjust weekly plan",
        actionHref: "/plan"
      },
      {
        id: "move-skip",
        title: "Move / skip recommendation",
        recommendation:
          completionPct >= 80
            ? "Move one optional recovery session if schedule is tight"
            : "Skip low-priority volume and protect quality workouts",
        detail:
          summary
            ? `Bias toward ${summary.dominantSport} consistency while preserving key intensity days.`
            : "Use this card to quickly move or skip sessions when your calendar changes.",
        tone: completionPct >= 80 ? "signal-recovery" : "signal-load",
        actionLabel: "Open calendar actions",
        actionHref: "/calendar"
      },
      {
        id: "recovery-alert",
        title: "Recovery alert",
        recommendation:
          completionPct >= 85
            ? "Recovery trending positive"
            : completionPct >= 65
              ? "Watch fatigue markers over next 48h"
              : "Elevated risk — add recovery day",
        detail:
          summary?.insights?.[0] ??
          "Start a chat to generate specific recovery insights from your latest workouts.",
        tone: completionPct >= 85 ? "signal-ready" : completionPct >= 65 ? "signal-load" : "signal-risk",
        actionLabel: "Review recovery plan",
        actionHref: "/plan"
      }
    ];
  }, [summary]);

  const contextStrip = useMemo(() => {
    const planned = summary?.plannedMinutes ?? 0;
    const completed = summary?.completedMinutes ?? 0;
    const remaining = Math.max(planned - completed, 0);
    const completionPct = summary?.completionPct ?? 0;

    return {
      weekGoal: planned > 0 ? `Close ${remaining} remaining minutes without sacrificing quality sessions.` : "Log your first completed session to establish this week goal.",
      fatigueState: completionPct >= 85 ? "Controlled" : completionPct >= 65 ? "Balanced" : "Accumulating",
      confidence: confidenceSignal.label
    };
  }, [summary, confidenceSignal.label]);

  const dataRecency = useMemo(() => {
    const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
    return formatRecencyLabel(activeConversation?.updated_at ?? conversations[0]?.updated_at);
  }, [conversationId, conversations]);

  const quickPrompts = ["Adjust this week", "Missed workout recovery", "Race taper advice"];

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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section className="space-y-4">
        <div className="surface-subtle flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
          <span className="font-semibold uppercase tracking-[0.14em] text-muted">Live context</span>
          <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">Week goal: {contextStrip.weekGoal}</span>
          <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">Fatigue: {contextStrip.fatigueState}</span>
          <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">Confidence: {contextStrip.confidence}</span>
        </div>
        <div className="surface p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--ai-accent-core))]">Weekly coaching takeaway</p>
              <h3 className="mt-1 text-lg font-semibold">{decisionCards[0]?.recommendation}</h3>
              <p className="mt-2 text-sm text-muted">{decisionCards[0]?.detail}</p>
            </div>
            <span className={`signal-chip ${urgencySignal.tone}`}>Urgency: {urgencySignal.label}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {decisionCards.slice(1).map((card) => (
              <article key={card.id} className="surface-subtle p-4">
                <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{card.title}</p>
                <p className="mt-2 text-sm font-semibold text-[hsl(var(--text-primary))]">{card.recommendation}</p>
                <p className="mt-2 text-sm text-muted">{card.detail}</p>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className={`signal-chip ${card.tone}`}>{card.tone.replace("signal-", "")}</span>
                  <a href={card.actionHref} className="text-xs font-medium text-[hsl(var(--ai-accent-core))] underline-offset-2 hover:underline">
                    {card.actionLabel}
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="surface overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] bg-gradient-to-r from-[hsl(var(--surface-1))] to-[hsl(var(--surface-2))] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-[hsl(var(--ai-accent-core))]">Coach Console</p>
              <h2 className="text-lg font-semibold">Operational coaching console</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-2 py-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `hsl(var(--${confidenceSignal.tone}))` }} />
                {confidenceSignal.label}
              </span>
              <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] px-2 py-1">{dataRecency}</span>
            </div>
          </div>
        </div>

        <div className="max-h-[460px] space-y-3 overflow-y-auto p-5">
          {messages.map((message, index) => {
            const shouldAnimateAssistantInsert =
              message.role === "assistant" && index === messages.length - 1 && !isLoading;

            return (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm transition ${
                  message.role === "user"
                    ? "bg-[hsl(var(--ai-accent-core))] text-white"
                    : `space-y-3 border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] ${shouldAnimateAssistantInsert ? "coach-response-insert" : ""}`
                }`}
              >
                <p>{message.content}</p>
                {message.role === "assistant" ? (
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
                    {(() => {
                      const structured = parseStructuredResponse(message.content, summary);

                      return (
                        <div className="space-y-2 text-xs">
                          <div>
                            <p className="font-semibold uppercase tracking-[0.14em] text-tertiary">Summary</p>
                            <p className="mt-1 text-sm text-[hsl(var(--text-primary))]">{structured.summaryBlock}</p>
                          </div>
                          <div>
                            <p className="font-semibold uppercase tracking-[0.14em] text-tertiary">Reasoning</p>
                            <p className="mt-1 text-sm text-muted">{structured.reasoning}</p>
                          </div>
                          <div>
                            <p className="font-semibold uppercase tracking-[0.14em] text-tertiary">Action options</p>
                            <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-muted">
                              {structured.actionOptions.map((option) => (
                                <li key={option}>{option}</li>
                              ))}
                            </ul>
                          </div>
                          {structured.cautionNote ? (
                            <div className="rounded-lg border border-[hsl(var(--signal-load)/0.35)] bg-[hsl(var(--signal-load)/0.12)] px-2 py-1 text-[11px] text-[hsl(var(--text-primary))]">
                              <span className="font-semibold uppercase tracking-[0.14em]">Caution:</span> {structured.cautionNote}
                            </div>
                          ) : null}
                          <p>
                            <span className="font-semibold text-[hsl(var(--text-primary))]">Confidence:</span> {structured.confidence}
                          </p>
                          <a
                            href={structured.actionHref}
                            className="inline-flex rounded-full bg-[hsl(var(--ai-accent-core)/0.12)] px-3 py-1 font-medium text-[hsl(var(--ai-accent-core))] hover:bg-[hsl(var(--ai-accent-core)/0.18)]"
                          >
                            {structured.actionLabel}
                          </a>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            </div>
            );
          })}
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
              placeholder="Ask for load analysis, risk checks, or session-level changes..."
              className="input-base"
            />
            <button type="submit" disabled={isLoading} className="btn-primary disabled:opacity-70">
              Send
            </button>
          </div>
          {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
        </form>
        </div>
      </section>

      <aside className="space-y-3 opacity-80">
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
          <h3 className="text-sm font-semibold">Performance snapshot</h3>
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
          <h3 className="text-sm font-semibold text-[hsl(var(--text-primary))]">Recent conversations</h3>
          <p className="mt-1 text-xs text-tertiary">Jump back into saved coaching threads.</p>
          <ul className="mt-4 space-y-2.5">
            {conversations.length === 0 ? (
              <li className="text-sm text-muted">No saved chats yet.</li>
            ) : (
              conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => void handleConversationClick(conversation.id)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      conversationId === conversation.id
                        ? "border-[hsl(var(--ai-accent-core)/0.35)] bg-[hsl(var(--ai-accent-core)/0.1)] text-[hsl(var(--text-primary))]"
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
