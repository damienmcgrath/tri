/**
 * Transition analysis card.
 *
 * Compact comparison of T1/T2 against distance-keyed population medians,
 * plus end-of-leg HR. Spec calls out transitions as the one place a
 * population reference is acceptable since there's no athlete-specific
 * training analogue. Hidden when the bundle's transitions are inferred
 * from gaps (Strava-stitched), since the timing is too imprecise.
 */

export type TransitionsAnalysisPayload = {
  t1: {
    athleteSec: number;
    populationMedianSec: number | null;
    hrAtEnd: number | null;
    summary: string;
  } | null;
  t2: {
    athleteSec: number;
    populationMedianSec: number | null;
    hrAtEnd: number | null;
    summary: string;
  } | null;
};

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TransitionsAnalysisCard({ analysis }: { analysis: TransitionsAnalysisPayload }) {
  if (!analysis.t1 && !analysis.t2) return null;

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Transitions analysis</p>
      <dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {(["t1", "t2"] as const).map((key) => {
          const row = analysis[key];
          if (!row) return null;
          return (
            <div key={key} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-tertiary">{key.toUpperCase()}</dt>
                <dd className="font-mono text-base text-[rgba(255,255,255,0.92)]">{formatDuration(row.athleteSec)}</dd>
              </div>
              <p className="mt-2 text-sm text-[rgba(255,255,255,0.86)]">{row.summary}</p>
              {row.populationMedianSec !== null || row.hrAtEnd !== null ? (
                <ul className="mt-2 space-y-1">
                  {row.populationMedianSec !== null ? (
                    <li className="text-xs text-tertiary">Typical: {formatDuration(row.populationMedianSec)}</li>
                  ) : null}
                  {row.hrAtEnd !== null ? <li className="text-xs text-tertiary">End HR: {row.hrAtEnd} bpm</li> : null}
                </ul>
              ) : null}
            </div>
          );
        })}
      </dl>
    </article>
  );
}
