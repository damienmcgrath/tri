"use client";

import { useState } from "react";
import type { TrainingScore } from "@/lib/training/scoring";

type Props = {
  score: TrainingScore;
};

function getScoreColour(score: number): string {
  if (score >= 75) return "text-[hsl(170,60%,55%)]";  // teal
  if (score >= 50) return "text-white";                // neutral
  return "text-[hsl(35,90%,55%)]";                     // amber
}

function getScoreRingColour(score: number): string {
  if (score >= 75) return "hsl(170, 60%, 55%)";
  if (score >= 50) return "rgba(255,255,255,0.8)";
  return "hsl(35, 90%, 55%)";
}

function getDeltaLabel(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return "steady";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function getDeltaClass(delta: number | null): string {
  if (delta === null || delta === 0) return "text-tertiary";
  return delta > 0 ? "text-success" : "text-danger";
}

export function TrainingScoreCard({ score }: Props) {
  const [expanded, setExpanded] = useState(false);
  const ringPct = Math.max(0, Math.min(100, score.compositeScore));
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (ringPct / 100) * circumference;
  const delta7d = getDeltaLabel(score.scoreDelta7d);

  return (
    <article className="surface p-4 md:p-5">
      <div className="flex items-center gap-4">
        {/* Score ring */}
        <div className="relative h-20 w-20 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="6"
            />
            <circle
              cx="50" cy="50" r="40"
              fill="none"
              stroke={getScoreRingColour(score.compositeScore)}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-xl font-bold ${getScoreColour(score.compositeScore)}`}>
              {Math.round(score.compositeScore)}
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">Training score</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${getScoreColour(score.compositeScore)}`}>
              {Math.round(score.compositeScore)}
            </span>
            {delta7d ? (
              <span className={`text-sm font-medium ${getDeltaClass(score.scoreDelta7d)}`}>
                {score.scoreDelta7d! > 0 ? "↑" : score.scoreDelta7d! < 0 ? "↓" : ""}{delta7d} this week
              </span>
            ) : null}
          </div>
          {!score.progressionActive ? (
            <p className="mt-0.5 text-[11px] text-tertiary">Progression tracking builds with 2+ weeks of data</p>
          ) : null}
        </div>
      </div>

      {/* Dimension breakdown */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 w-full text-left text-[11px] font-medium text-tertiary transition hover:text-white"
      >
        {expanded ? "Hide details" : "What affects this?"}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-2 border-t border-[rgba(255,255,255,0.08)] pt-3">
          {/* Execution Quality */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">✓</span>
              <span className="text-xs text-muted">Execution</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                <div
                  className="h-full rounded-full bg-white/60"
                  style={{ width: `${score.executionQuality ?? 0}%` }}
                />
              </div>
              <span className="w-8 text-right text-xs font-medium text-white">
                {score.executionQuality !== null ? Math.round(score.executionQuality) : "—"}
              </span>
            </div>
          </div>

          {/* Progression Signal */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">↗</span>
              <span className="text-xs text-muted">Progression</span>
            </div>
            <div className="flex items-center gap-2">
              {score.progressionActive ? (
                <>
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                    <div
                      className="h-full rounded-full bg-white/60"
                      style={{ width: `${score.progressionSignal ?? 0}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs font-medium text-white">
                    {score.progressionSignal !== null ? Math.round(score.progressionSignal) : "—"}
                  </span>
                </>
              ) : (
                <span className="text-xs text-tertiary">Building...</span>
              )}
            </div>
          </div>

          {/* Balance Score */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px]">⚖</span>
              <span className="text-xs text-muted">Balance</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                <div
                  className="h-full rounded-full bg-white/60"
                  style={{ width: `${score.balanceScore ?? 0}%` }}
                />
              </div>
              <span className="w-8 text-right text-xs font-medium text-white">
                {score.balanceScore !== null ? Math.round(score.balanceScore) : "—"}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
