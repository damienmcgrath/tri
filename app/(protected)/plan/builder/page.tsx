import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createPlanAction, deletePlanAction } from "../actions-plan";

type Plan = { id: string; name: string; start_date: string; duration_weeks: number };

export default async function PlanBuilderPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: plansData, error } = await supabase
    .from("training_plans")
    .select("id,name,start_date,duration_weeks")
    .order("start_date", { ascending: false });

  if (error) throw new Error(error.message);

  const plans = (plansData ?? []) as Plan[];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Plan settings</h1>
          <p className="text-sm text-muted">Create plans and manage existing plan shells.</p>
        </div>
        <Link href="/plan" className="btn-secondary px-3 py-1.5 text-xs">Back to week schedule</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={createPlanAction} className="surface space-y-4 p-4">
          <h2 className="text-sm font-semibold">Create plan</h2>
          <div>
            <label className="label-base" htmlFor="plan-name">Plan name</label>
            <input id="plan-name" name="name" required className="input-base" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-base" htmlFor="plan-start">Start Monday</label>
              <input id="plan-start" name="startDate" type="date" required className="input-base" />
            </div>
            <div>
              <label className="label-base" htmlFor="plan-duration">Duration (weeks)</label>
              <input id="plan-duration" name="durationWeeks" type="number" min={1} max={52} defaultValue={12} required className="input-base" />
            </div>
          </div>
          <button className="btn-primary">Create plan with weeks</button>
        </form>

        <article className="surface p-4">
          <h2 className="text-sm font-semibold">Existing plans ({plans.length})</h2>
          <div className="mt-3 space-y-2">
            {plans.length === 0 ? (
              <p className="text-sm text-muted">No plans yet.</p>
            ) : (
              plans.map((plan) => (
                <div key={plan.id} className="flex items-start gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-2">
                  <Link href={`/plan?plan=${plan.id}`} className="min-w-0 flex-1 rounded-lg px-1 py-0.5">
                    <p className="font-medium">{plan.name}</p>
                    <p className="text-xs text-muted">{plan.start_date} • {plan.duration_weeks} weeks</p>
                  </Link>
                  <form action={deletePlanAction} onSubmit={(event) => { if (!window.confirm(`Delete plan "${plan.name}" and all weeks/sessions?`)) event.preventDefault(); }}>
                    <input type="hidden" name="planId" value={plan.id} />
                    <button className="btn-secondary px-2 py-1 text-xs">Delete</button>
                  </form>
                </div>
              ))
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
