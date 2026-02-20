"use client";

import { FormEvent, useMemo, useState } from "react";

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

export function CoachChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hey! I’m your AI coach. Ask me to review your recent training, suggest a week plan, or adapt sessions around your schedule."
    }
  ]);
  const [summary, setSummary] = useState<CoachSummary | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ message: trimmed })
      });

      const data = (await response.json()) as { answer?: string; error?: string; summary?: CoachSummary };

      if (!response.ok || !data.answer) {
        throw new Error(data.error ?? "Could not get a coaching response.");
      }

      setSummary(data.summary ?? null);
      setMessages((prev) => [...prev, { role: "assistant", content: data.answer! }]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section className="surface overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] bg-gradient-to-r from-slate-900 to-slate-800 px-5 py-4">
          <p className="text-sm font-medium uppercase tracking-wide text-cyan-300">Coach Console</p>
          <h2 className="text-lg font-semibold">Adaptive triathlon guidance</h2>
        </div>

        <div className="max-h-[440px] space-y-3 overflow-y-auto p-5">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm transition ${
                  message.role === "user"
                    ? "bg-cyan-600 text-white"
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
      </aside>
    </div>
  );
}
