import type { SupabaseClient } from "@supabase/supabase-js";
import { computeAerobicDecoupling } from "@/lib/analytics/session-signals";
import { getNestedNumber } from "@/lib/workouts/metrics-v2";
import {
  progressReportFactsSchema,
  type ProgressReportFacts,
  type ProgressReportFitnessPoint,
  type ProgressReportPaceAtHr,
  type ProgressReportPeak,
  type ProgressReportVolumeBlock,
  type ProgressReportDirection
} from "./types";

// ---------------------------------------------------------------------------
// Block boundaries
// ---------------------------------------------------------------------------

/** Block is 28 days inclusive, ending on `blockEnd`. */
export function computeBlockBoundaries(blockEnd: string): {
  blockStart: string;
  blockEnd: string;
  priorBlockStart: string;
  priorBlockEnd: string;
} {
  const endMs = new Date(`${blockEnd}T00:00:00.000Z`).getTime();
  const blockStartMs = endMs - 27 * 86400000;
  const priorEndMs = blockStartMs - 86400000;
  const priorStartMs = priorEndMs - 27 * 86400000;
  return {
    blockStart: new Date(blockStartMs).toISOString().slice(0, 10),
    blockEnd,
    priorBlockStart: new Date(priorStartMs).toISOString().slice(0, 10),
    priorBlockEnd: new Date(priorEndMs).toISOString().slice(0, 10)
  };
}

// ---------------------------------------------------------------------------
// Row shapes (subset of DB columns we need)
// ---------------------------------------------------------------------------

type ActivityRow = {
  id: string;
  user_id: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  moving_duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec: number | null;
  metrics_v2: Record<string, unknown> | null;
};

type FitnessRow = {
  date: string;
  sport: string;
  ctl: number;
  atl: number;
  tsb: number;
  ramp_rate: number | null;
};

