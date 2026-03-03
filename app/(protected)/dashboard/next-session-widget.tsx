import Link from "next/link";
import { getDisciplineMeta } from "@/lib/ui/discipline";

type NextSessionWidgetProps = {
  session: {
    id: string;
    date: string;
    sport: string;
    type: string;
    duration_minutes: number;
    is_key: boolean;
  } | null;
  todayIso: string;
  timeZone: string;
};

function formatDayLabel(dateIso: string, todayIso: string, timeZone: string) {
  const tomorrowIso = new Date(`${todayIso}T00:00:00.000Z`);
  tomorrowIso.setUTCDate(tomorrowIso.getUTCDate() + 1);
  const tomorrow = tomorrowIso.toISOString().slice(0, 10);

  if (dateIso === tomorrow) {
    return "Tomorrow";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(new Date(`${dateIso}T12:00:00.000Z`));
}

export function NextSessionWidget({ session, todayIso, timeZone }: NextSessionWidgetProps) {
  if (!session) {
    return (
      <article className="surface p-2.5 transition hover:border-[hsl(var(--fg)/0.22)]">
        <p className="text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--fg-muted))]">Next session</p>
        <p className="mt-1 text-sm font-semibold text-[hsl(var(--fg))]">No upcoming sessions scheduled.</p>
        <div className="mt-2">
          <Link href="/calendar" className="btn-secondary px-2.5 py-1 text-xs">Open calendar</Link>
        </div>
      </article>
    );
  }

  const discipline = getDisciplineMeta(session.sport);
  const dayLabel = formatDayLabel(session.date, todayIso, timeZone);

  return (
    <article className="surface p-2.5 transition hover:border-[hsl(var(--fg)/0.22)]">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--fg-muted))]">
        {session.is_key ? "Next key session" : "Next session"}
      </p>
      <p className="mt-1 text-xs font-medium text-[hsl(var(--fg-muted))]">{dayLabel}</p>
      <div className="mt-1.5 rounded-md border border-[hsl(var(--border)/0.68)] bg-[hsl(var(--surface-2)/0.42)] px-2.5 py-2">
        <p className="text-sm font-semibold text-[hsl(var(--fg))]">{session.type}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[hsl(var(--fg-muted))]">
          <span aria-hidden>{discipline.icon}</span>
          <span>{discipline.label}</span>
          <span>•</span>
          <span>{session.duration_minutes} min</span>
        </p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Link href={`/calendar?focus=${session.id}`} className="btn-secondary px-2.5 py-1 text-xs">Open</Link>
        <Link href="/calendar" className="text-xs text-[hsl(var(--fg-muted))] underline underline-offset-2 hover:text-[hsl(var(--fg))]">View week</Link>
      </div>
    </article>
  );
}
