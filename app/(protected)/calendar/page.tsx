import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";

type CalendarSession = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
};

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function getWeekDates() {
  const now = new Date();
  const day = now.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - distanceFromMonday);

  return Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      iso: date.toISOString().slice(0, 10),
      weekday: weekdayFormatter.format(date),
      label: dayFormatter.format(date)
    };
  });
}

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const weekDays = getWeekDates();
  const weekStart = weekDays[0].iso;
  const weekEndExclusive = new Date(`${weekDays[6].iso}T00:00:00.000Z`);
  weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 1);

  const { data, error } = await supabase
    .from("sessions")
    .select("id,date,sport,type,duration_minutes")
    .gte("date", weekStart)
    .lt("date", weekEndExclusive.toISOString().slice(0, 10))
    .order("date", { ascending: true });

  if (error && error.code !== "PGRST205") {
    throw new Error(error.message ?? "Failed to load weekly sessions.");
  }

  const sessions = (data ?? []) as CalendarSession[];
  const byDate = sessions.reduce<Record<string, CalendarSession[]>>((acc, session) => {
    acc[session.date] = [...(acc[session.date] ?? []), session];
    return acc;
  }, {});

  const totalMinutes = sessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);

  return (
    <section className="space-y-6">
      <header className="surface p-7">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Weekly view (Mon–Sun)</p>
        <h1 className="mt-2 text-3xl font-semibold">Command your training week</h1>
        <p className="mt-2 text-sm text-muted">
          Start with the narrative summary, then scan each day for discipline balance and load distribution.
        </p>
      </header>

      <article className="surface p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="surface-subtle p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Planned sessions</p>
            <p className="mt-1 text-2xl font-semibold">{sessions.length}</p>
          </div>
          <div className="surface-subtle p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Planned minutes</p>
            <p className="mt-1 text-2xl font-semibold">{totalMinutes}</p>
          </div>
          <div className="surface-subtle p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Week range</p>
            <p className="mt-1 text-sm font-medium">
              {weekDays[0].label} – {weekDays[6].label}
            </p>
          </div>
        </div>
      </article>

      <article className="grid gap-4 lg:grid-cols-7">
        {weekDays.map((day) => {
          const daySessions = byDate[day.iso] ?? [];
          return (
            <section key={day.iso} className="surface p-4">
              <p className="text-xs uppercase tracking-wide text-muted">{day.weekday}</p>
              <p className="mt-1 text-sm font-semibold">{day.label}</p>

              <div className="mt-3 space-y-2">
                {daySessions.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[hsl(var(--border))] px-2 py-3 text-xs text-muted">
                    No session scheduled. Add one in Plan to keep your week intentional.
                  </p>
                ) : (
                  daySessions.map((session) => {
                    const discipline = getDisciplineMeta(session.sport);
                    return (
                      <article key={session.id} className="surface-subtle p-2">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-medium ${discipline.className}`}>
                          {discipline.label}
                        </span>
                        <p className="mt-1 text-xs font-medium">{session.type}</p>
                        <p className="text-xs text-muted">{session.duration_minutes ?? 0} min</p>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </article>
    </section>
  );
}