type SessionRow = {
  id: string;
  date: string;
  sport: string | null;
  duration_minutes: number | null;
  status: string;
  is_key: boolean | null;
  session_role: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function effectiveDurationSec(row: ActivityRow): number | null {
  return row.moving_duration_sec ?? row.duration_sec;
}

function isEnduranceSport(sport: string): sport is "run" | "bike" | "swim" {
  return sport === "run" || sport === "bike" || sport === "swim";
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function formatBlockRange(start: string, end: string): string {
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

function formatPaceMinSec(secPerUnit: number, unit: string): string {
  const rounded = Math.round(secPerUnit);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}${unit}`;
}

function extractHalves(row: ActivityRow) {
  const metrics = row.metrics_v2 ?? {};
  const splits = (metrics as Record<string, unknown>).splits as
    | Record<string, unknown>
    | null
    | undefined;
  const halves = (metrics as Record<string, unknown>).halves as
    | Record<string, unknown>
    | null
    | undefined;
  const sources = [splits, halves, metrics];

  return {
    firstHalfAvgHr: getNestedNumber(sources, [
      ["firstHalfAvgHr"],
      ["first_half_avg_hr"],
      ["firstHalf", "avgHr"],
      ["first_half", "avg_hr"]
    ]),
    lastHalfAvgHr: getNestedNumber(sources, [
      ["lastHalfAvgHr"],
      ["last_half_avg_hr"],
      ["lastHalf", "avgHr"],
      ["last_half", "avg_hr"]
    ]),
    firstHalfAvgPower: getNestedNumber(sources, [
      ["firstHalfAvgPower"],
      ["first_half_avg_power"],
      ["firstHalf", "avgPower"],
      ["first_half", "avg_power"]
    ]),
    lastHalfAvgPower: getNestedNumber(sources, [
      ["lastHalfAvgPower"],
      ["last_half_avg_power"],
      ["lastHalf", "avgPower"],
      ["last_half", "avg_power"]
    ]),
    firstHalfPaceSPerKm: getNestedNumber(sources, [
      ["firstHalfPaceSPerKm"],
      ["first_half_pace_s_per_km"],
      ["firstHalf", "avgPaceSecPerKm"],
      ["first_half", "avg_pace_sec_per_km"]
    ]),
    lastHalfPaceSPerKm: getNestedNumber(sources, [
      ["lastHalfPaceSPerKm"],
      ["last_half_pace_s_per_km"],
      ["lastHalf", "avgPaceSecPerKm"],
      ["last_half", "avg_pace_sec_per_km"]
    ])
  };
}

function bikeNormalizedPower(row: ActivityRow): number | null {
  return (
    getNestedNumber(row.metrics_v2, [
      ["power", "normalizedPower"],
      ["power", "normalized_power"]
    ]) ?? row.avg_power
  );
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

function buildVolumeBlock(
  activities: ActivityRow[],
  sessions: SessionRow[]
): ProgressReportVolumeBlock {
  const perSport = { run: 0, bike: 0, swim: 0, strength: 0, other: 0 };
  let totalMinutes = 0;
  for (const a of activities) {
    const mins = Math.round((effectiveDurationSec(a) ?? 0) / 60);
    totalMinutes += mins;
    const key = (a.sport_type === "cycling" ? "bike" : a.sport_type) as
      | keyof typeof perSport
      | string;
    if (key in perSport) {
      perSport[key as keyof typeof perSport] += mins;
    } else {
      perSport.other += mins;
    }
  }

  const plannedKey = sessions.filter((s) => s.is_key || s.session_role === "key");
  const completedSessions = sessions.filter((s) => s.status === "completed").length;
  const completedKey = plannedKey.filter((s) => s.status === "completed").length;
  const plannedCount = sessions.length;
  const completionPct =
    plannedCount > 0 ? Math.round((completedSessions / plannedCount) * 100) : 0;

  return {
    totalMinutes,
    totalSessions: activities.length,
    keySessionsCompleted: completedKey,
    keySessionsPlanned: plannedKey.length,
    completionPct,
    perSport
  };
}

function classifyFitnessDirection(
  delta: number,
  priorEnd: number | null
): ProgressReportDirection {
  if (priorEnd === null || !Number.isFinite(priorEnd)) return "insufficient";
  if (Math.abs(delta) < 1) return "stable";
  return delta > 0 ? "improving" : "declining";
}

function buildFitnessTrajectory(
  blockStart: string,
  blockEnd: string,
  priorBlockEnd: string,
  rows: FitnessRow[]
): ProgressReportFitnessPoint[] {
  const bySport = new Map<string, FitnessRow[]>();
  for (const row of rows) {
    if (!bySport.has(row.sport)) bySport.set(row.sport, []);
    bySport.get(row.sport)!.push(row);
  }

  const sports = ["run", "bike", "swim", "total"] as const;
  const points: ProgressReportFitnessPoint[] = [];

  for (const sport of sports) {
    const list = (bySport.get(sport) ?? [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    if (list.length === 0) continue;

    // Require actual current-block coverage. Otherwise we'd emit prior-block
    // CTL values as the "current" block, producing a bogus trajectory.
    const endRow = [...list]
      .reverse()
      .find((r) => r.date >= blockStart && r.date <= blockEnd);
    if (!endRow) continue;

    // Prefer the CTL from the day before the block (true start-of-block
    // value), falling back to the earliest in-block row if the athlete's
    // fitness history starts mid-block.
    const startRow =
      [...list].reverse().find((r) => r.date < blockStart) ??
      list.find((r) => r.date >= blockStart && r.date <= blockEnd)!;

    const priorEndRow = [...list]
      .reverse()
      .find((r) => r.date <= priorBlockEnd) ?? null;

    const currentCtlStart = round1(Number(startRow.ctl) || 0);
    const currentCtlEnd = round1(Number(endRow.ctl) || 0);
    const priorCtlEnd = priorEndRow ? round1(Number(priorEndRow.ctl) || 0) : null;
    const currentCtlDelta = round1(currentCtlEnd - currentCtlStart);
    const deltaVsPrior = priorCtlEnd !== null ? round1(currentCtlEnd - priorCtlEnd) : null;

    points.push({
      sport,
      currentCtlStart,
      currentCtlEnd,
      currentCtlDelta,
      priorCtlEnd,
      deltaVsPrior,
      rampRate: endRow.ramp_rate !== null ? round1(Number(endRow.ramp_rate) || 0) : null,
      direction: classifyFitnessDirection(deltaVsPrior ?? currentCtlDelta, priorCtlEnd)
    });
  }

  return points;
}

function buildPaceAtHr(
  sport: "run" | "bike" | "swim",
  currentActivities: ActivityRow[],
  priorActivities: ActivityRow[]
): ProgressReportPaceAtHr | null {
  const filterSport = (rows: ActivityRow[]) =>
    rows.filter((r) => (r.sport_type === "cycling" ? "bike" : r.sport_type) === sport);
  const current = filterSport(currentActivities);
  const prior = filterSport(priorActivities);
  if (current.length === 0 && prior.length === 0) return null;

  const aggregate = (rows: ActivityRow[]) => {
    const withHr = rows.filter((r) => r.avg_hr != null);
    const avgHr =
      withHr.length > 0
        ? Math.round(withHr.reduce((s, r) => s + (r.avg_hr ?? 0), 0) / withHr.length)
        : null;

    let avgPaceSecPerKm: number | null = null;
    let avgPacePer100mSec: number | null = null;
    let avgPower: number | null = null;

    if (sport === "run") {
      const qualifying = rows.filter(
        (r) => (r.distance_m ?? 0) > 0 && effectiveDurationSec(r) != null
      );
      if (qualifying.length > 0) {
        const totalDist = qualifying.reduce((s, r) => s + (r.distance_m ?? 0), 0);
        const totalDur = qualifying.reduce(
          (s, r) => s + (effectiveDurationSec(r) ?? 0),
          0
        );
        if (totalDist > 0) avgPaceSecPerKm = Math.round((totalDur / totalDist) * 1000);
      }
    } else if (sport === "bike") {
      const withPower = rows
        .map(bikeNormalizedPower)
        .filter((p): p is number => p != null && p > 0);
      if (withPower.length > 0) {
        avgPower = Math.round(withPower.reduce((s, p) => s + p, 0) / withPower.length);
      }
    } else if (sport === "swim") {
      const withPace = rows.filter((r) => r.avg_pace_per_100m_sec != null);
      if (withPace.length > 0) {
        avgPacePer100mSec = Math.round(
          withPace.reduce((s, r) => s + (r.avg_pace_per_100m_sec ?? 0), 0) / withPace.length
        );
      }
    }

    return {
      avgHr,
      avgPaceSecPerKm,
      avgPacePer100mSec,
      avgPower,
      sessionCount: rows.length
    };
  };

  const cur = aggregate(current);
  const pri = aggregate(prior);

  const direction = inferPaceAtHrDirection(sport, cur, pri);
  const summary = summarizePaceAtHr(sport, cur, pri, direction);

  return {
    sport,
    current: cur,
    prior: pri,
    direction,
    summary
  };
}

function inferPaceAtHrDirection(
  sport: "run" | "bike" | "swim",
  current: ProgressReportPaceAtHr["current"],
  prior: ProgressReportPaceAtHr["prior"]
): ProgressReportDirection {
  if (current.sessionCount < 2 || prior.sessionCount < 2) return "insufficient";
  if (current.avgHr === null || prior.avgHr === null) return "insufficient";

  if (sport === "run") {
    if (current.avgPaceSecPerKm === null || prior.avgPaceSecPerKm === null) {
      return "insufficient";
    }
    const paceDelta = prior.avgPaceSecPerKm - current.avgPaceSecPerKm; // +ve = faster
    const hrDelta = current.avgHr - prior.avgHr; // +ve = higher HR
    if (Math.abs(paceDelta) < 4 && Math.abs(hrDelta) < 2) return "stable";
    if (paceDelta > 0 && hrDelta <= 2) return "improving";
    if (paceDelta < 0 && hrDelta >= -2) return "declining";
    return "stable";
  }

  if (sport === "bike") {
    if (current.avgPower === null || prior.avgPower === null) return "insufficient";
    const powerDelta = current.avgPower - prior.avgPower; // +ve = more power
    const hrDelta = current.avgHr - prior.avgHr;
    if (Math.abs(powerDelta) < 3 && Math.abs(hrDelta) < 2) return "stable";
    if (powerDelta > 0 && hrDelta <= 2) return "improving";
    if (powerDelta < 0 && hrDelta >= -2) return "declining";
    return "stable";
  }

  // swim
  if (current.avgPacePer100mSec === null || prior.avgPacePer100mSec === null) {
    return "insufficient";
  }
  const paceDelta = prior.avgPacePer100mSec - current.avgPacePer100mSec;
  const hrDelta = current.avgHr - prior.avgHr;
  if (Math.abs(paceDelta) < 2 && Math.abs(hrDelta) < 2) return "stable";
  if (paceDelta > 0 && hrDelta <= 2) return "improving";
  if (paceDelta < 0 && hrDelta >= -2) return "declining";
  return "stable";
}

function summarizePaceAtHr(
  sport: "run" | "bike" | "swim",
  current: ProgressReportPaceAtHr["current"],
  prior: ProgressReportPaceAtHr["prior"],
  direction: ProgressReportDirection
): string {
  if (direction === "insufficient") {
    return `Not enough ${sport} sessions with HR across both blocks to read a pace-at-HR trend.`;
  }
  if (sport === "run") {
    const curPace = current.avgPaceSecPerKm ? formatPaceMinSec(current.avgPaceSecPerKm, "/km") : "n/a";
    const prePace = prior.avgPaceSecPerKm ? formatPaceMinSec(prior.avgPaceSecPerKm, "/km") : "n/a";
    return `Run pace-at-HR: ${curPace} @ ${current.avgHr ?? "?"}bpm (prev ${prePace} @ ${prior.avgHr ?? "?"}bpm) — ${direction}.`;
  }
  if (sport === "bike") {
    return `Bike power-at-HR: ${current.avgPower ?? "?"}W @ ${current.avgHr ?? "?"}bpm (prev ${prior.avgPower ?? "?"}W @ ${prior.avgHr ?? "?"}bpm) — ${direction}.`;
  }
  const curPace = current.avgPacePer100mSec
    ? formatPaceMinSec(current.avgPacePer100mSec, "/100m")
    : "n/a";
  const prePace = prior.avgPacePer100mSec
    ? formatPaceMinSec(prior.avgPacePer100mSec, "/100m")
    : "n/a";
  return `Swim pace-at-HR: ${curPace} @ ${current.avgHr ?? "?"}bpm (prev ${prePace} @ ${prior.avgHr ?? "?"}bpm) — ${direction}.`;
}

function buildDurabilityBlock(activities: ActivityRow[]) {
  const endurance = activities.filter((a) => {
    const sport = a.sport_type === "cycling" ? "bike" : a.sport_type;
    if (!isEnduranceSport(sport)) return false;
    return (effectiveDurationSec(a) ?? 0) >= 45 * 60; // ≥45min endurance
  });

  let decouplingSum = 0;
  let decouplingSamples = 0;
  let poorDurabilityCount = 0;

  for (const a of endurance) {
    const sport = a.sport_type === "cycling" ? "bike" : a.sport_type;
    const halves = extractHalves(a);
    const decoupling = computeAerobicDecoupling({
      sport,
      firstHalfAvgHr: halves.firstHalfAvgHr,
      lastHalfAvgHr: halves.lastHalfAvgHr,
      firstHalfAvgPower: halves.firstHalfAvgPower,
      lastHalfAvgPower: halves.lastHalfAvgPower,
      firstHalfPaceSPerKm: halves.firstHalfPaceSPerKm,
      lastHalfPaceSPerKm: halves.lastHalfPaceSPerKm
    });
    if (!decoupling) continue;
    decouplingSum += decoupling.percent;
    decouplingSamples += 1;
    if (decoupling.severity === "poor_durability") poorDurabilityCount += 1;
  }

  return {
    enduranceSessions: endurance.length,
    decouplingSamples,
    avgDecouplingPct: decouplingSamples > 0 ? round1(decouplingSum / decouplingSamples) : null,
    poorDurabilityCount
  };
}

function inferDurabilityDirection(
  current: ReturnType<typeof buildDurabilityBlock>,
  prior: ReturnType<typeof buildDurabilityBlock>
): ProgressReportDirection {
  if (current.decouplingSamples < 2 || prior.decouplingSamples < 2) return "insufficient";
  if (current.avgDecouplingPct === null || prior.avgDecouplingPct === null) {
    return "insufficient";
  }
  const delta = current.avgDecouplingPct - prior.avgDecouplingPct;
  if (Math.abs(delta) < 1) return "stable";
  // Lower decoupling = better durability.
  return delta < 0 ? "improving" : "declining";
}

function buildPeakPerformances(
  currentActivities: ActivityRow[],
  priorActivities: ActivityRow[]
): ProgressReportPeak[] {
  const peaks: ProgressReportPeak[] = [];

  // Run — best sustained pace over ≥5km
  const runQualifying = (rows: ActivityRow[]) =>
    rows.filter(
      (r) => r.sport_type === "run" && (r.distance_m ?? 0) >= 5000 && effectiveDurationSec(r) != null
    );
  const runCurrent = runQualifying(currentActivities);
  const runPrior = runQualifying(priorActivities);
  const bestRunPace = (rows: ActivityRow[]) => {
    let best: ActivityRow | null = null;
    let bestVal = Infinity;
    for (const r of rows) {
      const pace = (effectiveDurationSec(r)! / r.distance_m!) * 1000;
      if (pace < bestVal) {
        bestVal = pace;
        best = r;
      }
    }
    return best ? { activity: best, value: bestVal } : null;
  };
  const curRun = bestRunPace(runCurrent);
  const priRun = bestRunPace(runPrior);
  if (curRun) {
    const delta = priRun ? priRun.value - curRun.value : null;
    peaks.push({
      sport: "run",
      label: "Best run pace",
      current: {
        value: round1(curRun.value),
        formatted: formatPaceMinSec(curRun.value, "/km"),
        activityId: curRun.activity.id,
        activityDate: curRun.activity.start_time_utc.slice(0, 10)
      },
      prior: {
        value: priRun ? round1(priRun.value) : null,
        formatted: priRun ? formatPaceMinSec(priRun.value, "/km") : null
      },
      delta: delta !== null ? round1(delta) : null,
      deltaLabel:
        delta !== null
          ? `${Math.abs(Math.round(delta))}s/km ${delta > 0 ? "faster" : delta < 0 ? "slower" : "equal"} vs prior block`
          : null
    });
  }

  // Bike — best normalized / avg power on ride ≥20min
  const bikeQualifying = (rows: ActivityRow[]) =>
    rows.filter((r) => {
      const sport = r.sport_type === "cycling" ? "bike" : r.sport_type;
      return sport === "bike" && (effectiveDurationSec(r) ?? 0) >= 1200;
    });
  const bikeCurrent = bikeQualifying(currentActivities);
  const bikePrior = bikeQualifying(priorActivities);
  const bestBikePower = (rows: ActivityRow[]) => {
    let best: ActivityRow | null = null;
    let bestVal = -Infinity;
    for (const r of rows) {
      const power = bikeNormalizedPower(r);
      if (power !== null && power > bestVal) {
        bestVal = power;
        best = r;
      }
    }
    return best && bestVal > 0 ? { activity: best, value: bestVal } : null;
  };
  const curBike = bestBikePower(bikeCurrent);
  const priBike = bestBikePower(bikePrior);
  if (curBike) {
    const delta = priBike ? curBike.value - priBike.value : null;
    peaks.push({
      sport: "bike",
      label: "Best bike power",
      current: {
        value: round1(curBike.value),
        formatted: `${Math.round(curBike.value)}W`,
        activityId: curBike.activity.id,
        activityDate: curBike.activity.start_time_utc.slice(0, 10)
      },
      prior: {
        value: priBike ? round1(priBike.value) : null,
        formatted: priBike ? `${Math.round(priBike.value)}W` : null
      },
      delta: delta !== null ? round1(delta) : null,
      deltaLabel:
        delta !== null
          ? `${Math.abs(Math.round(delta))}W ${delta > 0 ? "higher" : delta < 0 ? "lower" : "equal"} vs prior block`
          : null
    });
  }

  // Swim — best avg pace per 100m (≥400m)
  const swimQualifying = (rows: ActivityRow[]) =>
    rows.filter(
      (r) => r.sport_type === "swim" && (r.distance_m ?? 0) >= 400 && r.avg_pace_per_100m_sec != null
    );
  const swimCurrent = swimQualifying(currentActivities);
  const swimPrior = swimQualifying(priorActivities);
  const bestSwimPace = (rows: ActivityRow[]) => {
    let best: ActivityRow | null = null;
    let bestVal = Infinity;
    for (const r of rows) {
      const pace = r.avg_pace_per_100m_sec!;
      if (pace < bestVal) {
        bestVal = pace;
        best = r;
      }
    }
    return best ? { activity: best, value: bestVal } : null;
  };
  const curSwim = bestSwimPace(swimCurrent);
  const priSwim = bestSwimPace(swimPrior);
  if (curSwim) {
    const delta = priSwim ? priSwim.value - curSwim.value : null;
    peaks.push({
      sport: "swim",
      label: "Best swim pace",
      current: {
        value: round1(curSwim.value),
        formatted: formatPaceMinSec(curSwim.value, "/100m"),
        activityId: curSwim.activity.id,
        activityDate: curSwim.activity.start_time_utc.slice(0, 10)
      },
      prior: {
        value: priSwim ? round1(priSwim.value) : null,
        formatted: priSwim ? formatPaceMinSec(priSwim.value, "/100m") : null
      },
      delta: delta !== null ? round1(delta) : null,
      deltaLabel:
        delta !== null
          ? `${Math.abs(Math.round(delta))}s/100m ${delta > 0 ? "faster" : delta < 0 ? "slower" : "equal"} vs prior block`
          : null
    });
  }

  return peaks;
}

function buildFactualBullets(args: {
  volumeDeltaMinutes: number;
  volumeDeltaSessions: number;
  fitness: ProgressReportFitnessPoint[];
  paceAtHr: ProgressReportPaceAtHr[];
  peaks: ProgressReportPeak[];
}): string[] {
  const bullets: string[] = [];

  bullets.push(
    `Volume: ${args.volumeDeltaMinutes >= 0 ? "+" : ""}${args.volumeDeltaMinutes} min and ${args.volumeDeltaSessions >= 0 ? "+" : ""}${args.volumeDeltaSessions} sessions vs prior block.`
  );

  const totalFit = args.fitness.find((f) => f.sport === "total");
  if (totalFit) {
    bullets.push(
      `Total CTL: ${totalFit.currentCtlStart} → ${totalFit.currentCtlEnd} (${totalFit.currentCtlDelta >= 0 ? "+" : ""}${totalFit.currentCtlDelta}) across the block.`
    );
  }

  for (const p of args.paceAtHr) {
    if (p.direction === "insufficient") continue;
    bullets.push(p.summary);
  }

  for (const peak of args.peaks) {
    if (peak.deltaLabel && peak.prior.formatted) {
      bullets.push(`${peak.label}: ${peak.current.formatted} (${peak.deltaLabel}).`);
    }
  }

  return bullets.slice(0, 6);
}

function buildConfidenceNote(args: {
  currentActivitiesCount: number;
  priorActivitiesCount: number;
  fitnessPoints: ProgressReportFitnessPoint[];
  paceAtHr: ProgressReportPaceAtHr[];
}): string | null {
  const notes: string[] = [];
  if (args.currentActivitiesCount < 4) {
    notes.push(`Only ${args.currentActivitiesCount} activities in the current block`);
  }
  if (args.priorActivitiesCount < 4) {
    notes.push(`only ${args.priorActivitiesCount} in the prior block`);
  }
  if (args.fitnessPoints.length === 0) {
    notes.push("no CTL data available");
  }
  const insufficientPace = args.paceAtHr.filter((p) => p.direction === "insufficient");
  if (insufficientPace.length > 0) {
    notes.push(
      `pace-at-HR unavailable for ${insufficientPace.map((p) => p.sport).join(", ")}`
    );
  }
  if (notes.length === 0) return null;
  return `Limited sample: ${notes.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

type BlockBoundaries = {
  blockStart: string;
  blockEnd: string;
  priorBlockStart: string;
  priorBlockEnd: string;
};

async function loadBlockBoundariesFromIds(
  supabase: SupabaseClient,
  blockId: string,
  priorBlockId?: string | null
): Promise<BlockBoundaries | null> {
  const { data: block, error } = await supabase
    .from("training_blocks")
    .select("id,start_date,end_date,plan_id,sort_order")
    .eq("id", blockId)
    .maybeSingle();
  if (error || !block) return null;

  let prior: { start_date: string; end_date: string } | null = null;
  if (priorBlockId) {
    const { data: priorRow } = await supabase
      .from("training_blocks")
      .select("start_date,end_date")
      .eq("id", priorBlockId)
      .maybeSingle();
    prior = (priorRow as { start_date: string; end_date: string } | null) ?? null;
  } else if (block.plan_id != null && block.sort_order != null) {
    const { data: priorRow } = await supabase
      .from("training_blocks")
      .select("start_date,end_date")
      .eq("plan_id", block.plan_id)
      .lt("sort_order", block.sort_order)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    prior = (priorRow as { start_date: string; end_date: string } | null) ?? null;
  }

  const fallback = computeBlockBoundaries(block.end_date);
  return {
    blockStart: block.start_date,
    blockEnd: block.end_date,
    priorBlockStart: prior?.start_date ?? fallback.priorBlockStart,
    priorBlockEnd: prior?.end_date ?? fallback.priorBlockEnd,
  };
}

export async function buildProgressReportFactsForBlock(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockId: string;
  priorBlockId?: string | null;
}): Promise<ProgressReportFacts> {
  const bounds = await loadBlockBoundariesFromIds(args.supabase, args.blockId, args.priorBlockId);
  if (!bounds) {
    throw new Error(`progress-report: block ${args.blockId} not found`);
  }
  return buildFactsForBounds(args.supabase, args.athleteId, bounds);
}

export async function buildProgressReportFacts(args: {
  supabase: SupabaseClient;
  athleteId: string;
  blockEnd: string;
}): Promise<ProgressReportFacts> {
  const bounds = computeBlockBoundaries(args.blockEnd);
  return buildFactsForBounds(args.supabase, args.athleteId, bounds);
}

async function buildFactsForBounds(
  supabase: SupabaseClient,
  athleteId: string,
  bounds: BlockBoundaries
): Promise<ProgressReportFacts> {
  const [currentActivitiesRes, priorActivitiesRes, fitnessRes, sessionsRes] =
    await Promise.all([
      supabase
        .from("completed_activities")
        .select(
          "id,user_id,sport_type,start_time_utc,duration_sec,moving_duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,metrics_v2"
        )
        .eq("user_id", athleteId)
        .gte("start_time_utc", `${bounds.blockStart}T00:00:00.000Z`)
        .lte("start_time_utc", `${bounds.blockEnd}T23:59:59.999Z`)
        .order("start_time_utc", { ascending: true }),
      supabase
        .from("completed_activities")
        .select(
          "id,user_id,sport_type,start_time_utc,duration_sec,moving_duration_sec,distance_m,avg_hr,avg_power,avg_pace_per_100m_sec,metrics_v2"
        )
        .eq("user_id", athleteId)
        .gte("start_time_utc", `${bounds.priorBlockStart}T00:00:00.000Z`)
        .lte("start_time_utc", `${bounds.priorBlockEnd}T23:59:59.999Z`)
        .order("start_time_utc", { ascending: true }),
      supabase
        .from("athlete_fitness")
        .select("date,sport,ctl,atl,tsb,ramp_rate")
        .eq("user_id", athleteId)
        .in("sport", ["run", "bike", "swim", "total"])
        .gte("date", bounds.priorBlockStart)
        .lte("date", bounds.blockEnd)
        .order("date", { ascending: true }),
      supabase
        .from("sessions")
        .select("id,date,sport,duration_minutes,status,is_key,session_role")
        .eq("user_id", athleteId)
        .gte("date", bounds.priorBlockStart)
        .lte("date", bounds.blockEnd)
    ]);

  if (currentActivitiesRes.error) {
    throw new Error(
      `progress-report current activities: ${currentActivitiesRes.error.message}`
    );
  }
  if (priorActivitiesRes.error) {
    throw new Error(
      `progress-report prior activities: ${priorActivitiesRes.error.message}`
    );
  }
  if (fitnessRes.error) {
    throw new Error(`progress-report athlete_fitness: ${fitnessRes.error.message}`);
  }
  if (sessionsRes.error) {
    throw new Error(`progress-report sessions: ${sessionsRes.error.message}`);
  }

  const currentActivities = (currentActivitiesRes.data ?? []) as ActivityRow[];
  const priorActivities = (priorActivitiesRes.data ?? []) as ActivityRow[];
  const fitness = (fitnessRes.data ?? []) as FitnessRow[];
  const allSessions = (sessionsRes.data ?? []) as SessionRow[];

  const currentSessions = allSessions.filter(
    (s) => s.date >= bounds.blockStart && s.date <= bounds.blockEnd
  );
  const priorSessions = allSessions.filter(
    (s) => s.date >= bounds.priorBlockStart && s.date <= bounds.priorBlockEnd
  );

  const currentVolume = buildVolumeBlock(currentActivities, currentSessions);
  const priorVolume = buildVolumeBlock(priorActivities, priorSessions);

  const fitnessTrajectory = buildFitnessTrajectory(
    bounds.blockStart,
    bounds.blockEnd,
    bounds.priorBlockEnd,
    fitness
  );

  const paceAtHrByDiscipline: ProgressReportPaceAtHr[] = [];
  for (const sport of ["run", "bike", "swim"] as const) {
    const row = buildPaceAtHr(sport, currentActivities, priorActivities);
    if (row) paceAtHrByDiscipline.push(row);
  }

  const durabilityCurrent = buildDurabilityBlock(currentActivities);
  const durabilityPrior = buildDurabilityBlock(priorActivities);
  const durabilityDirection = inferDurabilityDirection(durabilityCurrent, durabilityPrior);
  const durabilitySummary =
    durabilityDirection === "insufficient"
      ? `Too few ≥45-min endurance sessions with split data to read durability (${durabilityCurrent.decouplingSamples} vs ${durabilityPrior.decouplingSamples}).`
      : `Decoupling avg ${durabilityCurrent.avgDecouplingPct ?? "?"}% vs prior ${durabilityPrior.avgDecouplingPct ?? "?"}% (${durabilityCurrent.decouplingSamples} vs ${durabilityPrior.decouplingSamples} samples) — ${durabilityDirection}.`;

  const peaks = buildPeakPerformances(currentActivities, priorActivities);

  const factualBullets = buildFactualBullets({
    volumeDeltaMinutes: currentVolume.totalMinutes - priorVolume.totalMinutes,
    volumeDeltaSessions: currentVolume.totalSessions - priorVolume.totalSessions,
    fitness: fitnessTrajectory,
    paceAtHr: paceAtHrByDiscipline,
    peaks
  });

  const confidenceNote = buildConfidenceNote({
    currentActivitiesCount: currentActivities.length,
    priorActivitiesCount: priorActivities.length,
    fitnessPoints: fitnessTrajectory,
    paceAtHr: paceAtHrByDiscipline
  });

  const raw = {
    blockStart: bounds.blockStart,
    blockEnd: bounds.blockEnd,
    priorBlockStart: bounds.priorBlockStart,
    priorBlockEnd: bounds.priorBlockEnd,
    blockLabel: `Block ending ${formatShortDate(bounds.blockEnd)}`,
    blockRange: formatBlockRange(bounds.blockStart, bounds.blockEnd),
    priorBlockRange: formatBlockRange(bounds.priorBlockStart, bounds.priorBlockEnd),
    volume: {
      current: currentVolume,
      prior: priorVolume,
      deltaMinutes: currentVolume.totalMinutes - priorVolume.totalMinutes,
      deltaSessions: currentVolume.totalSessions - priorVolume.totalSessions
    },
    fitnessTrajectory,
    paceAtHrByDiscipline,
    durability: {
      current: durabilityCurrent,
      prior: durabilityPrior,
      direction: durabilityDirection,
      summary: durabilitySummary
    },
    peakPerformances: peaks,
    factualBullets:
      factualBullets.length >= 2
        ? factualBullets
        : [
            ...factualBullets,
            "Sample size too small for block-over-block comparison.",
            "Upload more activities to unlock trend detection."
          ].slice(0, 6),
    confidenceNote,
    narrativeSource: "legacy_unknown" as const
  };

  return progressReportFactsSchema.parse(raw);
}
