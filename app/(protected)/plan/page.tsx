import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  createPlanAction,
  createSessionAction,
  deleteSessionAction,
  updateSessionAction
} from "./actions";

type Plan = {
  id: string;
  name: string;
  start_date: string;
  duration_weeks: number;
};

type Session = {
  id: string;
  plan_id: string;
  date: string;
  sport: string;
  type: string;
  duration: number;
  notes: string | null;
};

function getWeekLabel(date: string) {
  const start = new Date(date);
  const day = start.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - distanceFromMonday);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
}

export default async function PlanPage({
  searchParams
}: {
  searchParams?: {
    plan?: string;
  };
}) {
  const supabase = await createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: plansData, error: plansError } = await supabase
    .from("training_plans")
    .select("id,name,start_date,duration_weeks")
    .order("start_date", { ascending: false });

  if (plansError) {
    throw new Error(plansError.message);
  }

  const plans = (plansData ?? []) as Plan[];

  const selectedPlan = plans.find((plan: Plan) => plan.id === searchParams?.plan) ?? plans[0];

  const { data: sessionsData, error: sessionsError } = selectedPlan
    ? await supabase
        .from("planned_sessions")
        .select("id,plan_id,date,sport,type,duration,notes")
        .eq("plan_id", selectedPlan.id)
        .order("date", { ascending: true })
    : { data: [] as Session[], error: null };

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const sessions = (sessionsData ?? []) as Session[];

  const sessionsByWeek = sessions.reduce<Record<string, Session[]>>((groups, session: Session) => {
    const weekLabel = getWeekLabel(session.date);
    groups[weekLabel] = [...(groups[weekLabel] ?? []), session as Session];
    return groups;
  }, {});

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Training Plan</h1>
        <p className="text-slate-600">Create a plan and manage sessions by week.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-semibold">Plans</h2>
          <form action={createPlanAction} className="mt-3 grid gap-3">
            <input name="name" placeholder="Plan name" required className="rounded border px-3 py-2" />
            <div className="grid grid-cols-2 gap-3">
              <input name="startDate" type="date" required className="rounded border px-3 py-2" />
              <input
                name="durationWeeks"
                type="number"
                min={1}
                max={52}
                defaultValue={12}
                required
                className="rounded border px-3 py-2"
              />
            </div>
            <button className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">Create plan</button>
          </form>

          <ul className="mt-4 space-y-2">
            {plans.map((plan: Plan) => {
              const isActive = plan.id === selectedPlan?.id;
              return (
                <li key={plan.id}>
                  <Link
                    href={`/plan?plan=${plan.id}`}
                    className={`block rounded border px-3 py-2 ${
                      isActive ? "border-slate-900 bg-slate-100" : "border-slate-200"
                    }`}
                  >
                    <p className="font-medium">{plan.name}</p>
                    <p className="text-sm text-slate-600">
                      Starts {plan.start_date} • {plan.duration_weeks} weeks
                    </p>
                  </Link>
                </li>
              );
            })}
            {plans.length === 0 ? <li className="text-sm text-slate-600">No plans yet.</li> : null}
          </ul>
        </article>

        {selectedPlan ? (
          <article className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold">Add Session</h2>
            <form action={createSessionAction} className="mt-3 grid gap-3">
              <input type="hidden" name="planId" value={selectedPlan.id} />
              <div className="grid grid-cols-2 gap-3">
                <input name="date" type="date" required className="rounded border px-3 py-2" />
                <input name="durationMinutes" type="number" min={1} required className="rounded border px-3 py-2" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select name="sport" required className="rounded border px-3 py-2">
                  <option value="run">Run</option>
                  <option value="bike">Bike</option>
                  <option value="swim">Swim</option>
                  <option value="strength">Strength</option>
                  <option value="other">Other</option>
                </select>
                <input name="sessionType" placeholder="Intensity / type" required className="rounded border px-3 py-2" />
              </div>
              <textarea name="notes" placeholder="Notes" className="rounded border px-3 py-2" rows={3} />
              <button className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">Add session</button>
            </form>
          </article>
        ) : null}
      </div>

      {selectedPlan ? (
        <article className="space-y-4">
          <h2 className="text-lg font-semibold">Week / Session List</h2>
          {sessions.length === 0 ? <p className="text-sm text-slate-600">No sessions for this plan.</p> : null}
          {Object.entries(sessionsByWeek).map(([week, weekSessions]) => (
            <div key={week} className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 font-medium">Week of {week}</h3>
              <div className="space-y-3">
                {weekSessions.map((session: Session) => (
                  <form key={session.id} action={updateSessionAction} className="rounded border border-slate-200 p-3">
                    <input type="hidden" name="sessionId" value={session.id} />
                    <input type="hidden" name="planId" value={selectedPlan.id} />
                    <div className="grid gap-3 md:grid-cols-5">
                      <input name="date" type="date" defaultValue={session.date} required className="rounded border px-2 py-1" />
                      <select name="sport" defaultValue={session.sport} required className="rounded border px-2 py-1">
                        <option value="run">Run</option>
                        <option value="bike">Bike</option>
                        <option value="swim">Swim</option>
                        <option value="strength">Strength</option>
                        <option value="other">Other</option>
                      </select>
                      <input
                        name="durationMinutes"
                        type="number"
                        min={1}
                        defaultValue={session.duration}
                        required
                        className="rounded border px-2 py-1"
                      />
                      <input
                        name="sessionType"
                        defaultValue={session.type}
                        required
                        className="rounded border px-2 py-1"
                      />
                      <input name="notes" defaultValue={session.notes ?? ""} className="rounded border px-2 py-1" />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button className="rounded bg-slate-900 px-3 py-1 text-sm text-white">Save</button>
                      <button formAction={deleteSessionAction} className="rounded border px-3 py-1 text-sm">
                        Delete
                      </button>
                    </div>
                  </form>
                ))}
              </div>
            </div>
          ))}
        </article>
      ) : null}
    </section>
  );
}
