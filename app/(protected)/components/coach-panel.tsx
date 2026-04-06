"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCoachPanel } from "./coach-panel-context";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function CoachPanel() {
  const { isOpen, initialPrompt, close } = useCoachPanel();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Set initial prompt when panel opens
  useEffect(() => {
    if (isOpen && initialPrompt) {
      setInput(initialPrompt);
      setTimeout(() => inputRef.current?.focus(), 100);
    } else if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, initialPrompt]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Prevent background scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) close();
    },
    [close]
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed.length < 3 || isLoading) return;

    const userMessage: Message = { id: `user-${Date.now()}`, role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          conversationId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error ?? "Failed to send message");
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantContent = "";
      let buffer = "";
      const assistantId = `assistant-${Date.now()}`;

      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const eventLine = frame.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.slice(6).trim();
          try {
            const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;

            if (eventName === "message_start" && typeof data.conversationId === "string") {
              setConversationId(data.conversationId);
            }

            if (eventName === "message_delta" && typeof data.chunk === "string") {
              assistantContent += data.chunk;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: assistantContent } : m))
              );
            }

            if (eventName === "message_complete") {
              const structured = data.structured as { answer?: string } | undefined;
              if (structured?.answer) {
                assistantContent = structured.answer;
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: assistantContent } : m))
                );
              }
              if (typeof data.conversationId === "string") {
                setConversationId(data.conversationId);
              }
            }

            if (eventName === "error") {
              throw new Error(typeof data.error === "string" ? data.error : "Something went wrong");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue; // skip malformed JSON
            throw parseErr;
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Something went wrong";
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "assistant", content: `Error: ${errorMessage}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
    >
      {/* Panel */}
      <div className="absolute bottom-0 left-0 right-0 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-[rgba(255,255,255,0.1)] bg-[hsl(var(--bg-base))] shadow-2xl lg:bottom-auto lg:left-auto lg:right-0 lg:top-0 lg:max-h-full lg:w-[420px] lg:rounded-none lg:rounded-l-2xl lg:border-l lg:border-t-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Coach</span>
            <Link href="/coach" className="text-[11px] text-cyan-400 hover:text-cyan-300" onClick={close}>
              Open full →
            </Link>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-tertiary hover:bg-[rgba(255,255,255,0.08)] hover:text-white"
            aria-label="Close coach panel"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-tertiary">Ask your coach anything about your training.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-xl px-3 py-2.5 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "ml-8 bg-[hsl(var(--accent)/0.12)] text-white"
                      : "mr-4 bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.85)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              ))}
              {isLoading && messages[messages.length - 1]?.role === "user" ? (
                <div className="mr-4 rounded-xl bg-[rgba(255,255,255,0.04)] px-3 py-2.5">
                  <span className="inline-flex gap-1 text-sm text-tertiary">
                    <span className="animate-pulse">Thinking</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>.</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>.</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.6s" }}>.</span>
                  </span>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-[rgba(255,255,255,0.08)] px-3 py-2.5">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as unknown as FormEvent);
                }
              }}
              placeholder="Ask your coach..."
              rows={1}
              className="flex-1 resize-none rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-white placeholder:text-tertiary focus:border-[rgba(255,255,255,0.2)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={isLoading || input.trim().length < 3}
              className="rounded-lg bg-[hsl(var(--accent))] px-3 py-2 text-sm font-medium text-black transition hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Floating Action Button to open the coach panel
export function CoachFAB() {
  const { open, isOpen } = useCoachPanel();

  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={() => open()}
      className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-black shadow-lg transition hover:scale-105 hover:shadow-xl lg:bottom-6 lg:right-6"
      aria-label="Open coach"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
