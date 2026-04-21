"use client";

import { useState } from "react";
import Link from "next/link";
import type { MorningBrief } from "@/lib/training/morning-brief";

type Props = {
  brief: MorningBrief;
};

// F16: renders as a compact 2-line opener (coach kicker + first sentence)
// with an optional expansion for the full text. Designed to live at the
// top of the "What matters right now" column rather than as a detached
// card between hero rows.
export function MorningBriefCard({ brief }: Props) {
  const [expanded, setExpanded] = useState(false);

  const summary = brief.briefText
    ? brief.briefText.split(/[.!]\s/)[0].trim() + "."
    : "Today’s coaching brief.";

  const hasMore = Boolean(brief.briefText && brief.briefText.length > summary.length + 2);

  return (
    <section
      aria-label="Morning brief"
      className="rounded-xl border border-[rgba(190,255,0,0.14)] bg-[rgba(190,255,0,0.04)] px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-[10px] font-semibold text-[var(--color-accent)]"
        >
          ai
        </span>
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-accent)]">
          Coach brief
        </p>
      </div>
      <p className="mt-1.5 text-sm leading-snug text-white">
        {expanded ? brief.briefText : summary}
      </p>

      {expanded && brief.pendingActions.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {brief.pendingActions.map((action, i) => {
            const isAdaptation = /adaptation/i.test(action);
            const isDebrief = /debrief/i.test(action);
            const href = isAdaptation ? "/calendar" : isDebrief ? "/debrief" : "/dashboard";
            return (
              <Link
                key={i}
                href={href}
                className="rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-[11px] text-[rgba(255,255,255,0.7)] transition-ui hover:bg-[rgba(255,255,255,0.08)]"
              >
                {action}
              </Link>
            );
          })}
        </div>
      ) : null}

      {hasMore ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-[11px] text-tertiary transition hover:text-white"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </section>
  );
}
