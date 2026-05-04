import Link from "next/link";
import type { RaceSegmentSummary } from "@/lib/race/types";

const ROLE_LABELS: Record<RaceSegmentSummary["role"], string> = {
  swim: "Swim",
  t1: "T1",
  bike: "Bike",
  t2: "T2",
  run: "Run"
};

const ROLE_ICONS: Record<RaceSegmentSummary["role"], string> = {
  swim: "🏊",
  t1: "⏱",
  bike: "🚴",
  t2: "⏱",
  run: "🏃"
};

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDistance(meters: number | null, role: RaceSegmentSummary["role"]): string | null {
  if (meters === null || meters === undefined) return null;
  if (role === "swim") {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatPace(role: RaceSegmentSummary["role"], durationSec: number, distanceM: number | null): string | null {
  if (!distanceM || distanceM <= 0 || durationSec <= 0) return null;
  if (role === "swim") {
    const secPer100 = durationSec / (distanceM / 100);
    const m = Math.floor(secPer100 / 60);
    const s = Math.round(secPer100 % 60);
    return `${m}:${String(s).padStart(2, "0")} /100m`;
  }
  if (role === "run") {
    const secPerKm = durationSec / (distanceM / 1000);
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, "0")} /km`;
  }
  if (role === "bike") {
    const kph = distanceM / 1000 / (durationSec / 3600);
    return `${kph.toFixed(1)} kph`;
  }
  return null;
}

export function RaceSegmentList({ segments }: { segments: RaceSegmentSummary[] }) {
  if (segments.length === 0) return null;

  const totalSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
  const totalDistanceM = segments.reduce((sum, s) => sum + (s.distanceM ?? 0), 0);
  const startedAt = segments[0].startTimeUtc;
  const finishedAtMs = new Date(segments[segments.length - 1].startTimeUtc).getTime()
    + Math.max(0, segments[segments.length - 1].durationSec) * 1000;
  const finishedAt = new Date(finishedAtMs).toISOString();

  const startTimeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC"
  });

  return (
    <article className="surface p-5">
      <header className="flex flex-col gap-1 border-b border-[hsl(var(--border))] pb-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race segments</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="text-base font-semibold text-[rgba(255,255,255,0.92)]">{formatDuration(totalSec)}</span>
          <span className="text-muted">total</span>
          {totalDistanceM > 0 ? (
            <>
              <span className="text-tertiary">·</span>
              <span className="text-muted">{(totalDistanceM / 1000).toFixed(2)} km</span>
            </>
          ) : null}
          <span className="text-tertiary">·</span>
          <span className="text-muted">{startTimeFormatter.format(new Date(startedAt))} → {startTimeFormatter.format(new Date(finishedAt))}</span>
        </div>
      </header>

      <ul className="mt-3 space-y-2">
        {segments.map((segment) => {
          const distanceLabel = formatDistance(segment.distanceM, segment.role);
          const paceLabel = formatPace(segment.role, segment.durationSec, segment.distanceM);
          return (
            <li key={segment.activityId}>
              <Link
                href={`/activities/${segment.activityId}`}
                className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 transition hover:border-[rgba(255,255,255,0.18)] hover:bg-[rgba(255,255,255,0.04)]"
              >
                <span aria-hidden="true" className="text-lg leading-none">{ROLE_ICONS[segment.role]}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-[rgba(255,255,255,0.92)]">{ROLE_LABELS[segment.role]}</span>
                    <span className="text-xs text-muted">{formatDuration(segment.durationSec)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 text-[11px] text-tertiary">
                    {distanceLabel ? <span>{distanceLabel}</span> : null}
                    {paceLabel ? <span>· {paceLabel}</span> : null}
                    {segment.avgHr ? <span>· {segment.avgHr} bpm</span> : null}
                    {segment.avgPower ? <span>· {segment.avgPower} W</span> : null}
                  </div>
                </div>
                <span aria-hidden="true" className="text-tertiary">→</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
