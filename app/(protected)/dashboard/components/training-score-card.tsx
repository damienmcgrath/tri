"use client";

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
  const ringPct = Math.max(0, Math.min(100, score.compositeScore));
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (ringPct / 100) * circumference;
  const delta7d = getDeltaLabel(score.scoreDelta7d);

  return (
    <article className="surface p-4 md:p-5">
      {/* Header row: label + delta */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">Training score</p>
        {delta7d ? (
          <span className={`text-[11px] font-medium ${getDeltaClass(score.scoreDelta7d)}`}>
            {score.scoreDelta7d! > 0 ? "↑" : score.scoreDelta7d! < 0 ? "↓" : ""}{delta7d} this week
          </span>
        ) : null}
      </div>

      {/* Score ring — centered */}
      <div className="mt-3 flex flex-col items-center">
        <div className="relative h-24 w-24">
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
            <span className={`text-2xl font-bold ${getScoreColour(score.compositeScore)}`}>
              {Math.round(score.compositeScore)}
            </span>
          </div>
        </div>

        {!score.progressionActive ? (
          <p className="mt-2 text-center text-[11px] text-tertiary">Progression tracking builds with 2+ weeks of data</p>
        ) : null}
      </div>

      {/* Inline component breakdown — always visible */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[rgba(255,255,255,0.08)] pt-3">
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[11px]">✓</span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-tertiary">Execution</span>
          </div>
          <span className="text-sm font-semibold text-white">
            {score.executionQuality !== null ? Math.round(score.executionQuality) : "—"}
          </span>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
            <div
              className="h-full rounded-full bg-white/60"
              style={{ width: `${score.executionQuality ?? 0}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[11px]">↗</span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-tertiary">Progression</span>
          </div>
          {score.progressionActive ? (
            <>
              <span className="text-sm font-semibold text-white">
                {score.progressionSignal !== null ? Math.round(score.progressionSignal) : "—"}
              </span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                <div
                  className="h-full rounded-full bg-white/60"
                  style={{ width: `${score.progressionSignal ?? 0}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold text-tertiary">—</span>
              <span className="text-[9px] text-tertiary">Building</span>
            </>
          )}
        </div>

        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[11px]">⚖</span>
            <span className="text-[10px] uppercase tracking-[0.08em] text-tertiary">Balance</span>
          </div>
          <span className="text-sm font-semibold text-white">
            {score.balanceScore !== null ? Math.round(score.balanceScore) : "—"}
          </span>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
            <div
              className="h-full rounded-full bg-white/60"
              style={{ width: `${score.balanceScore ?? 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Coach hand-off */}
      <div className="mt-3 flex items-center justify-center">
        <a
          href={`/coach?prompt=${encodeURIComponent(`Explain my training score of ${Math.round(score.compositeScore)}. What's driving each dimension and what should I focus on to improve it?`)}`}
          className="text-[11px] font-medium text-cyan-400 transition hover:text-cyan-300"
        >
          Explain my score
        </a>
      </div>
    </article>
  );
}
