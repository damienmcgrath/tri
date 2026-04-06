"use client";

import { useState } from "react";
import Link from "next/link";
import type { MorningBrief } from "@/lib/training/morning-brief";

type Props = {
  brief: MorningBrief;
};

export function MorningBriefCard({ brief }: Props) {
  const [expanded, setExpanded] = useState(false);

  // One-line summary: first sentence of the brief
  const summary = brief.briefText
    ? brief.briefText.split(/[.!]\s/)[0] + "."
    : "Today\u2019s coaching brief.";

  return (
    <article className="surface p-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          <p className="shrink-0 text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">
            Morning brief
          </p>
          {!expanded ? (
            <p className="min-w-0 truncate text-sm text-[rgba(255,255,255,0.6)]">
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
        <div className="mt-3">
          <p className="whitespace-pre-line text-sm leading-relaxed text-white">
            {brief.briefText}
          </p>

          {brief.pendingActions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {brief.pendingActions.map((action, i) => {
                const isAdaptation = /adaptation/i.test(action);
                const isDebrief = /debrief/i.test(action);
                const href = isAdaptation ? "/calendar" : isDebrief ? "/debrief" : "/dashboard";
                return (
                  <Link
                    key={i}
                    href={href}
                    className="rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] transition hover:bg-[rgba(255,255,255,0.08)]"
                  >
                    {action}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
