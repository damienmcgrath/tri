"use client";

import { useState } from "react";
import Link from "next/link";
import type { WeekTransitionBriefing } from "@/lib/training/week-transition";

type Props = {
  briefing: WeekTransitionBriefing;
};

export function TransitionBriefingCard({ briefing }: Props) {
  const [dismissed, setDismissed] = useState(Boolean(briefing.dismissedAt));

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

  return (
    <article className="surface relative overflow-hidden rounded-2xl border border-[rgba(190,255,0,0.12)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[rgba(190,255,0,0.7)]">
            Monday brief
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] text-tertiary transition hover:bg-[rgba(255,255,255,0.06)]"
          aria-label="Dismiss briefing"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {/* Last week takeaway */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-tertiary">Last week</p>
          <p className="mt-1 text-sm text-white">{briefing.lastWeekTakeaway}</p>
        </div>

        {/* This week focus */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-tertiary">This week</p>
          <p className="mt-1 text-sm text-white">{briefing.thisWeekFocus}</p>
        </div>

        {/* Adaptation context */}
        {briefing.adaptationContext ? (
          <div className="rounded-lg border border-[rgba(255,180,60,0.2)] bg-[rgba(255,180,60,0.06)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--warning))]">Adaptations</p>
            <p className="mt-1 text-xs text-muted">{briefing.adaptationContext}</p>
            {briefing.pendingRationaleIds.length > 0 ? (
              <Link
                href="/calendar"
                className="mt-1.5 inline-block text-[11px] font-medium text-[hsl(var(--warning))] hover:underline"
              >
                Review {briefing.pendingRationaleIds.length} adaptation{briefing.pendingRationaleIds.length > 1 ? "s" : ""}
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Coaching prompt */}
        {briefing.coachingPrompt ? (
          <div className="border-t border-[rgba(255,255,255,0.07)] pt-3">
            <p className="text-sm text-[rgba(255,255,255,0.8)]">{briefing.coachingPrompt}</p>
            <Link
              href={`/coach?prompt=${encodeURIComponent(briefing.coachingPrompt)}`}
              className="mt-2 inline-flex btn-secondary px-3 text-[11px]"
            >
              Reply to coach
            </Link>
          </div>
        ) : null}
      </div>
    </article>
  );
}
