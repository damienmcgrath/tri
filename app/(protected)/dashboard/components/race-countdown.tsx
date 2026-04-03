const raceDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC"
});

type Props = {
  raceName: string;
  raceDate: string;
  todayIso: string;
};

function getDaysUntil(raceDate: string, todayIso: string): number {
  const race = new Date(`${raceDate}T00:00:00.000Z`);
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  return Math.round((race.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getPhase(days: number): { label: string; color: string } {
  if (days < 0) return { label: "Post-race", color: "text-[rgba(255,255,255,0.68)]" };
  if (days === 0) return { label: "Race day", color: "text-accent" };
  if (days <= 7) return { label: "Race week", color: "text-accent" };
  if (days <= 14) return { label: "Taper phase", color: "text-[hsl(var(--warning))]" };
  return { label: "Countdown", color: "text-accent" };
}

export function RaceCountdown({ raceName, raceDate, todayIso }: Props) {
  const days = getDaysUntil(raceDate, todayIso);
  const phase = getPhase(days);
  const formattedDate = raceDateFormatter.format(new Date(`${raceDate}T00:00:00.000Z`));

  const daysLabel =
    days < 0
      ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`
      : days === 0
        ? "Today"
        : `${days} day${days === 1 ? "" : "s"}`;

  return (
    <article className="surface p-4 md:p-5 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={`text-[11px] uppercase tracking-[0.14em] ${phase.color}`}>{phase.label}</p>
          <h2 className="mt-1 truncate text-xl font-semibold">{raceName}</h2>
          <p className="mt-0.5 text-xs text-[rgba(255,255,255,0.68)]">{formattedDate}</p>
        </div>

        <div className="shrink-0 text-right sm:text-right">
          <p className="text-4xl font-bold leading-none tabular-nums">
            {days === 0 ? "0" : days < 0 ? Math.abs(days) : days}
          </p>
          <p className="mt-1 text-xs text-[rgba(255,255,255,0.68)]">
            {days === 0 ? "race day" : days < 0 ? "days past" : "days to go"}
          </p>
        </div>
      </div>

      {days > 0 && days <= 90 && (
        <div className="mt-4">
          <div className="h-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.max(2, Math.round(((90 - days) / 90) * 100))}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-[rgba(255,255,255,0.4)]">{daysLabel} remaining</p>
        </div>
      )}
    </article>
  );
}
