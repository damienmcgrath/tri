"use client";

import { useRouter } from "next/navigation";

type DayState = "rest" | "planned" | "completed" | "in_progress" | "missed";

type WeekStripDay = {
  dateIso: string;
  label: string;
  plannedCount: number;
  completedCount: number;
  state: DayState;
  isToday: boolean;
};

type WeekStripProps = {
  weekStartIso: string;
  days: WeekStripDay[];
};

function getDotClassName(state: DayState) {
  if (state === "completed") {
    return "border-[hsl(var(--success)/0.4)] bg-[hsl(var(--success)/0.34)]";
  }

  if (state === "missed") {
    return "border-[hsl(var(--warning)/0.7)] bg-[hsl(var(--warning)/0.18)]";
  }

  if (state === "planned") {
    return "border-[hsl(var(--border)/0.95)] bg-transparent";
  }

  if (state === "rest") {
    return "border-[hsl(var(--border)/0.42)] bg-[hsl(var(--surface-2)/0.36)]";
  }

  return "border-[hsl(var(--border)/0.95)] bg-transparent";
}

export function WeekStrip({ weekStartIso, days }: WeekStripProps) {
  const router = useRouter();

  return (
    <div className="mt-3 grid grid-cols-7 gap-1" role="list" aria-label="Week progress by day">
      {days.map((day) => {
        const stateLabel =
          day.state === "completed"
            ? "completed"
            : day.state === "in_progress"
              ? "in progress"
              : day.state === "missed"
                ? "missed"
                : day.state === "planned"
                  ? "planned"
                  : "rest";

        return (
          <button
            key={day.dateIso}
            type="button"
            role="listitem"
            onClick={() => router.push(`/calendar?weekStart=${weekStartIso}&day=${day.dateIso}`)}
            className="group flex min-h-12 flex-col items-center justify-center rounded-md border border-transparent px-1 py-1.5 text-center transition hover:border-[hsl(var(--border)/0.65)] hover:bg-[hsl(var(--surface-2)/0.44)]"
            aria-label={`${day.label}: ${stateLabel}, planned ${day.plannedCount}, completed ${day.completedCount}`}
          >
            <span className="text-[10px] uppercase tracking-[0.08em] text-[hsl(var(--fg-muted))]">{day.label}</span>
            <span className={`mt-1 inline-flex h-4 w-4 items-center justify-center rounded-full ${day.isToday ? "ring-1 ring-[hsl(var(--accent-performance)/0.55)] ring-offset-1 ring-offset-[hsl(var(--bg-card))]" : ""}`}>
              <span className={`relative h-2.5 w-2.5 rounded-full border ${getDotClassName(day.state)}`}>
                {day.state === "in_progress" ? (
                  <span className="absolute inset-x-0 bottom-0 h-1/2 rounded-b-full bg-[hsl(var(--success)/0.3)]" />
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
