"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getMonday(date = new Date()) {
  const day = date.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - distanceFromMonday);
  return monday;
}

function weekRangeLabel(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return `${shortDateFormatter.format(start)}–${shortDateFormatter.format(end)}`;
}

export function GlobalHeader({ raceName, daysToRace, weekCompletion }: { raceName: string; daysToRace: number | null; weekCompletion: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentWeekStart = getMonday().toISOString().slice(0, 10);
  const weekStart = searchParams.get("weekStart") ?? currentWeekStart;

  const withWeek = (targetWeekStart: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (targetWeekStart === currentWeekStart) {
      params.delete("weekStart");
    } else {
      params.set("weekStart", targetWeekStart);
    }
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  };

  return (
    <div className="shell-header border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))/0.95] backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm uppercase tracking-[0.2em] text-accent">tri.ai</span>
          <span className="hidden text-xs text-muted sm:inline">{weekRangeLabel(weekStart)}</span>
          <Link href={withWeek(addDays(weekStart, -7))} className="btn-secondary px-2.5 py-1 text-xs">Prev</Link>
          <Link href={withWeek(currentWeekStart)} className={`btn-secondary px-2.5 py-1 text-xs ${weekStart === currentWeekStart ? "border-[hsl(var(--accent-performance)/0.55)] text-accent" : ""}`}>Current</Link>
          <Link href={withWeek(addDays(weekStart, 7))} className="btn-secondary px-2.5 py-1 text-xs">Next</Link>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {daysToRace !== null ? <span className="rounded-full border pill-accent px-3 py-1 text-xs font-medium">{raceName} • {daysToRace} days</span> : null}
          <span className="signal-chip signal-recovery">Week {weekCompletion}%</span>
          <Link href="/coach" className="btn-primary px-3 py-1.5 text-xs">Ask tri.ai</Link>
        </div>
      </div>
    </div>
  );
}
