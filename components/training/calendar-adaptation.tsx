import type { ReactNode } from "react";
import { StatusPill } from "@/components/training/status-pill";
import { ADAPTATION_META, type AdaptationState } from "@/lib/training/semantics";

export function AdaptationStrip({
  state,
  whatChanged,
  whyItMatters,
  recommendation,
  onReview,
  secondaryAction
}: {
  state: AdaptationState;
  whatChanged: string;
  whyItMatters: string;
  recommendation: string;
  onReview: () => void;
  secondaryAction?: ReactNode;
}) {
  const meta = ADAPTATION_META[state];

  return (
    <section className="rounded-xl border border-[hsl(var(--border)/0.62)] bg-[linear-gradient(180deg,hsl(var(--bg-elevated)/0.78),hsl(var(--bg-elevated)/0.58))] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-accent">Week adaptation</p>
          <div className="mt-2">
            <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} compact />
          </div>
        </div>
        <button type="button" onClick={onReview} className="btn-secondary px-3 py-1.5 text-xs">
          Review options
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">What changed</p>
          <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{whatChanged}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Why it matters</p>
          <p className="mt-2 text-sm text-muted">{whyItMatters}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Recommended adjustment</p>
          <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{recommendation}</p>
        </div>
      </div>

      {secondaryAction ? <div className="mt-3">{secondaryAction}</div> : null}
    </section>
  );
}

export function AdaptationDecisionPanel({
  title,
  summary,
  rationale,
  onApply,
  onKeep,
  onLater,
  applyLabel = "Apply"
}: {
  title: string;
  summary: string;
  rationale: string;
  onApply: () => void;
  onKeep: () => void;
  onLater: () => void;
  applyLabel?: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Repair the week</p>
        <h3 className="mt-1 text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted">{summary}</p>
      </div>
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Rationale</p>
        <p className="mt-2 text-sm text-muted">{rationale}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onApply} className="btn-primary px-3 py-1.5 text-xs">
          {applyLabel}
        </button>
        <button type="button" onClick={onKeep} className="btn-secondary px-3 py-1.5 text-xs">
          Keep as planned
        </button>
        <button type="button" onClick={onLater} className="btn-secondary px-3 py-1.5 text-xs">
          Decide later
        </button>
      </div>
    </div>
  );
}
