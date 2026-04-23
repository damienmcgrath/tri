"use client";

import { useState } from "react";
import Link from "next/link";
import type { WeekTransitionBriefing } from "@/lib/training/week-transition";

type Props = {
  briefing: WeekTransitionBriefing;
};

export function TransitionBriefingCard({ briefing }: Props) {
  const [dismissed, setDismissed] = useState(Boolean(briefing.dismissedAt));
  const [expanded, setExpanded] = useState(false);

  if (dismissed) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    try {
      await fetch("/api/week-transition", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefingId: briefing.id, action: "dismiss" })
      });
    } catch {
      // Silently fail — the card is already hidden client-side
    }
  };

  // Build a one-line summary from the briefing fields
  const summary = briefing.thisWeekFocus
    ? briefing.thisWeekFocus.split(/[.!]\s/)[0] + "."
    : "Tap to expand this week\u2019s briefing.";

  return (
    <article className="surface relative overflow-hidden rounded-2xl border border-[rgba(190,255,0,0.12)] p-4">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <p className="shrink-0 text-kicker font-medium text-[rgba(190,255,0,0.7)]">
            Monday brief
          </p>
          {!expanded ? (
            <p className="min-w-0 truncate text-body text-[rgba(255,255,255,0.6)]">
              {summary}
            </p>
          ) : null}
          <svg
            className={`ml-auto h-4 w-4 shrink-0 text-tertiary transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        <button
          onClick={handleDismiss}
          className="shrink-0 rounded-md px-2 py-1 text-ui-label text-tertiary transition hover:bg-[rgba(255,255,255,0.06)]"
          aria-label="Dismiss briefing"
        >
          Dismiss
        </button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3">
          {/* Last week takeaway */}
          <div>
            <p className="text-kicker text-tertiary">Last week</p>
            <p className="mt-1 text-body text-white">{briefing.lastWeekTakeaway}</p>
          </div>

          {/* This week focus */}
          <div>
            <p className="text-kicker text-tertiary">This week</p>
            <p className="mt-1 text-body text-white">{briefing.thisWeekFocus}</p>
          </div>

          {/* Adaptation context */}
          {briefing.adaptationContext ? (
            <div className="rounded-lg border border-[rgba(255,180,60,0.2)] bg-[rgba(255,180,60,0.06)] px-3 py-2">
              <p className="text-kicker text-[hsl(var(--warning))]">Adaptations</p>
              <p className="mt-1 text-ui-label text-muted">{briefing.adaptationContext}</p>
              {briefing.pendingRationaleIds.length > 0 ? (
                <Link
                  href="/calendar"
                  className="mt-1.5 inline-block text-ui-label font-medium text-[hsl(var(--warning))] hover:underline"
                >
                  Review {briefing.pendingRationaleIds.length} adaptation{briefing.pendingRationaleIds.length > 1 ? "s" : ""}
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* Coaching prompt */}
          {briefing.coachingPrompt ? (
            <div className="border-t border-[rgba(255,255,255,0.07)] pt-3">
              <p className="text-body text-[rgba(255,255,255,0.8)]">{briefing.coachingPrompt}</p>
              <Link
                href={`/coach?prompt=${encodeURIComponent(briefing.coachingPrompt)}`}
                className="mt-2 inline-flex btn-secondary px-3 text-ui-label"
              >
                Reply to coach
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
