import type { WeeklyDebriefSnapshot } from "@/lib/weekly-debrief";
import { DebriefRefreshButton } from "@/app/(protected)/debrief/debrief-refresh-button";

const weekDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function formatWeekDate(iso: string) {
  return weekDateFormatter.format(new Date(`${iso}T00:00:00.000Z`));
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}hr` : `${h}hr ${m}min`;
}

type Props = {
  snapshot: WeeklyDebriefSnapshot;
};

export function WeeklyDebriefCard({ snapshot }: Props) {
  const artifact = snapshot.artifact;

  if (!snapshot.readiness.isReady) {
    return (
      <article className="surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label">Weekly Debrief</p>
            <h2 className="mt-1 text-lg font-semibold">Not enough signal yet</h2>
            <p className="mt-1 text-sm text-muted">{snapshot.readiness.reason}</p>
          </div>
          <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-tertiary">{formatWeekDate(snapshot.weekStart)}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">Key sessions</p>
            <p className="mt-2 text-sm font-medium">{snapshot.readiness.resolvedKeySessions}/{snapshot.readiness.totalKeySessions} resolved</p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">Resolved time</p>
            <p className="mt-2 text-sm font-medium">{formatDuration(snapshot.readiness.resolvedMinutes)} / {formatDuration(snapshot.readiness.plannedMinutes)}</p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">Unlocks when</p>
            <p className="mt-2 text-sm font-medium">Week is effectively complete</p>
          </div>
        </div>
      </article>
    );
  }

  if (!artifact) {
    return (
      <article className="surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label">Weekly Debrief</p>
            <h2 className="mt-1 text-lg font-semibold">Your week is ready to review</h2>
            <p className="mt-1 text-sm text-muted">Open the debrief to generate a saved weekly summary for reflection and coach handoff.</p>
          </div>
          <span className="rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-tertiary">{formatWeekDate(snapshot.weekStart)}</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`/debrief?weekStart=${snapshot.weekStart}`} className="btn-primary px-3 text-xs">
            Open debrief
          </a>
        </div>
      </article>
    );
  }

  return (
    <article className="surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="label">Weekly Debrief</p>
          <h2 className="mt-1 text-lg font-semibold">{artifact.facts.title}</h2>
          <p className="mt-1 text-sm text-muted">{artifact.facts.statusLine}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${snapshot.stale ? "border-[hsl(var(--warning)/0.38)] bg-[hsl(var(--warning)/0.12)] text-primary" : "border-[hsl(var(--border))] text-tertiary"}`}>
          {snapshot.stale ? "Needs refresh" : artifact.facts.weekRange}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {artifact.facts.factualBullets.slice(0, 3).map((fact) => (
          <div key={fact} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <p className="text-sm text-primary">{fact}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={`/debrief?weekStart=${artifact.weekStart}`} className="btn-primary px-3 text-xs">
          Open debrief
        </a>
        {snapshot.stale ? <DebriefRefreshButton weekStart={artifact.weekStart} /> : null}
      </div>
    </article>
  );
}
