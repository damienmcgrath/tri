"use client";

import { useState } from "react";
import Link from "next/link";

type Recommendation = {
  id: string;
  type: "add" | "swap" | "reduce" | "maintain";
  sport: string;
  summary: string;
  rationale: string;
  status: string;
};

type Props = {
  recommendations: Recommendation[];
};

const TYPE_ICON: Record<string, string> = {
  add: "+",
  swap: "\u21c4",
  reduce: "\u2212",
  maintain: "\u2713",
};

export function RebalancingCard({ recommendations }: Props) {
  const active = recommendations.filter((r) => r.status === "active");
  if (active.length === 0) return null;

  return (
    <div className="surface space-y-3 p-4">
      <p className="label">Rebalancing Recommendations</p>

      {active.map((rec) => (
        <RecommendationItem key={rec.id} rec={rec} />
      ))}
    </div>
  );
}

function RecommendationItem({ rec }: { rec: Recommendation }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="rounded-md border border-[var(--border-subtle)] p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded bg-[var(--color-surface-raised)] text-xs font-bold">
          {TYPE_ICON[rec.type] ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{rec.summary}</p>
          {expanded && (
            <p className="mt-1 text-xs text-muted leading-relaxed">{rec.rationale}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="text-xs text-[hsl(var(--fg-muted))] underline underline-offset-2"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Less" : "Why?"}
            </button>
            <Link
              href={`/coach?prompt=${encodeURIComponent(`I'd like to discuss the rebalancing recommendation for ${rec.sport}: ${rec.summary}`)}`}
              className="text-xs text-cyan-400 underline underline-offset-2"
            >
              Discuss with Coach
            </Link>
            <button
              className="text-xs text-[hsl(var(--fg-muted)/0.6)] underline underline-offset-2"
              onClick={() => setDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
