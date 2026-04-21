import type { WeeklyDebriefSnapshot } from "@/lib/weekly-debrief";
import { DebriefRefreshButton } from "@/app/(protected)/debrief/debrief-refresh-button";
import { ShareSummaryButton } from "@/app/(protected)/debrief/components/share-summary-button";

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
  displayName?: string | null;
};

export function WeeklyDebriefCard({ snapshot, displayName = null }: Props) {
  const artifact = snapshot.artifact;

  if (!snapshot.readiness.isReady) {
    const remaining = Math.max(snapshot.readiness.totalKeySessions - snapshot.readiness.resolvedKeySessions, 1);
    const sessionWord = remaining === 1 ? "key session" : "key sessions";
    return (
      <aside
        className="surface flex flex-wrap items-center gap-3 px-4 py-3"
        aria-label="Weekly debrief status"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-tertiary">
          <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.5" />
          <path d="M5.5 7V4.75a2.5 2.5 0 0 1 5 0V7" />
        </svg>
        <p className="flex-1 min-w-0 text-sm text-muted">
          <span className="font-medium text-white">Weekly debrief</span> unlocks after {remaining} more {sessionWord} · {formatDuration(snapshot.readiness.resolvedMinutes)} of {formatDuration(snapshot.readiness.plannedMinutes)}
        </p>
        <span className="text-xs tabular-nums text-tertiary">{formatWeekDate(snapshot.weekStart)}</span>
      </aside>
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
        <span className={`rounded-full border px-3 py-1 text-xs ${snapshot.stale ? "border-[hsl(var(--warning)/0.38)] bg-[hsl(var(--warning)/0.12)] text-white" : "border-[hsl(var(--border))] text-tertiary"}`}>
          {snapshot.stale ? "Needs refresh" : artifact.facts.weekRange}
        </span>
      </div>

      {artifact.narrative?.executiveSummary ? (
        <div className="mt-3">
          <p className="line-clamp-3 text-sm leading-relaxed text-[rgba(255,255,255,0.78)]">{artifact.narrative.executiveSummary}</p>
          <a href={`/debrief?weekStart=${artifact.weekStart}`} className="mt-1 inline-block text-xs text-cyan-400 hover:text-cyan-300">
            Read more →
          </a>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {artifact.facts.factualBullets.slice(0, 3).map((fact) => (
          <div key={fact} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
            <p className="text-sm text-white">{fact}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a href={`/debrief?weekStart=${artifact.weekStart}`} className="btn-primary px-3 text-xs">
          Open debrief
        </a>
        <ShareSummaryButton weekOf={artifact.weekStart} displayName={displayName ?? null} />
        {snapshot.stale ? <DebriefRefreshButton weekStart={artifact.weekStart} /> : null}
      </div>
    </article>
  );
}
