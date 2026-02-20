import { createClient } from "@/lib/supabase/server";
import { buildWorkoutSummary, CompletedSessionLite, PlannedSessionLite } from "@/lib/coach/workout-summary";
import { TcxUploadForm } from "./tcx-upload-form";

type PlannedSession = PlannedSessionLite;
type CompletedSession = CompletedSessionLite;

const sports = ["swim", "bike", "run", "strength", "other"] as const;

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

  const { data: plannedData } = await supabase
    .from("planned_sessions")
    .select("sport,duration")
    .gte("date", startDate)
    .lt("date", endDate)
    .order("date", { ascending: true });

  const { data: completedData } = await supabase
    .from("completed_sessions")
    .select("sport,metrics")
    .gte("date", startDate)
    .lt("date", endDate)
    .order("date", { ascending: true });

  const plannedSessions = (plannedData ?? []) as PlannedSession[];
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
    <section className="space-y-8">
      <header className="rounded-2xl bg-gradient-to-r from-slate-950 via-cyan-900 to-slate-900 p-8 text-white shadow-xl">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Dashboard</p>
        <h1 className="mt-2 text-3xl font-bold">Your weekly training command center</h1>
        <p className="mt-2 text-sm text-slate-100">
          Compare planned vs completed load, import workouts, and get coaching-ready analysis at a glance.
        </p>
      </header>

      <article className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Planned</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{workoutSummary.plannedMinutes} min</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Completed</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{workoutSummary.completedMinutes} min</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Completion</p>
          <p className="mt-1 text-2xl font-bold text-cyan-700">{workoutSummary.completionPct}%</p>
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Workout analysis and summary</h2>
        <p className="mt-1 text-sm text-slate-600">
          Dominant sport this week: <span className="font-medium capitalize text-slate-900">{workoutSummary.dominantSport}</span>
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {workoutSummary.insights.map((insight) => (
            <li key={insight}>{insight}</li>
          ))}
        </ul>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Import Garmin TCX</h2>
        <p className="mb-3 text-sm text-slate-600">Temporary bridge while Garmin Health API access is unavailable.</p>
        <TcxUploadForm />
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">This Week by Sport</h2>
        <p className="mb-3 text-sm text-slate-600">Week starts Monday (UTC).</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {summary.map((item) => (
            <div key={item.sport} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium capitalize text-slate-700">{item.sport}</p>
              <p className="mt-2 text-sm text-slate-600">Planned: {item.plannedMin} min</p>
              <p className="text-sm text-slate-600">Completed: {item.completedMin} min</p>
              <p className="mt-1 text-xs font-semibold text-cyan-700">Completion: {item.completionPct}%</p>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
