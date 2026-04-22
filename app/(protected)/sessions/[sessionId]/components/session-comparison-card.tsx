"use client";

import { useState } from "react";
import type { SessionComparison } from "@/lib/training/session-comparison";
import type { WeeklyTrend } from "@/lib/training/trends";
import type { StoredComparison } from "@/lib/training/session-comparison-engine";

const comparisonDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

type Props = {
  comparison: SessionComparison;
  trends?: WeeklyTrend[];
  aiComparisons?: StoredComparison[];
  sport?: string;
};

function normalizeSport(s: string): string {
  const lower = s.toLowerCase();
  return lower === "cycling" ? "bike" : lower;
}

function trendBadge(direction: string, confidence?: string) {
  const isLowConfidence = confidence === "low";
  if (direction === "improving") return {
    label: isLowConfidence ? "Possibly improving" : "Improving",
    className: isLowConfidence
      ? "border-[rgba(52,211,153,0.2)] bg-[rgba(52,211,153,0.06)] text-tertiary"
      : "border-[rgba(52,211,153,0.3)] bg-[rgba(52,211,153,0.1)] text-success"
  };
  if (direction === "declining") return {
    label: isLowConfidence ? "Possible decline" : "Declining",
    className: isLowConfidence
      ? "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] text-tertiary"
      : "border-[rgba(255,90,40,0.3)] bg-[rgba(255,90,40,0.1)] text-danger"
  };
  return { label: "Stable", className: "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.06)] text-tertiary" };
}

// Refinement: split an AI narrative into a 2-line lead + the remainder so
// the "Compared to previous" block stops reading like a wall of prose.
// First sentence is the lead; anything after it lives behind "More detail".
function splitNarrative(text: string): { lead: string; rest: string | null } {
  const trimmed = text.trim();
  // Match the first sentence ending with . ! or ? followed by whitespace.
  // Falls back to the whole thing if no terminator is found.
  const match = trimmed.match(/^([^.!?]+[.!?])\s+(.+)$/s);
  if (!match) return { lead: trimmed, rest: null };
  const lead = match[1].trim();
  const rest = match[2].trim();
  return { lead, rest: rest.length > 0 ? rest : null };
}

// Refinement: draw an actual sparkline instead of a row of number cells.
// ~84×20px, points normalised to the trend's value range, flat fallback
// when all points are identical so we don't render a zero-height line.
function TrendSparkline({
  points,
  direction
}: {
  points: Array<{ weekStart: string; value: number; label: string }>;
  direction: WeeklyTrend["direction"];
}) {
  const width = 84;
  const height = 20;
  const pad = 2;
  const validPoints = points.filter((p) => Number.isFinite(p.value));
  if (validPoints.length < 2) return null;
  const values = validPoints.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / (validPoints.length - 1);
  const coords = validPoints.map((p, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (p.value - min) / range);
    return { x, y };
  });
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const strokeColor = direction === "improving" ? "var(--color-success)" : direction === "declining" ? "var(--color-danger)" : "rgba(255,255,255,0.45)";
  const last = coords[coords.length - 1];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      aria-hidden="true"
    >
      <path d={path} stroke={strokeColor} strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="1.75" fill={strokeColor} />
    </svg>
  );
}

function ComparisonNarrative({ text }: { text: string }) {
  const { lead, rest } = splitNarrative(text);
  const [expanded, setExpanded] = useState(false);
  if (!rest) {
    return <p className="mt-3 text-sm text-white">{lead}</p>;
  }
  return (
    <div className="mt-3">
      <p className="text-sm text-white">{lead}</p>
      {expanded ? (
        <p className="mt-2 text-sm text-muted">{rest}</p>
      ) : null}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="mt-2 text-xs text-tertiary hover:text-white"
      >
        {expanded ? "Less detail ↑" : "More detail ↓"}
      </button>
    </div>
  );
}

export function SessionComparisonCard({ comparison, trends = [], aiComparisons = [], sport }: Props) {
  const previousDateLabel = comparisonDateFormatter.format(new Date(`${comparison.previousDate}T00:00:00.000Z`));

  // Filter trends to only show metrics for the current sport
  const matchedTrends = sport
    ? trends.filter((trend) => normalizeSport(trend.sport) === normalizeSport(sport))
    : trends;

  // Get best AI narrative (prefer recent range)
  const bestAiComparison = aiComparisons.find((c) => c.comparisonRange === "recent") ?? aiComparisons[0];

  return (
    <article className="surface p-5">
      <div>
        <div className="flex items-center gap-2.5">
          <p className="label">Compared to previous</p>
          {bestAiComparison ? (
            <span className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em] leading-none ${trendBadge(bestAiComparison.trendDirection, bestAiComparison.trendConfidence).className}`}>
              {trendBadge(bestAiComparison.trendDirection, bestAiComparison.trendConfidence).label}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-tertiary">{previousDateLabel}</p>
      </div>

      {/* AI narrative — 2-line lead + More detail disclosure so the block
          doesn't read as a wall of prose. */}
      {bestAiComparison ? (
        <ComparisonNarrative text={bestAiComparison.comparisonSummary} />
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {comparison.metrics.map((m) => (
          <div key={m.metric} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
            <p className="text-xs text-muted">{m.metric}</p>
            <p className="mt-1 text-base font-semibold text-white">{m.current}</p>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`text-sm font-medium ${
                  m.direction === "better"
                    ? "text-success"
                    : m.direction === "worse"
                    ? "text-danger"
                    : "text-tertiary"
                }`}
              >
                {m.direction === "better" ? "▲ " : m.direction === "worse" ? "▼ " : ""}
                {m.delta}
              </span>
              <span className="text-xs text-tertiary">vs {m.previous}</span>
            </div>
          </div>
        ))}
      </div>

      {matchedTrends.length > 0 ? (
        <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
          <p className="mb-3 text-[10px] uppercase tracking-[0.08em] text-tertiary">Multi-week trend</p>
          <div className="space-y-2.5">
            {matchedTrends.map((trend) => {
              const recent = trend.dataPoints.slice(-5);
              const latest = recent[recent.length - 1];
              const directionGlyph = trend.direction === "improving" ? "▲" : trend.direction === "declining" ? "▼" : "—";
              const directionClass = trend.direction === "improving" ? "text-success" : trend.direction === "declining" ? "text-danger" : "text-tertiary";
              return (
                <div key={trend.metric} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted whitespace-nowrap">{trend.metric}</span>
                  <div className="flex items-center gap-2">
                    <TrendSparkline points={recent} direction={trend.direction} />
                    {latest ? (
                      <span className="rounded border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.06)] px-2 py-1 text-xs font-medium tabular-nums text-white">
                        {latest.label}
                      </span>
                    ) : null}
                    <span className={`ml-0.5 text-sm font-medium ${directionClass}`}>{directionGlyph}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </article>
  );
}
