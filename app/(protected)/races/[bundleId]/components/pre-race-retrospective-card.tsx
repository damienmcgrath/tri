/**
 * Phase 3.3 — Pre-race Retrospective card.
 *
 * Renders the build-cycle assessment: CTL trajectory peak, taper compliance,
 * key-session execution rate, and the AI verdict + actionable adjustment for
 * the NEXT build cycle.
 */

import type { PreRaceRetrospective } from "@/lib/race-review/retrospective-schemas";

function formatDate(d: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${d.slice(0, 10)}T00:00:00.000Z`));
}

export function PreRaceRetrospectiveCard({ retro }: { retro: PreRaceRetrospective }) {
  const peakWindow = retro.ctlTrajectory.daysFromPeakToRace;
  const peakWindowColor = peakWindow >= 7 && peakWindow <= 14
    ? "text-emerald-300"
    : peakWindow > 14
    ? "text-orange-300"
    : "text-tertiary";

  const taperPct = retro.taperReadOut.complianceScore != null
    ? Math.round(retro.taperReadOut.complianceScore * 100)
    : null;
  const taperColor = taperPct == null
    ? "text-tertiary"
    : taperPct >= 90
    ? "text-emerald-300"
    : taperPct >= 75
    ? "text-amber-300"
    : "text-orange-300";

  const exec = retro.keySessionExecutionRate;
  const execPct = Math.round(exec.rate * 100);
  const execColor =
    exec.totalKeySessions === 0
      ? "text-tertiary"
      : exec.rate >= 0.85
      ? "text-emerald-300"
      : exec.rate >= 0.7
      ? "text-amber-300"
      : "text-orange-300";

  return (
    <article className="surface p-5">
      <div className="border-b border-[hsl(var(--border))] pb-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
          Pre-race retrospective
        </p>
        <p className="mt-1 text-xs text-muted">
          Did the {retro.buildWindowDays}-day build cycle work? Adjustments below feed the next periodisation.
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
        <div className="flex flex-col">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-tertiary">Peak CTL</dt>
          <dd className="font-mono text-base text-[rgba(255,255,255,0.92)]">
            {retro.ctlTrajectory.peakCtl}
          </dd>
          <dd className={`text-xs ${peakWindowColor}`}>
            {peakWindow}d before race · {formatDate(retro.ctlTrajectory.peakCtlDate)}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-tertiary">Taper compliance</dt>
          <dd className={`font-mono text-base ${taperColor}`}>
            {taperPct == null ? "—" : `${taperPct}%`}
          </dd>
          {retro.taperReadOut.summary ? (
            <dd className="text-xs text-tertiary line-clamp-2">{retro.taperReadOut.summary}</dd>
          ) : null}
        </div>
        <div className="flex flex-col">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-tertiary">Key sessions executed</dt>
          <dd className={`font-mono text-base ${execColor}`}>
            {exec.totalKeySessions === 0
              ? "—"
              : `${exec.completedKeySessions}/${exec.totalKeySessions}`}
          </dd>
          {exec.totalKeySessions > 0 ? (
            <dd className={`text-xs ${execColor}`}>{execPct}%</dd>
          ) : null}
        </div>
      </dl>

      <section className="mt-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
        <p className="text-sm font-medium text-[rgba(255,255,255,0.92)]">{retro.verdict.headline}</p>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.78)]">{retro.verdict.body}</p>
        <p className="mt-2 text-xs text-emerald-300/90">
          <span className="font-semibold uppercase tracking-[0.08em]">Next build:</span>{" "}
          {retro.verdict.actionableAdjustment}
        </p>
      </section>
    </article>
  );
}
