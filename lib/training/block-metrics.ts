import type { SupabaseClient } from "@supabase/supabase-js";

export type BlockMetrics = {
  blockId: string;
  name: string;
  blockType: string;
  startDate: string;
  endDate: string;
  sortOrder: number;
  weeks: number;
  plannedMinutes: number;
  completedMinutes: number;
  completionPct: number;
  plannedSessions: number;
  completedSessions: number;
  keySessionsPlanned: number;
  keySessionsCompleted: number;
  disciplineMix: {
    swim: { plannedMinutes: number; completedMinutes: number };
    bike: { plannedMinutes: number; completedMinutes: number };
    run: { plannedMinutes: number; completedMinutes: number };
    strength: { plannedMinutes: number; completedMinutes: number };
  };
};

export type BlockComparison = {
  current: BlockMetrics;
  prior: BlockMetrics | null;
  deltas: {
    plannedMinutes: number;
    completedMinutes: number;
    completionPct: number;
    keySessionsCompleted: number;
  } | null;
};

function emptyDisciplineMix(): BlockMetrics["disciplineMix"] {
  return {
    swim: { plannedMinutes: 0, completedMinutes: 0 },
    bike: { plannedMinutes: 0, completedMinutes: 0 },
    run: { plannedMinutes: 0, completedMinutes: 0 },
    strength: { plannedMinutes: 0, completedMinutes: 0 },
  };
}

type BlockRow = {
  id: string;
  name: string;
  block_type: string;
  start_date: string;
  end_date: string;
  sort_order: number;
  plan_id: string | null;
};

type WeekRow = { id: string; block_id: string | null };
type SessionRow = {
  id: string;
  sport: string | null;
  duration_minutes: number | null;
  status: string | null;
  is_key: boolean | null;
  session_role: string | null;
  week_id: string | null;
};

async function loadBlockRow(supabase: SupabaseClient, blockId: string): Promise<BlockRow | null> {
  const { data } = await supabase
    .from("training_blocks")
    .select("id,name,block_type,start_date,end_date,sort_order,plan_id")
    .eq("id", blockId)
    .maybeSingle();
  return (data as BlockRow | null) ?? null;
}

async function aggregateForBlock(supabase: SupabaseClient, block: BlockRow): Promise<BlockMetrics> {
  const { data: weekRows } = await supabase
    .from("training_weeks")
    .select("id,block_id")
    .eq("block_id", block.id);

  const weeks = (weekRows ?? []) as WeekRow[];
  const weekIds = weeks.map((w) => w.id);

  let sessions: SessionRow[] = [];
  if (weekIds.length > 0) {
    const { data: sessionRows } = await supabase
      .from("sessions")
      .select("id,sport,duration_minutes,status,is_key,session_role,week_id")
      .in("week_id", weekIds);
    sessions = (sessionRows ?? []) as SessionRow[];
  }

  const disciplineMix = emptyDisciplineMix();
  let plannedMinutes = 0;
  let completedMinutes = 0;
  let completedSessions = 0;
  let keySessionsPlanned = 0;
  let keySessionsCompleted = 0;

  for (const s of sessions) {
    const dur = s.duration_minutes ?? 0;
    plannedMinutes += dur;
    const done = s.status === "completed";
    if (done) {
      completedMinutes += dur;
      completedSessions += 1;
    }
    const sport = s.sport as keyof BlockMetrics["disciplineMix"] | null;
    if (sport && sport in disciplineMix) {
      disciplineMix[sport].plannedMinutes += dur;
      if (done) disciplineMix[sport].completedMinutes += dur;
    }
    const isKey = s.is_key === true || (s.session_role ?? "").toLowerCase() === "key";
    if (isKey) {
      keySessionsPlanned += 1;
      if (done) keySessionsCompleted += 1;
    }
  }

  const completionPct = plannedMinutes > 0 ? Math.round((completedMinutes / plannedMinutes) * 100) : 0;

  return {
    blockId: block.id,
    name: block.name,
    blockType: block.block_type,
    startDate: block.start_date,
    endDate: block.end_date,
    sortOrder: block.sort_order,
    weeks: weeks.length,
    plannedMinutes,
    completedMinutes,
    completionPct,
    plannedSessions: sessions.length,
    completedSessions,
    keySessionsPlanned,
    keySessionsCompleted,
    disciplineMix,
  };
}

export async function getBlockMetrics(supabase: SupabaseClient, blockId: string): Promise<BlockMetrics | null> {
  const block = await loadBlockRow(supabase, blockId);
  if (!block) return null;
  return aggregateForBlock(supabase, block);
}

async function findPriorBlock(supabase: SupabaseClient, block: BlockRow): Promise<BlockRow | null> {
  if (!block.plan_id) return null;
  const { data } = await supabase
    .from("training_blocks")
    .select("id,name,block_type,start_date,end_date,sort_order,plan_id")
    .eq("plan_id", block.plan_id)
    .lt("sort_order", block.sort_order)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as BlockRow | null) ?? null;
}

export async function getBlockComparison(supabase: SupabaseClient, blockId: string): Promise<BlockComparison | null> {
  const block = await loadBlockRow(supabase, blockId);
  if (!block) return null;
  const current = await aggregateForBlock(supabase, block);

  const priorRow = await findPriorBlock(supabase, block);
  const prior = priorRow ? await aggregateForBlock(supabase, priorRow) : null;

  const deltas = prior
    ? {
        plannedMinutes: current.plannedMinutes - prior.plannedMinutes,
        completedMinutes: current.completedMinutes - prior.completedMinutes,
        completionPct: current.completionPct - prior.completionPct,
        keySessionsCompleted: current.keySessionsCompleted - prior.keySessionsCompleted,
      }
    : null;

  return { current, prior, deltas };
}
