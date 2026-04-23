"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

type WeekOption = {
  weekStart: string;
  label: string;
  blockLabel: string | null;
};

type Props = {
  weekStart: string;
  currentWeekStart: string;
  weekOptions: WeekOption[];
  blockLabel: string | null;
  weekNumber: number | null;
};

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const weekDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00.000Z`);
  const end = new Date(`${addDays(weekStart, 6)}T00:00:00.000Z`);
  return `${weekDateFormatter.format(start)} – ${weekDateFormatter.format(end)}`;
}

export function WeekNavigator({ weekStart, currentWeekStart, weekOptions, blockLabel, weekNumber }: Props) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);

  const currentIndex = weekOptions.findIndex((w) => w.weekStart === weekStart);
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < weekOptions.length - 1;
  const isCurrentWeek = weekStart === currentWeekStart;

  const navigate = useCallback(
    (targetWeekStart: string) => {
      if (targetWeekStart === currentWeekStart) {
        router.push("/dashboard");
      } else {
        router.push(`/dashboard?weekStart=${targetWeekStart}`);
      }
      setPickerOpen(false);
    },
    [router, currentWeekStart]
  );

  const goPrev = useCallback(() => {
    if (canGoPrev) navigate(weekOptions[currentIndex - 1].weekStart);
  }, [canGoPrev, currentIndex, weekOptions, navigate]);

  const goNext = useCallback(() => {
    if (canGoNext) navigate(weekOptions[currentIndex + 1].weekStart);
  }, [canGoNext, currentIndex, weekOptions, navigate]);

  const weekLabel = weekNumber
    ? `Week ${weekNumber}${blockLabel ? ` — ${blockLabel}` : ""}`
    : formatWeekRange(weekStart);

  return (
    <div className="relative flex items-center gap-2">
      <button
        onClick={goPrev}
        disabled={!canGoPrev}
        aria-label="Previous week"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(255,255,255,0.12)] text-body text-white transition hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-25 disabled:hover:bg-transparent"
      >
        ◀
      </button>

      <button
        onClick={() => setPickerOpen(!pickerOpen)}
        className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-body font-medium text-white transition hover:bg-[rgba(255,255,255,0.06)]"
      >
        <span className="truncate">{weekLabel}</span>
        {isCurrentWeek ? (
          <span className="shrink-0 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-ui-label font-semibold text-black">
            Current
          </span>
        ) : null}
        <span className="shrink-0 text-ui-label text-tertiary">▼</span>
      </button>

      <button
        onClick={goNext}
        disabled={!canGoNext}
        aria-label="Next week"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(255,255,255,0.12)] text-body text-white transition hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-25 disabled:hover:bg-transparent"
      >
        ▶
      </button>

      {!isCurrentWeek ? (
        <button
          onClick={() => navigate(currentWeekStart)}
          className="ml-1 rounded-md border border-[rgba(255,255,255,0.12)] px-2.5 py-1 text-ui-label text-[rgba(255,255,255,0.7)] transition hover:bg-[rgba(255,255,255,0.06)]"
        >
          Today
        </button>
      ) : null}

      {/* Week picker dropdown */}
      {pickerOpen ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-xl border border-[rgba(255,255,255,0.12)] bg-[hsl(var(--surface))] p-1 shadow-xl">
            {weekOptions.map((option) => (
              <button
                key={option.weekStart}
                onClick={() => navigate(option.weekStart)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-body transition hover:bg-[rgba(255,255,255,0.06)] ${
                  option.weekStart === weekStart
                    ? "bg-[rgba(255,255,255,0.08)] text-white"
                    : "text-[rgba(255,255,255,0.7)]"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {option.blockLabel ? (
                  <span className="ml-2 shrink-0 text-ui-label text-tertiary">{option.blockLabel}</span>
                ) : null}
                {option.weekStart === currentWeekStart ? (
                  <span className="ml-2 shrink-0 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[9px] font-semibold text-black">
                    Now
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
