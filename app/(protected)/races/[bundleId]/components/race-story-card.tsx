/**
 * Layer 2 — Race Story.
 *
 * Overall narrative, per-leg accordions with key evidence, transitions row,
 * and the cross-discipline insight rendered as an emphasized block when
 * present. Insight is the moat — explicit connection across legs that the
 * deterministic gate detected upstream. AI can only narrate the hypothesis;
 * this card simply surfaces what the gate let through.
 */

"use client";

import { useState } from "react";

export type RaceStoryPayload = {
  overall: string;
  perLeg: {
    swim: { narrative: string; keyEvidence: string[] } | null;
    bike: { narrative: string; keyEvidence: string[] } | null;
    run: { narrative: string; keyEvidence: string[] } | null;
  };
  transitions: string | null;
  crossDisciplineInsight: string | null;
};

const LEG_LABEL: Record<"swim" | "bike" | "run", string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run"
};

export function RaceStoryCard({ story }: { story: RaceStoryPayload }) {
  const [openLeg, setOpenLeg] = useState<"swim" | "bike" | "run" | null>(null);

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race story</p>

      <p className="mt-3 text-sm leading-relaxed text-[rgba(255,255,255,0.86)] whitespace-pre-wrap">
        {story.overall}
      </p>

      {story.crossDisciplineInsight ? (
        <section
          className="mt-4 rounded-xl border-y border-r border-[hsl(var(--border))] border-l-[3px] p-4"
          style={{
            borderLeftColor: "var(--color-accent)",
            backgroundColor: "rgba(190,255,0,0.06)"
          }}
        >
          <p
            className="text-[11px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "var(--color-accent)" }}
          >
            Cross-discipline insight
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white">{story.crossDisciplineInsight}</p>
        </section>
      ) : null}

      <ul className="mt-4 space-y-2">
        {(["swim", "bike", "run"] as const).map((leg) => {
          const data = story.perLeg[leg];
          if (!data) return null;
          const isOpen = openLeg === leg;
          return (
            <li key={leg} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))]">
              <button
                type="button"
                onClick={() => setOpenLeg(isOpen ? null : leg)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-[hsl(var(--overlay))]"
                aria-expanded={isOpen}
              >
                <span className="text-sm font-medium text-white">{LEG_LABEL[leg]}</span>
                <span className="text-xs text-tertiary">{isOpen ? "Hide" : "Show"} details</span>
              </button>
              {isOpen ? (
                <div className="border-t border-[hsl(var(--border))] px-3 py-3">
                  <p className="text-sm leading-relaxed text-[rgba(255,255,255,0.78)]">{data.narrative}</p>
                  {data.keyEvidence.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {data.keyEvidence.map((point, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs text-tertiary">
                          <span aria-hidden="true" className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-[hsl(var(--border))]" />
                          <span className="text-[rgba(255,255,255,0.78)]">{point}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {story.transitions ? (
        <div className="mt-4 border-t border-[hsl(var(--border))] pt-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Transitions</p>
          <p className="mt-1 text-sm text-[rgba(255,255,255,0.78)]">{story.transitions}</p>
        </div>
      ) : null}
    </article>
  );
}
