"use client";

import { useMemo, useState } from "react";
import { RegenerateRaceReviewButton } from "./regenerate-race-review-button";

export type RaceReviewCardProps = {
  bundleId: string;
  review: {
    headline: string;
    narrative: string;
    coachTake: string;
    transitionNotes: string | null;
    pacingNotes: Record<string, PacingLeg | null | undefined>;
    disciplineDistributionActual: Record<string, number>;
    disciplineDistributionDelta: Record<string, number> | null;
    modelUsed: string;
    isProvisional: boolean;
    generatedAt: string;
  };
};

type PacingLeg = {
  firstHalf?: number;
  lastHalf?: number;
  deltaPct?: number;
  unit?: "watts" | "sec_per_km" | "sec_per_100m";
  note: string;
};

const LEG_LABELS: Record<string, string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run"
};

const ROLE_LABELS: Record<string, string> = {
  swim: "Swim",
  t1: "T1",
  bike: "Bike",
  t2: "T2",
  run: "Run"
};

function formatRelativeTime(iso: string): string {
  const generated = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - generated) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatPercent(value: number, signed = false): string {
  const pct = (value * 100).toFixed(1);
  if (!signed) return `${pct}%`;
  return value >= 0 ? `+${pct}%` : `${pct}%`;
}

function formatUnit(value: number | undefined, unit: PacingLeg["unit"]): string {
  if (value === undefined) return "—";
  if (unit === "watts") return `${value}W`;
  if (unit === "sec_per_km") {
    const m = Math.floor(value / 60);
    const s = Math.round(value % 60);
    return `${m}:${String(s).padStart(2, "0")} /km`;
  }
  if (unit === "sec_per_100m") {
    const m = Math.floor(value / 60);
    const s = Math.round(value % 60);
    return `${m}:${String(s).padStart(2, "0")} /100m`;
  }
  return String(value);
}

export function RaceReviewCard({ bundleId, review }: RaceReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const generatedAtLabel = useMemo(() => formatRelativeTime(review.generatedAt), [review.generatedAt]);

  const distributionRows = useMemo(() => {
    const order: Array<keyof typeof ROLE_LABELS> = ["swim", "t1", "bike", "t2", "run"];
    return order
      .filter((role) => review.disciplineDistributionActual[role] !== undefined)
      .map((role) => {
        const actual = review.disciplineDistributionActual[role] ?? 0;
        // Delta only carries swim/bike/run (T1/T2 folded in upstream).
        const deltaKey = role === "t1" ? "bike" : role === "t2" ? "run" : role;
        const delta = review.disciplineDistributionDelta?.[deltaKey] ?? null;
        return { role, actual, delta };
      });
  }, [review.disciplineDistributionActual, review.disciplineDistributionDelta]);

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race review</p>
            {review.isProvisional ? (
              <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-tertiary">
                Provisional
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-base font-medium text-white">{review.headline}</h2>
        </div>
      </header>

      <div className="mt-4 rounded-xl border-y border-r border-[hsl(var(--border))] border-l-[3px] border-l-[var(--color-accent)] bg-[rgba(190,255,0,0.04)] p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">Coach take</p>
        <p className="mt-2 text-sm text-white">{review.coachTake}</p>
      </div>

      <details
        className="mt-4 group"
        open={expanded}
        onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none text-xs text-tertiary underline-offset-2 transition-ui hover:text-white hover:underline">
          {expanded ? "Hide details" : "Show race details"}
        </summary>

        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race summary</p>
            <p className="mt-2 text-sm text-[rgba(255,255,255,0.78)] leading-relaxed">{review.narrative}</p>
          </div>

          {distributionRows.length > 0 ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Time per discipline</p>
              <ul className="mt-2 space-y-1.5">
                {distributionRows.map((row) => (
                  <li key={row.role} className="flex items-baseline gap-3 text-sm">
                    <span className="w-12 text-muted">{ROLE_LABELS[row.role]}</span>
                    <span className="font-mono tabular-nums text-white">{formatPercent(row.actual)}</span>
                    {row.delta !== null && (row.role === "swim" || row.role === "bike" || row.role === "run") ? (
                      <span
                        className={`text-xs ${
                          Math.abs(row.delta) < 0.02
                            ? "text-tertiary"
                            : row.delta > 0
                              ? "text-warning"
                              : "text-success"
                        }`}
                      >
                        {formatPercent(row.delta, true)} vs ideal
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {hasAnyPacingNotes(review.pacingNotes) ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Per-leg pacing</p>
              <ul className="mt-2 space-y-2">
                {(["swim", "bike", "run"] as const).map((leg) => {
                  const data = review.pacingNotes[leg];
                  if (!data) return null;
                  const hasHalves = typeof data.firstHalf === "number" && typeof data.lastHalf === "number" && data.unit;
                  return (
                    <li key={leg} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-medium text-white">{LEG_LABELS[leg]}</span>
                        {hasHalves ? (
                          <span className="font-mono text-xs tabular-nums text-tertiary">
                            {formatUnit(data.firstHalf, data.unit)} → {formatUnit(data.lastHalf, data.unit)}
                            {typeof data.deltaPct === "number" ? (
                              <span className={`ml-2 ${Math.abs(data.deltaPct) <= 2 ? "text-success" : "text-warning"}`}>
                                ({data.deltaPct >= 0 ? "+" : ""}
                                {data.deltaPct.toFixed(1)}%)
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-[rgba(255,255,255,0.78)]">{data.note}</p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {review.transitionNotes ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Transitions</p>
              <p className="mt-2 text-sm text-[rgba(255,255,255,0.78)]">{review.transitionNotes}</p>
            </div>
          ) : null}
        </div>
      </details>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--border))] pt-3">
        <p className="text-[10px] text-tertiary">
          Generated {generatedAtLabel} via {review.modelUsed}
        </p>
        <RegenerateRaceReviewButton bundleId={bundleId} />
      </footer>
    </article>
  );
}

export function RaceReviewPlaceholder({ bundleId }: { bundleId: string }) {
  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race review</p>
      <p className="mt-2 text-sm text-[rgba(255,255,255,0.78)]">
        Generating your race review… this usually takes about 20 seconds. Refresh the page or trigger a manual regenerate if it doesn&apos;t appear shortly.
      </p>
      <div className="mt-3">
        <RegenerateRaceReviewButton bundleId={bundleId} label="Generate race review" />
      </div>
    </article>
  );
}

function hasAnyPacingNotes(pacingNotes: RaceReviewCardProps["review"]["pacingNotes"]): boolean {
  return (["swim", "bike", "run"] as const).some((leg) => Boolean(pacingNotes[leg]));
}
