"use client";

import { useState } from "react";

type ContextSummaryItem = {
  label: string;
  accent?: boolean;
};

export function CoachContextPanel({
  summaryItems,
  children
}: {
  summaryItems: ContextSummaryItem[];
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="surface overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[rgba(255,255,255,0.03)]"
      >
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {summaryItems.map((item) => (
            <span
              key={item.label}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                item.accent
                  ? "border border-[rgba(190,255,0,0.25)] bg-[rgba(190,255,0,0.08)] text-accent"
                  : "border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.6)]"
              }`}
            >
              {item.label}
            </span>
          ))}
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-[rgba(255,255,255,0.4)] transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-[rgba(255,255,255,0.06)] p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
