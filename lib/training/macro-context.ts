import type { SupabaseClient } from "@supabase/supabase-js";
import { getBlockForDate } from "./race-profile";

export type MacroContext = {
  raceName: string | null;
  raceDate: string | null;
  daysToRace: number | null;
  currentBlock: string;
  blockWeek: number;
  blockTotalWeeks: number;
  totalPlanWeeks: number;
  currentPlanWeek: number;
  cumulativeVolumeByDiscipline: {
    swim: { plannedMinutes: number; actualMinutes: number; deltaPct: number };
    bike: { plannedMinutes: number; actualMinutes: number; deltaPct: number };
    run: { plannedMinutes: number; actualMinutes: number; deltaPct: number };
  };
  // Phase 3: formal training block context
  trainingBlockId: string | null;
  trainingBlockType: string | null;
  targetRaceId: string | null;
  seasonId: string | null;
};

function getTodayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const target = new Date(`${dateIso}T00:00:00.000Z`);
  const today = new Date(`${getTodayUtc()}T00:00:00.000Z`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

function getCurrentPlanWeek(startDate: string, todayIso: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  return Math.max(1, Math.floor(diffDays / 7) + 1);
}

/**
 * Groups consecutive training_weeks with the same focus value into blocks.
 * Returns block position for the current week.
 */
function deriveBlockPosition(weeks: Array<{ week_index: number; focus: string }>, currentWeekIndex: number): { blockWeek: number; blockTotalWeeks: number; currentBlock: string } {
  if (weeks.length === 0) {
    return { blockWeek: 1, blockTotalWeeks: 1, currentBlock: "Build" };
  }

  const sorted = [...weeks].sort((a, b) => a.week_index - b.week_index);
  const currentWeek = sorted.find((w) => w.week_index === currentWeekIndex) ?? sorted[sorted.length - 1];
  const currentFocus = currentWeek?.focus ?? "Build";

  // Find the contiguous run of weeks with the same focus that contains the current week
  let blockStart = currentWeekIndex;
  let blockEnd = currentWeekIndex;

  for (let i = currentWeekIndex - 1; i >= 1; i--) {
    const week = sorted.find((w) => w.week_index === i);
    if (week?.focus === currentFocus) {
      blockStart = i;
    } else {
      break;
    }
  }

  const maxWeekIndex = sorted[sorted.length - 1]?.week_index ?? currentWeekIndex;
  for (let i = currentWeekIndex + 1; i <= maxWeekIndex; i++) {
    const week = sorted.find((w) => w.week_index === i);
    if (week?.focus === currentFocus) {
      blockEnd = i;
    } else {
      break;
    }
  }

  return {
    currentBlock: currentFocus,
    blockWeek: currentWeekIndex - blockStart + 1,
    blockTotalWeeks: blockEnd - blockStart + 1
  };
}

type FkBlockPosition = {
  id: string;
  blockType: string;
  targetRaceId: string | null;
  seasonId: string | null;
  blockWeek: number;
  blockTotalWeeks: number;
};

async function getBlockPositionViaFk(
  supabase: SupabaseClient,
  planId: string,
  currentPlanWeek: number
): Promise<FkBlockPosition | null> {
  const { data: weeks } = await supabase
    .from("training_weeks")
    .select("week_index,block_id")
    .eq("plan_id", planId)
    .not("block_id", "is", null)
    .order("week_index", { ascending: true });

  const rows = (weeks ?? []) as Array<{ week_index: number; block_id: string | null }>;
  if (rows.length === 0) return null;

  const currentRow = rows.find((w) => w.week_index === currentPlanWeek) ?? rows[rows.length - 1];
  const blockId = currentRow?.block_id;
  if (!blockId) return null;

  const peers = rows.filter((w) => w.block_id === blockId).sort((a, b) => a.week_index - b.week_index);
  const blockWeek = Math.max(1, peers.findIndex((w) => w.week_index === currentRow.week_index) + 1);
  const blockTotalWeeks = peers.length;

  const { data: block } = await supabase
    .from("training_blocks")
    .select("id,block_type,target_race_id,season_id")
    .eq("id", blockId)
    .maybeSingle();

  if (!block) return null;

  return {
    id: block.id as string,
    blockType: block.block_type as string,
    targetRaceId: (block.target_race_id as string | null) ?? null,
    seasonId: (block.season_id as string | null) ?? null,
    blockWeek,
    blockTotalWeeks,
  };
}

export async function getMacroContext(supabase: SupabaseClient, athleteId: string): Promise<MacroContext> {
  const todayIso = getTodayUtc();

  // Fetch profile and active plan in parallel
  const [{ data: profile }, { data: activePlan }] = await Promise.all([
    supabase.from("profiles").select("race_name,race_date,active_plan_id").eq("id", athleteId).maybeSingle(),
    supabase
      .from("training_plans")
      .select("id,start_date,duration_weeks")
      .eq("user_id", athleteId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const planId = profile?.active_plan_id ?? activePlan?.id ?? null;
  const raceName = profile?.race_name ?? null;
  const raceDate = profile?.race_date ?? null;
  const daysToRace = daysUntil(raceDate);
  const totalPlanWeeks = activePlan?.duration_weeks ?? 12;
  const currentPlanWeek = activePlan?.start_date ? getCurrentPlanWeek(activePlan.start_date, todayIso) : 1;

  // Prefer FK path (training_weeks.block_id → training_blocks). Fall back to
  // date-range lookup for legacy plans where weeks aren't yet linked.
  const fkBlock = planId ? await getBlockPositionViaFk(supabase, planId, currentPlanWeek).catch(() => null) : null;
  const formalBlock = fkBlock ? null : await getBlockForDate(supabase, athleteId, todayIso).catch(() => null);

  if (!planId) {
    return {
      raceName,
      raceDate,
      daysToRace,
      currentBlock: formalBlock?.blockType ?? "Build",
      blockWeek: formalBlock ? weekInBlock(formalBlock.startDate, todayIso) : 1,
      blockTotalWeeks: formalBlock ? totalBlockWeeks(formalBlock.startDate, formalBlock.endDate) : 1,
      totalPlanWeeks,
      currentPlanWeek,
      cumulativeVolumeByDiscipline: {
        swim: { plannedMinutes: 0, actualMinutes: 0, deltaPct: 0 },
        bike: { plannedMinutes: 0, actualMinutes: 0, deltaPct: 0 },
        run: { plannedMinutes: 0, actualMinutes: 0, deltaPct: 0 }
      },
      trainingBlockId: formalBlock?.id ?? null,
      trainingBlockType: formalBlock?.blockType ?? null,
      targetRaceId: formalBlock?.targetRaceId ?? null,
      seasonId: formalBlock?.seasonId ?? null,
    };
  }

  // Fetch training weeks and all sessions up to today in parallel
  const [{ data: trainingWeeks }, { data: allSessions }] = await Promise.all([
    supabase.from("training_weeks").select("week_index,focus").eq("plan_id", planId).order("week_index", { ascending: true }),
    supabase
      .from("sessions")
      .select("sport,duration_minutes,status,date")
      .eq("user_id", athleteId)
      .eq("plan_id", planId)
      .lte("date", todayIso)
  ]);

  const weeks = (trainingWeeks ?? []) as Array<{ week_index: number; focus: string }>;
  const inferredBlockPosition = deriveBlockPosition(weeks, currentPlanWeek);

  // Compute cumulative volume by discipline from plan start to today
  const sessions = allSessions ?? [];
  const disciplines = ["swim", "bike", "run"] as const;

  const cumulativeVolumeByDiscipline = Object.fromEntries(
    disciplines.map((sport) => {
      const sportSessions = sessions.filter((s) => s.sport === sport);
      const plannedMinutes = sportSessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
      const actualMinutes = sportSessions
        .filter((s) => s.status === "completed")
        .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
      const deltaPct = plannedMinutes > 0 ? Math.round(((actualMinutes - plannedMinutes) / plannedMinutes) * 100) : 0;

      return [sport, { plannedMinutes, actualMinutes, deltaPct }];
    })
  ) as MacroContext["cumulativeVolumeByDiscipline"];

  // FK > date-range fallback > focus-inference fallback
  const currentBlock = fkBlock?.blockType ?? formalBlock?.blockType ?? inferredBlockPosition.currentBlock;
  const blockWeek = fkBlock?.blockWeek
    ?? (formalBlock ? weekInBlock(formalBlock.startDate, todayIso) : inferredBlockPosition.blockWeek);
  const blockTotalWeeks = fkBlock?.blockTotalWeeks
    ?? (formalBlock ? totalBlockWeeks(formalBlock.startDate, formalBlock.endDate) : inferredBlockPosition.blockTotalWeeks);

  return {
    raceName,
    raceDate,
    daysToRace,
    currentBlock,
    blockWeek,
    blockTotalWeeks,
    totalPlanWeeks,
    currentPlanWeek,
    cumulativeVolumeByDiscipline,
    trainingBlockId: fkBlock?.id ?? formalBlock?.id ?? null,
    trainingBlockType: fkBlock?.blockType ?? formalBlock?.blockType ?? null,
    targetRaceId: fkBlock?.targetRaceId ?? formalBlock?.targetRaceId ?? null,
    seasonId: fkBlock?.seasonId ?? formalBlock?.seasonId ?? null,
  };
}

function weekInBlock(blockStartIso: string, todayIso: string): number {
  const start = new Date(`${blockStartIso}T00:00:00.000Z`);
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / (7 * 86400000)) + 1);
}

function totalBlockWeeks(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  return Math.max(1, Math.ceil((end.getTime() - start.getTime() + 86400000) / (7 * 86400000)));
}

/** Formats macro context as a one-line string for use in AI prompts */
export function formatMacroContextSummary(ctx: MacroContext): string {
  const parts: string[] = [];

  if (ctx.raceName && ctx.daysToRace !== null) {
    parts.push(`${ctx.raceName} in ${ctx.daysToRace} days`);
  }

  parts.push(`${ctx.currentBlock} phase, week ${ctx.blockWeek} of ${ctx.blockTotalWeeks} (plan week ${ctx.currentPlanWeek}/${ctx.totalPlanWeeks})`);

  const volumeParts: string[] = [];
  const { swim, bike, run } = ctx.cumulativeVolumeByDiscipline;

  if (swim.plannedMinutes > 0) {
    const label = swim.deltaPct >= -5 ? "on track" : `${Math.abs(swim.deltaPct)}% behind`;
    volumeParts.push(`swim ${label}`);
  }

  if (bike.plannedMinutes > 0) {
    const label = bike.deltaPct >= -5 ? "on track" : `${Math.abs(bike.deltaPct)}% behind`;
    volumeParts.push(`bike ${label}`);
  }

  if (run.plannedMinutes > 0) {
    const label = run.deltaPct >= -5 ? "on track" : `${Math.abs(run.deltaPct)}% behind`;
    volumeParts.push(`run ${label}`);
  }

  if (volumeParts.length > 0) {
    parts.push(`Cumulative volume: ${volumeParts.join(", ")}`);
  }

  return parts.join(". ");
}
