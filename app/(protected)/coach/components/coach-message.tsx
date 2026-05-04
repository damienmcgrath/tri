"use client";

import { memo } from "react";
import type { CoachCitation } from "@/lib/coach/types";
import { CitationChips } from "./citation-chip";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  failed?: boolean;
  retryText?: string;
  citations?: CoachCitation[];
};

type CoachMessageProps = {
  message: Message;
  onRetry: (message: Message) => void;
  raceBundleId?: string;
  onCitationClick?: (citation: CoachCitation) => boolean | void;
};

// Message bubbles rarely change once rendered; only the streaming tail updates.
// Memoising with a field-level comparator stops every bubble from re-rendering
// on every keystroke in the input below.
export const CoachMessage = memo(
  function CoachMessage({ message, onRetry, raceBundleId, onCitationClick }: CoachMessageProps) {
    return (
      <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
            message.role === "user"
              ? "bg-[hsl(var(--ai-accent-core))] text-[#0A0A0B]"
              : message.failed
                ? "border border-[hsl(var(--danger)/0.4)] bg-[hsl(var(--danger)/0.08)] text-[hsl(var(--text-secondary))]"
                : "border border-[rgba(255,255,255,0.06)] bg-[#1F1F25] px-4 py-3.5 text-[rgba(255,255,255,0.8)]"
          }`}
        >
          {message.pending && message.content.trim().length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-tertiary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--text-secondary)/0.55)]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--text-secondary)/0.55)] [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--text-secondary)/0.55)] [animation-delay:240ms]" />
              <span className="ml-1">Coach is thinking</span>
            </span>
          ) : (
            <>
              {message.content}
              {message.pending ? <span className="ml-1 animate-pulse text-tertiary">▍</span> : null}
            </>
          )}
          {message.role === "assistant" && message.citations && message.citations.length > 0 ? (
            <CitationChips citations={message.citations} onCitationClick={onCitationClick} raceBundleId={raceBundleId} />
          ) : null}
          {message.failed && message.role === "assistant" && message.retryText ? (
            <div className="mt-2">
              <button type="button" onClick={() => onRetry(message)} className="text-xs font-medium text-[hsl(var(--ai-accent-core))] hover:underline">
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
  (prev, next) => {
    const a = prev.message;
    const b = next.message;
    return (
      a.id === b.id &&
      a.role === b.role &&
      a.content === b.content &&
      a.pending === b.pending &&
      a.failed === b.failed &&
      a.retryText === b.retryText &&
      JSON.stringify(a.citations ?? []) === JSON.stringify(b.citations ?? []) &&
      prev.raceBundleId === next.raceBundleId &&
      prev.onCitationClick === next.onCitationClick
    );
  }
);
