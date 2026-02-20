import { createClient } from "@/lib/supabase/server";
import { PlanEditor } from "./plan-editor";

type Plan = {
  id: string;
  name: string;
  start_date: string;
  duration_weeks: number;
};

type TrainingWeek = {
  id: string;
  plan_id: string;
  week_index: number;
  week_start_date: string;
  focus: "Build" | "Recovery" | "Taper" | "Race" | "Custom";
  notes: string | null;
  target_minutes: number | null;
  target_tss: number | null;
};

type Session = {
  id: string;
  plan_id: string;
  week_id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number;
  notes: string | null;
  distance_value: number | null;
  distance_unit: string | null;
  status: "planned" | "completed" | "skipped";
};


function isMissingTableError(error: { code?: string; message?: string } | null, tableName: string) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes(`could not find the table '${tableName.toLowerCase()}' in the schema cache`);
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
  const selectedPlan = plans.find((plan) => plan.id === searchParams?.plan) ?? plans[0];

  const { data: weeksData, error: weeksError } = selectedPlan
    ? await supabase
        .from("training_weeks")
        .select("id,plan_id,week_index,week_start_date,focus,notes,target_minutes,target_tss")
        .eq("plan_id", selectedPlan.id)
        .order("week_index", { ascending: true })
    : { data: [] as TrainingWeek[], error: null };

  if (weeksError && !isMissingTableError(weeksError, "public.training_weeks")) {
    throw new Error(weeksError.message);
  }

  let sessionsData: Session[] = [];
  if (selectedPlan) {
    const primary = await supabase
      .from("sessions")
      .select("id,plan_id,week_id,date,sport,type,duration_minutes,notes,distance_value,distance_unit,status")
      .eq("plan_id", selectedPlan.id)
      .order("date", { ascending: true });

    if (primary.error && isMissingTableError(primary.error, "public.sessions")) {
      const legacy = await supabase
        .from("planned_sessions")
        .select("id,plan_id,date,sport,type,duration,notes")
        .eq("plan_id", selectedPlan.id)
        .order("date", { ascending: true });

      if (legacy.error && !isMissingTableError(legacy.error, "public.planned_sessions")) {
        throw new Error(legacy.error.message);
      }

      sessionsData = ((legacy.data ?? []) as Array<{
        id: string;
        plan_id: string;
        date: string;
        sport: string;
        type: string;
        duration: number;
        notes: string | null;
      }>).map((session) => ({
        id: session.id,
        plan_id: session.plan_id,
        week_id: "",
        date: session.date,
        sport: session.sport,
        type: session.type,
        duration_minutes: session.duration,
        notes: session.notes,
        distance_value: null,
        distance_unit: null,
        status: "planned"
      }));
    } else if (primary.error) {
      throw new Error(primary.error.message);
    } else {
      sessionsData = (primary.data ?? []) as Session[];
    }
  }

  return <PlanEditor plans={plans} weeks={(weeksData ?? []) as TrainingWeek[]} sessions={sessionsData} selectedPlanId={selectedPlan?.id} />;
}
