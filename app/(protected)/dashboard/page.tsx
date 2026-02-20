import { createClient } from "@/lib/supabase/server";
import { TcxUploadForm } from "./tcx-upload-form";

type PlannedSession = {
  sport: "swim" | "bike" | "run" | "strength" | "other";
  duration: number;
};

type CompletedSession = {
  sport: "swim" | "bike" | "run" | "strength" | "other";
  metrics: {
    duration_s?: number;
  };
};

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

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-slate-600">Weekly planned vs completed training plus TCX import for Garmin exports.</p>
      </header>

      <article className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">Import Garmin TCX</h2>
        <p className="mb-3 text-sm text-slate-600">Temporary MVP bridge until Garmin Health API sync is wired.</p>
        <TcxUploadForm />
      </article>

      <article className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold">This Week by Sport</h2>
        <p className="mb-3 text-sm text-slate-600">Week starts Monday (UTC).</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {summary.map((item) => (
            <div key={item.sport} className="rounded border border-slate-200 p-3">
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
