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

function getDeltaClass(delta: number | null): string {
  if (delta === null || delta === 0) return "text-tertiary";
  return delta > 0 ? "text-success" : "text-danger";
}

type WeakestComponent = {
  key: "execution" | "progression" | "balance";
  label: string;
  value: number;
  prompt: string;
  linkLabel: string;
};

function getWeakestComponent(score: TrainingScore): WeakestComponent | null {
  const candidates: WeakestComponent[] = [];
  if (score.executionQuality !== null) {
    candidates.push({
      key: "execution",
      label: "Execution",
      value: score.executionQuality,
      prompt: `My Execution score is ${Math.round(score.executionQuality)}. Which recent sessions pulled it down and what should I adjust in how I hit sessions to bring it back up?`,
      linkLabel: "Why did Execution drop?"
    });
  }
  if (score.progressionActive && score.progressionSignal !== null) {
    candidates.push({
      key: "progression",
      label: "Progression",
      value: score.progressionSignal,
      prompt: `My Progression signal is ${Math.round(score.progressionSignal)}. Which disciplines or metrics are flat or regressing over my recent comparable sessions, and what should I change to restart progression?`,
      linkLabel: "Why is Progression flat?"
    });
  }
  if (score.balanceScore !== null) {
    candidates.push({
      key: "balance",
      label: "Balance",
      value: score.balanceScore,
      prompt: `My Balance score is ${Math.round(score.balanceScore)} for a ${score.goalRaceType ?? "triathlon"} goal. Where am I over- or under-invested relative to an ideal distribution, and what should I shift next week?`,
      linkLabel: "Why is Balance off?"
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.value - b.value);
  return candidates[0];
}

type SubScore = {
  label: string;
  value: number | null;
  active: boolean;
  fillClass: string;
};

function trendGlyph(delta: number | null): string {
  if (delta === null || delta === 0) return "→";
  return delta > 0 ? "↑" : "↓";
}

function trendText(delta: number | null): string {
  if (delta === null) return "first week of data";
  if (delta === 0) return "steady this week";
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  return `${signed} this week`;
}

export function TrainingScoreCard({ score }: Props) {
  const ringPct = Math.max(0, Math.min(100, score.compositeScore));
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (ringPct / 100) * circumference;
  const weakest = getWeakestComponent(score);
  const coachPrompt =
    weakest !== null
      ? weakest.prompt
      : `Explain my training score of ${Math.round(score.compositeScore)}. What's driving each dimension and what should I focus on to improve it?`;
  const coachLabel = weakest !== null ? weakest.linkLabel : "Explain my score";

  const subScores: SubScore[] = [
    {
      label: "Execution",
      value: score.executionQuality,
      active: true,
      fillClass: "bg-[var(--color-success)]"
    },
    {
      label: "Progression",
      value: score.progressionActive ? score.progressionSignal : null,
      active: score.progressionActive,
      fillClass: "bg-[var(--color-accent)]"
    },
    {
      label: "Balance",
      value: score.balanceScore,
      active: true,
      fillClass: "bg-[var(--color-info)]"
    }
  ];

  return (
    <article className="surface p-4 md:p-5">
      {/* Hero row: ring + label + trend */}
      <div className="flex items-center gap-4">
        <div className="relative h-24 w-24 shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
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
            <span className={`text-page-title font-semibold ${getScoreColour(score.compositeScore)}`}>
              {Math.round(score.compositeScore)}
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="card-kicker">Training score</p>
          <p className={`mt-1 text-[15px] font-medium ${getDeltaClass(score.scoreDelta7d)}`}>
            <span aria-hidden="true" className="mr-1">{trendGlyph(score.scoreDelta7d)}</span>
            {trendText(score.scoreDelta7d)}
          </p>
          {!score.progressionActive ? (
            <p className="mt-1 text-ui-label text-tertiary">Progression builds with 2+ weeks of data</p>
          ) : null}
        </div>
      </div>

      {/* Sub-score tracks — labeled horizontal bars, color-coded by component */}
      <div className="mt-4 space-y-2.5 border-t border-[rgba(255,255,255,0.08)] pt-3">
        {subScores.map((sub) => {
          const pct = sub.active && sub.value !== null ? Math.max(0, Math.min(100, sub.value)) : 0;
          const display = sub.active && sub.value !== null ? Math.round(sub.value) : "—";
          return (
            <div key={sub.label} className="grid grid-cols-[88px_1fr_auto] items-center gap-3">
              <span className="text-kicker text-tertiary">{sub.label}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                <div
                  className={`h-full rounded-full transition-ui ${sub.active ? sub.fillClass : "bg-white/20"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-6 text-right text-body font-medium tabular-nums text-white">{display}</span>
            </div>
          );
        })}
      </div>

      {/* Coach handoff — inline muted link, not a block */}
      <a
        href={`/coach?prompt=${encodeURIComponent(coachPrompt)}`}
        className="mt-3 inline-flex text-[12px] text-tertiary transition hover:text-white"
      >
        {coachLabel} →
      </a>
    </article>
  );
}
