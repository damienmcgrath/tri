import { createClient } from "@/lib/supabase/server";
import { buildWorkoutSummary, CompletedSessionLite, PlannedSessionLite } from "@/lib/coach/workout-summary";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { TcxUploadForm } from "./tcx-upload-form";

type PlannedSession = PlannedSessionLite;
type CompletedSession = CompletedSessionLite;

const sports = ["swim", "bike", "run", "strength", "other"] as const;

function isPlannedSessionTableMissing(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return /could not find the table 'public\.planned_sessions' in the schema cache/i.test(error.message ?? "");
}

function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - distanceFromMonday);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { startDate, endDate } = getCurrentWeekRange();

  const { data: plannedData, error: plannedError } = await supabase
    .from("planned_sessions")
    .select("*")
    .gte("date", startDate)
    .lt("date", endDate)
    .order("date", { ascending: true });

  const { data: completedData, error: completedError } = await supabase
    .from("completed_sessions")
    .select("sport,metrics")
    .gte("date", startDate)
    .lt("date", endDate)
    .order("date", { ascending: true });

  if (completedError) {
    throw new Error(completedError.message ?? "Failed to load dashboard data.");
  }

  if (plannedError && !isPlannedSessionTableMissing(plannedError)) {
    throw new Error(plannedError.message ?? "Failed to load dashboard data.");
  }

  const plannedSessions = (plannedData ?? []).map((session) => ({
    sport: session.sport,
    duration:
      typeof session.duration === "number"
        ? session.duration
        : typeof session.duration_minutes === "number"
          ? session.duration_minutes
          : 0
  })) as PlannedSession[];
  const completedSessions = (completedData ?? []) as CompletedSession[];

  const summary = sports.map((sport) => {
    const plannedMin = plannedSessions
      .filter((session) => session.sport === sport)
      .reduce((sum, session) => sum + session.duration, 0);

    const completedMin = completedSessions
      .filter((session) => session.sport === sport)
      .reduce((sum, session) => sum + Math.round((session.metrics.duration_s ?? 0) / 60), 0);

    const completionPct = plannedMin === 0 ? 0 : Math.round((completedMin / plannedMin) * 100);

    return {
      sport,
      plannedMin,
      completedMin,
      completionPct
    };
  });

  const workoutSummary = buildWorkoutSummary(plannedSessions, completedSessions);

  return (
    <section className="space-y-6">
      <header className="surface p-7">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Dashboard</p>
        <h1 className="mt-2 text-3xl font-semibold">Next up: execute the week with intent</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Premium view of your plan adherence. Read the coach insights first, then drill into sport-level stats only if needed.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <article className="surface p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">On track?</p>
          <p className="mt-2 text-4xl font-semibold text-cyan-300">{workoutSummary.completionPct}%</p>
          <p className="mt-2 text-sm text-muted">
            {workoutSummary.completedMinutes} min completed of {workoutSummary.plannedMinutes} min planned this week.
          </p>
          <div className="mt-4 rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-3 text-sm text-cyan-100">
            <span className="font-medium">Coach callout:</span> Dominant discipline is {" "}
            <span className="capitalize">{workoutSummary.dominantSport}</span>. Keep intensity distributed and avoid stacking hard days.
          </div>
        </article>

        <article className="surface p-5">
          <h2 className="text-base font-semibold">This week&apos;s guidance</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            {workoutSummary.insights.map((insight) => (
              <li key={insight} className="surface-subtle px-3 py-2">
                {insight}
              </li>
            ))}
          </ul>
        </article>
      </div>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Load by discipline</h2>
        <p className="mt-1 text-sm text-muted">Muted colors indicate sport identity without overwhelming the UI.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {summary.map((item) => {
            const discipline = getDisciplineMeta(item.sport);
            return (
              <div key={item.sport} className="surface-subtle p-3">
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${discipline.className}`}>
                  {discipline.label}
                </span>
                <p className="mt-3 text-sm text-muted">Planned {item.plannedMin} min</p>
                <p className="text-sm text-muted">Completed {item.completedMin} min</p>
                <p className="mt-1 text-sm font-semibold text-cyan-300">{item.completionPct}% complete</p>
              </div>
            );
          })}
        </div>
      </article>

      <article className="surface p-5">
        <h2 className="text-lg font-semibold">Garmin TCX import</h2>
        <p className="mb-3 text-sm text-muted">Bridge workflow while API integration is pending.</p>
        <TcxUploadForm />
      </article>
    </section>
  );
}
