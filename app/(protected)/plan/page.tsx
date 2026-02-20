import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDisciplineMeta } from "@/lib/ui/discipline";
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


function isPlannedSessionTableMissing(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return /could not find the table 'public\.planned_sessions' in the schema cache/i.test(error.message ?? "");
}

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

  if (sessionsError && !isPlannedSessionTableMissing(sessionsError)) {
    throw new Error(sessionsError.message);
  }

  const sessions = (sessionsData ?? []) as Session[];

  const sessionsByWeek = sessions.reduce<Record<string, Session[]>>((groups, session: Session) => {
    const weekLabel = getWeekLabel(session.date);
    groups[weekLabel] = [...(groups[weekLabel] ?? []), session as Session];
    return groups;
  }, {});

  return (
    <section className="space-y-6">
      <header className="surface p-6">
        <h1 className="text-2xl font-semibold">Training Plan</h1>
        <p className="mt-1 text-sm text-muted">Build your week with clear structure and adjustable sessions.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <article className="surface p-5">
          <h2 className="text-lg font-semibold">Plans</h2>
          <form action={createPlanAction} className="mt-3 grid gap-3">
            <input name="name" placeholder="Plan name" required aria-label="Plan name" className="input-base" />
            <div className="grid grid-cols-2 gap-3">
              <input name="startDate" type="date" required aria-label="Plan start date" className="input-base" />
              <input
                name="durationWeeks"
                type="number"
                min={1}
                max={52}
                defaultValue={12}
                required
                aria-label="Plan duration in weeks"
                className="input-base"
              />
            </div>
            <button className="btn-primary">Create plan</button>
          </form>

          <ul className="mt-4 space-y-2">
            {plans.map((plan: Plan) => {
              const isActive = plan.id === selectedPlan?.id;
              return (
                <li key={plan.id}>
                  <Link
                    href={`/plan?plan=${plan.id}`}
                    className={`block rounded-xl border px-3 py-2 transition ${
                      isActive
                        ? "border-cyan-400/50 bg-cyan-500/10"
                        : "border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] hover:border-cyan-400/40"
                    }`}
                  >
                    <p className="font-medium">{plan.name}</p>
                    <p className="text-sm text-muted">
                      Starts {plan.start_date} • {plan.duration_weeks} weeks
                    </p>
                  </Link>
                </li>
              );
            })}
            {plans.length === 0 ? (
              <li className="rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-4 text-sm text-muted">
                No plans yet. Create one to unlock week and session management.
              </li>
            ) : null}
          </ul>
        </article>

        {selectedPlan ? (
          <article className="surface p-5">
            <h2 className="text-lg font-semibold">Add Session</h2>
            <form action={createSessionAction} className="mt-3 grid gap-3">
              <input type="hidden" name="planId" value={selectedPlan.id} />
              <div className="grid grid-cols-2 gap-3">
                <input name="date" type="date" required aria-label="Session date" className="input-base" />
                <input
                  name="durationMinutes"
                  type="number"
                  min={1}
                  required
                  aria-label="Session duration in minutes"
                  className="input-base"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <select name="sport" required aria-label="Session discipline" className="input-base">
                  <option value="run">Run</option>
                  <option value="bike">Bike</option>
                  <option value="swim">Swim</option>
                  <option value="strength">Strength</option>
                  <option value="other">Other</option>
                </select>
                <input name="sessionType" placeholder="Intensity / type" required aria-label="Session type" className="input-base" />
              </div>
              <textarea name="notes" placeholder="Notes" aria-label="Session notes" className="input-base min-h-20" />
              <button className="btn-primary">Add session</button>
            </form>
          </article>
        ) : null}
      </div>

      {selectedPlan ? (
        <article className="space-y-4">
          <h2 className="text-lg font-semibold">Week / Session List</h2>
          {sessions.length === 0 ? (
            <p className="surface border-dashed p-5 text-sm text-muted">
              No sessions yet. Add a session to begin your structured week.
            </p>
          ) : null}
          {Object.entries(sessionsByWeek).map(([week, weekSessions]) => (
            <div key={week} className="surface p-4">
              <h3 className="mb-3 font-medium">Week of {week}</h3>
              <div className="space-y-3">
                {weekSessions.map((session: Session) => {
                  const discipline = getDisciplineMeta(session.sport);
                  return (
                    <form key={session.id} action={updateSessionAction} className="surface-subtle p-3">
                      <input type="hidden" name="sessionId" value={session.id} />
                      <input type="hidden" name="planId" value={selectedPlan.id} />
                      <div className="mb-2 flex items-center justify-between">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${discipline.className}`}>
                          {discipline.label}
                        </span>
                        <span className="rounded-full border border-cyan-400/50 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-200">
                          Session detail
                        </span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-5">
                        <input name="date" type="date" defaultValue={session.date} required className="input-base" />
                        <select name="sport" defaultValue={session.sport} required className="input-base">
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
                          className="input-base"
                        />
                        <input name="sessionType" defaultValue={session.type} required className="input-base" />
                        <input name="notes" defaultValue={session.notes ?? ""} className="input-base" />
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button className="btn-primary px-3 py-1.5">Save</button>
                        <button formAction={deleteSessionAction} className="btn-secondary px-3 py-1.5">
                          Delete
                        </button>
                      </div>
                    </form>
                  );
                })}
              </div>
            </div>
          ))}
        </article>
      ) : null}
    </section>
  );
}
