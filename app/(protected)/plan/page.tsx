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
  target: string | null;
  duration_minutes: number;
  day_order: number | null;
  notes: string | null;
  distance_value: number | null;
  distance_unit: string | null;
  status: "planned" | "completed" | "skipped";
};

function buildPlanWeeks(startDateIso: string, durationWeeks: number, planId: string) {
  const startDate = new Date(`${startDateIso}T00:00:00.000Z`);
  return Array.from({ length: Math.max(durationWeeks, 1) }).map((_, index) => {
    const weekStart = new Date(startDate);
    weekStart.setUTCDate(startDate.getUTCDate() + index * 7);
    return {
      plan_id: planId,
      week_index: index + 1,
      week_start_date: weekStart.toISOString().slice(0, 10),
      focus: "Build" as const
    };
  });
}


function isMissingTableError(error: { code?: string; message?: string } | null, tableName: string) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes(`could not find the table '${tableName.toLowerCase()}' in the schema cache`);
}

function isMissingColumnError(error: { code?: string; message?: string } | null, columnName: string) {
  if (!error) {
    return false;
  }

  if (error.code === "42703") {
    return true;
  }

  return (error.message ?? "").toLowerCase().includes(columnName.toLowerCase());
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

  const { data: initialWeeksData, error: weeksError } = selectedPlan
    ? await supabase
        .from("training_weeks")
        .select("id,plan_id,week_index,week_start_date,focus,notes,target_minutes,target_tss")
        .eq("plan_id", selectedPlan.id)
        .order("week_index", { ascending: true })
    : { data: [] as TrainingWeek[], error: null };

  if (weeksError && !isMissingTableError(weeksError, "public.training_weeks")) {
    throw new Error(weeksError.message);
  }

  let weeksData = (initialWeeksData ?? []) as TrainingWeek[];

  if (selectedPlan && !weeksError && weeksData.length === 0) {
    const seedPayload = buildPlanWeeks(selectedPlan.start_date, selectedPlan.duration_weeks, selectedPlan.id);
    const { error: seedWeeksError } = await supabase.from("training_weeks").upsert(seedPayload, {
      onConflict: "plan_id,week_index",
      ignoreDuplicates: true
    });

    if (seedWeeksError) {
      throw new Error(seedWeeksError.message);
    }

    const { data: seededWeeksData, error: seededWeeksFetchError } = await supabase
      .from("training_weeks")
      .select("id,plan_id,week_index,week_start_date,focus,notes,target_minutes,target_tss")
      .eq("plan_id", selectedPlan.id)
      .order("week_index", { ascending: true });

    if (seededWeeksFetchError) {
      throw new Error(seededWeeksFetchError.message);
    }

    weeksData = (seededWeeksData ?? []) as TrainingWeek[];
  }

  let sessionsData: Session[] = [];
  if (selectedPlan) {
    let primary = await supabase
      .from("sessions")
      .select("id,plan_id,week_id,date,sport,type,target,duration_minutes,day_order,notes,distance_value,distance_unit,status")
      .eq("plan_id", selectedPlan.id)
      .order("date", { ascending: true })
      .order("day_order", { ascending: true, nullsFirst: false });

    if (primary.error && (isMissingColumnError(primary.error, "target") || isMissingColumnError(primary.error, "day_order"))) {
      primary = await supabase
        .from("sessions")
        .select("id,plan_id,week_id,date,sport,type,duration_minutes,notes,distance_value,distance_unit,status")
        .eq("plan_id", selectedPlan.id)
        .order("date", { ascending: true });
    }

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
        target: null,
        day_order: null,
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

  return <PlanEditor plans={plans} weeks={weeksData} sessions={sessionsData} selectedPlanId={selectedPlan?.id} />;
}
