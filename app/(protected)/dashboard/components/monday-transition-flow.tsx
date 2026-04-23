"use client";

import { useState } from "react";
import Link from "next/link";
import type { WeekTransitionBriefing } from "@/lib/training/week-transition";
import type { MorningBrief } from "@/lib/training/morning-brief";

type Props = {
  briefing: WeekTransitionBriefing;
  morningBrief: MorningBrief | null;
  debriefSummary: string | null;
  pendingRationaleCount: number;
  weekStart: string;
};

export function MondayTransitionFlow({ briefing, morningBrief, debriefSummary, pendingRationaleCount, weekStart }: Props) {
  const [expanded, setExpanded] = useState(false);

  // One-line collapsed summary
  const summary = briefing.thisWeekFocus
    ? briefing.thisWeekFocus.split(/[.!]\s/)[0] + "."
    : "Monday transition briefing.";

  return (
    <article className="surface overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left md:p-5"
      >
        <div className="flex min-w-0 items-center gap-3">
          <p className="shrink-0 text-kicker font-medium text-[rgba(190,255,0,0.7)]">
            Monday brief
          </p>
          {!expanded ? (
            <p className="min-w-0 truncate text-body text-[rgba(255,255,255,0.6)]">
              {summary}
            </p>
          ) : null}
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-tertiary transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded ? (
        <div className="space-y-0">
          {/* Section 1: Last Week */}
          <div className="border-t border-b border-[rgba(255,255,255,0.06)] p-4 md:p-5">
            <p className="text-kicker font-medium text-tertiary">Last week</p>
            <p className="mt-2 text-body leading-relaxed text-white">{briefing.lastWeekTakeaway}</p>
            {debriefSummary ? (
              <p className="mt-1.5 text-body leading-relaxed text-[rgba(255,255,255,0.65)]">{debriefSummary}</p>
            ) : null}
            <Link href={`/debrief?weekStart=${weekStart}`} className="mt-2 inline-block text-ui-label text-cyan-400 hover:text-cyan-300">
              Open full debrief →
            </Link>
          </div>

          {/* Section 2: This Week */}
          <div className="border-b border-[rgba(255,255,255,0.06)] p-4 md:p-5">
            <p className="text-kicker font-medium text-tertiary">This week</p>
            <p className="mt-2 text-body leading-relaxed text-white">{briefing.thisWeekFocus}</p>
            {briefing.adaptationContext ? (
              <p className="mt-1.5 rounded-lg border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.06)] px-3 py-2 text-ui-label text-[hsl(var(--warning))]">
                {briefing.adaptationContext}
              </p>
            ) : null}
            <Link href="/calendar" className="mt-2 inline-block text-ui-label text-cyan-400 hover:text-cyan-300">
              View this week&apos;s calendar →
            </Link>
          </div>

          {/* Section 3: Today */}
          {morningBrief?.sessionPreview ? (
            <div className="border-b border-[rgba(255,255,255,0.06)] p-4 md:p-5">
              <p className="text-kicker font-medium text-tertiary">Today</p>
              <p className="mt-2 text-body leading-relaxed text-white">{morningBrief.sessionPreview}</p>
            </div>
          ) : null}

          {/* Section 4: Pending Actions */}
          {pendingRationaleCount > 0 || briefing.coachingPrompt ? (
            <div className="p-4 md:p-5">
              {pendingRationaleCount > 0 ? (
                <p className="text-body text-[rgba(255,255,255,0.7)]">
                  You have {pendingRationaleCount} adaptation{pendingRationaleCount === 1 ? "" : "s"} to review.{" "}
                  <Link href="/calendar" className="text-cyan-400 hover:text-cyan-300">View on Calendar →</Link>
                </p>
              ) : null}
              {briefing.coachingPrompt ? (
                <Link
                  href={`/coach?prompt=${encodeURIComponent(briefing.coachingPrompt)}`}
                  className="mt-2 inline-flex items-center gap-1.5 text-body text-cyan-400 hover:text-cyan-300"
                >
                  Reply to coach →
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
