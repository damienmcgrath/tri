import { createClient } from "@/lib/supabase/server";
import { PlanEditor } from "./plan-editor";

type Plan = {
  id: string;
  name: string;
  start_date: string;
  duration_weeks: number;
};

type TrainingBlock = {
  id: string;
  plan_id: string | null;
  season_id: string | null;
  name: string;
  block_type: "Base" | "Build" | "Peak" | "Taper" | "Race" | "Recovery" | "Transition";
  start_date: string;
  end_date: string;
  sort_order: number;
  target_race_id: string | null;
  notes: string | null;
};

type TrainingWeek = {
  id: string;
  plan_id: string;
  block_id: string | null;
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
  session_name?: string | null;
  discipline?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  target: string | null;
  intent_category?: string | null;
  session_role?: "key" | "supporting" | "recovery" | "optional" | "Key" | "Supporting" | "Recovery" | "Optional" | null;
  source_metadata?: { uploadId?: string | null; assignmentId?: string | null; assignedBy?: "planner" | "upload" | "coach" | null } | null;
  execution_result?: { status?: "matched_intent" | "partial_intent" | "missed_intent" | null; summary?: string | null } | null;
  duration_minutes: number;
  day_order: number | null;
  notes: string | null;
  distance_value: number | null;
  distance_unit: string | null;
  status: "planned" | "completed" | "skipped";
  is_key?: boolean | null;
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
  if (!error) return false;
  if (error.code === "PGRST205") return true;
  return (error.message ?? "").toLowerCase().includes(`could not find the table '${tableName.toLowerCase()}' in the schema cache`);
}

export default async function PlanPage({ searchParams }: { searchParams?: { plan?: string; week?: string; block?: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: plansData, error: plansError } = await supabase
    .from("training_plans")
    .select("id,name,start_date,duration_weeks")
    .order("start_date", { ascending: false });

  if (plansError) throw new Error(plansError.message);

  const plans = (plansData ?? []) as Plan[];
  const selectedPlan = plans.find((plan) => plan.id === searchParams?.plan) ?? plans[0];

  if (selectedPlan) {
    await supabase.from("profiles").upsert({ id: user.id, active_plan_id: selectedPlan.id }, { onConflict: "id" });
  }

  let blocksData: TrainingBlock[] = [];
  if (selectedPlan) {
    const { data: blockRows, error: blocksError } = await supabase
      .from("training_blocks")
      .select("id,plan_id,season_id,name,block_type,start_date,end_date,sort_order,target_race_id,notes")
      .eq("plan_id", selectedPlan.id)
      .order("sort_order", { ascending: true });

    if (blocksError && !isMissingTableError(blocksError, "public.training_blocks")) {
      throw new Error(blocksError.message);
    }
    blocksData = (blockRows ?? []) as TrainingBlock[];
  }

  const { data: initialWeeksData, error: weeksError } = selectedPlan
    ? await supabase
        .from("training_weeks")
        .select("id,plan_id,block_id,week_index,week_start_date,focus,notes,target_minutes,target_tss")
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

    if (seedWeeksError) throw new Error(seedWeeksError.message);

    const { data: seededWeeksData, error: seededWeeksFetchError } = await supabase
      .from("training_weeks")
      .select("id,plan_id,block_id,week_index,week_start_date,focus,notes,target_minutes,target_tss")
      .eq("plan_id", selectedPlan.id)
      .order("week_index", { ascending: true });

    if (seededWeeksFetchError) throw new Error(seededWeeksFetchError.message);
    weeksData = (seededWeeksData ?? []) as TrainingWeek[];
  }

  let sessionsData: Session[] = [];

  if (selectedPlan) {
    const primaryQuery = await supabase
      .from("sessions")
      .select("id,plan_id,week_id,date,sport,type,session_name,discipline,subtype,workout_type,target,duration_minutes,intent_category,session_role,source_metadata,execution_result,day_order,notes,distance_value,distance_unit,status,is_key")
      .eq("plan_id", selectedPlan.id)
      .order("date", { ascending: true })
      .order("day_order", { ascending: true, nullsFirst: false });

    let primaryData: unknown[] | null = primaryQuery.data as unknown[] | null;
    let primaryError = primaryQuery.error;

    if (primaryError && !isMissingTableError(primaryError, "public.sessions")) {
      const fallbackQuery = await supabase
        .from("sessions")
        .select("id,plan_id,week_id,date,sport,type,duration_minutes,notes,distance_value,distance_unit,status")
        .eq("plan_id", selectedPlan.id)
        .order("date", { ascending: true });

      primaryData = fallbackQuery.data as unknown[] | null;
      primaryError = fallbackQuery.error;
    }

    if (primaryError && isMissingTableError(primaryError, "public.sessions")) {
      const legacy = await supabase
        .from("planned_sessions")
        .select("id,plan_id,date,sport,type,duration,notes")
        .eq("plan_id", selectedPlan.id)
        .order("date", { ascending: true });

      if (legacy.error && !isMissingTableError(legacy.error, "public.planned_sessions")) {
        throw new Error(legacy.error.message);
      }

      sessionsData = ((legacy.data ?? []) as Array<{ id: string; plan_id: string; date: string; sport: string; type: string; duration: number; notes: string | null }>).map((session) => ({
        id: session.id,
        plan_id: session.plan_id,
        week_id: "",
        date: session.date,
        sport: session.sport,
        type: session.type,
        duration_minutes: session.duration,
        session_name: null,
        discipline: session.sport,
        subtype: null,
        workout_type: null,
        target: null,
        intent_category: null,
        session_role: null,
        source_metadata: null,
        execution_result: null,
        day_order: null,
        notes: session.notes,
        distance_value: null,
        distance_unit: null,
        status: "planned",
        is_key: false
      }));
    } else if (primaryError) {
      throw new Error(primaryError.message);
    } else {
      sessionsData = (primaryData ?? []) as Session[];
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const explicitBlock = searchParams?.block
    ? blocksData.find((block) => block.id === searchParams.block)
    : undefined;
  const currentBlock = blocksData.find(
    (block) => block.start_date <= todayIso && todayIso <= block.end_date
  );
  const selectedBlock = explicitBlock ?? currentBlock ?? blocksData[0] ?? null;

  return (
    <section className="plan-editor-motion-lock">
      <PlanEditor
        plans={plans}
        blocks={blocksData}
        weeks={weeksData}
        sessions={sessionsData}
        selectedPlanId={selectedPlan?.id}
        selectedBlockId={selectedBlock?.id}
        initialWeekId={searchParams?.week}
      />
    </section>
  );
}
