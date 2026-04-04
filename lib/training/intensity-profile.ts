/**
 * Intensity profile computation for plan sessions.
 * Parses session target/notes to infer zone distribution and visual encoding.
 */

export type ZoneKey = "z1" | "z2" | "z3" | "z4" | "z5" | "strength";

export type ZoneDistribution = Record<ZoneKey, number>;

export type SessionIntensityProfile = {
  sessionId: string;
  primaryZone: ZoneKey;
  zoneDistribution: ZoneDistribution;
  plannedStressScore: number;
  plannedDurationMinutes: number;
  stressPerMinute: number;
  intensityColour: string;
  visualWeight: number;
  discipline: string;
};

export type WeeklyIntensitySummary = {
  weekStartDate: string;
  zoneDistribution: ZoneDistribution;
  totalPlannedHours: number;
  totalStressScore: number;
  sessionCount: number;
  hoursDeltaPct: number | null;
  stressDeltaPct: number | null;
  disciplineHours: Record<string, number>;
  trainingBlock: string | null;
  weekInBlock: number | null;
  blockType: string | null;
};

// --- Zone colour map ---

const ZONE_COLOURS: Record<ZoneKey, string> = {
  z1: "hsl(210, 55%, 58%)",      // cool blue (recovery/easy)
  z2: "hsl(210, 50%, 52%)",      // slightly deeper blue (endurance)
  z3: "hsl(40, 85%, 55%)",       // amber (tempo)
  z4: "hsl(25, 90%, 55%)",       // orange (threshold)
  z5: "hsl(5, 80%, 55%)",        // red/coral (VO2max+)
  strength: "hsl(260, 40%, 55%)" // slate purple
};

// Stress multiplier per zone (higher zone = more stress per minute)
const ZONE_STRESS_FACTOR: Record<ZoneKey, number> = {
  z1: 0.4,
  z2: 0.6,
  z3: 1.0,
  z4: 1.5,
  z5: 2.0,
  strength: 0.7
};

export function getIntensityColour(zone: ZoneKey): string {
  return ZONE_COLOURS[zone] ?? ZONE_COLOURS.z2;
}

/**
 * Infer the primary training zone from a session target string and sport.
 */
export function inferZoneFromTarget(
  target: string | null,
  sport: string,
  type: string,
  notes: string | null,
  intentCategory: string | null
): ZoneKey {
  if (sport === "strength") return "strength";

  const text = [target, type, notes, intentCategory]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Zone 5 indicators
  if (/vo2|z5|anaerobic|sprint|max effort|race pace.*interval|all.out/i.test(text)) return "z5";

  // Zone 4 indicators
  if (/threshold|z4|ftp|css|lt2|sweet.?spot|race.?pace|3x|4x|5x.*@/i.test(text)) return "z4";

  // Zone 3 indicators
  if (/tempo|z3|moderate|steady.?state|cruise|half.?marathon/i.test(text)) return "z3";

  // Zone 1 indicators (recovery)
  if (/recovery|z1|very.?easy|active.?recovery|flush|spin|shake.?out/i.test(text)) return "z1";

  // Default: Z2 (aerobic/endurance)
  if (/easy|z2|aerobic|base|endurance|long|low|conversational/i.test(text)) return "z2";

  // If still unclear, infer from type patterns
  if (/long ride|long run|endurance/i.test(type)) return "z2";
  if (/interval|speed/i.test(type)) return "z4";
  if (/easy|recovery/i.test(type)) return "z1";

  return "z2"; // default to endurance
}

/**
 * Estimate zone distribution from session metadata.
 * Returns a normalized distribution summing to ~1.0.
 */
export function estimateZoneDistribution(
  primaryZone: ZoneKey,
  target: string | null,
  durationMinutes: number
): ZoneDistribution {
  const dist: ZoneDistribution = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, strength: 0 };

  if (primaryZone === "strength") {
    dist.strength = 1.0;
    return dist;
  }

  // Parse interval patterns like "3x10 @ FTP" or "5x3min Z5"
  const intervalMatch = target?.match(/(\d+)\s*[x×]\s*(\d+)\s*(min|m)?/i);

  if (intervalMatch && (primaryZone === "z4" || primaryZone === "z5")) {
    const reps = parseInt(intervalMatch[1]);
    const repDuration = parseInt(intervalMatch[2]);
    const isMinutes = !intervalMatch[3] || /min/i.test(intervalMatch[3]);
    const workMinutes = reps * (isMinutes ? repDuration : repDuration / 60);
    const workFraction = Math.min(workMinutes / durationMinutes, 0.6);
    const warmCoolFraction = Math.min(0.3, (durationMinutes - workMinutes) / durationMinutes * 0.5);
    const restFraction = 1.0 - workFraction - warmCoolFraction;

    dist[primaryZone] = workFraction;
    dist.z2 = warmCoolFraction + restFraction * 0.5;
    dist.z1 = restFraction * 0.5;
    return dist;
  }

  // Steady-state session distributions
  switch (primaryZone) {
    case "z1":
      dist.z1 = 0.85;
      dist.z2 = 0.15;
      break;
    case "z2":
      dist.z1 = 0.10;
      dist.z2 = 0.80;
      dist.z3 = 0.10;
      break;
    case "z3":
      dist.z2 = 0.25;
      dist.z3 = 0.60;
      dist.z4 = 0.15;
      break;
    case "z4":
      dist.z2 = 0.30;
      dist.z3 = 0.15;
      dist.z4 = 0.45;
      dist.z5 = 0.10;
      break;
    case "z5":
      dist.z2 = 0.35;
      dist.z3 = 0.10;
      dist.z4 = 0.15;
      dist.z5 = 0.40;
      break;
    default:
      dist.z2 = 1.0;
  }

  return dist;
}

/**
 * Compute the stress score for a session given its zone distribution and duration.
 */
export function computeStressScore(
  zoneDistribution: ZoneDistribution,
  durationMinutes: number
): number {
  let weightedStress = 0;
  for (const [zone, fraction] of Object.entries(zoneDistribution)) {
    weightedStress += fraction * (ZONE_STRESS_FACTOR[zone as ZoneKey] ?? 0.6);
  }
  return Math.round(weightedStress * durationMinutes * 10) / 10;
}

/**
 * Compute the visual weight (0-1) for a session relative to the max stress in the week.
 */
export function getVisualWeight(stressScore: number, maxStressInWeek: number): number {
  if (maxStressInWeek <= 0) return 0.5;
  return Math.max(0.15, Math.min(1.0, stressScore / maxStressInWeek));
}

/**
 * Build a full intensity profile for a session.
 */
export function computeSessionIntensityProfile(session: {
  id: string;
  sport: string;
  type: string;
  target: string | null;
  notes: string | null;
  durationMinutes: number;
  intentCategory: string | null;
}): Omit<SessionIntensityProfile, "visualWeight"> & { rawStress: number } {
  const primaryZone = inferZoneFromTarget(
    session.target,
    session.sport,
    session.type,
    session.notes,
    session.intentCategory
  );
  const zoneDistribution = estimateZoneDistribution(
    primaryZone,
    session.target,
    session.durationMinutes
  );
  const stressScore = computeStressScore(zoneDistribution, session.durationMinutes);
  const stressPerMinute = session.durationMinutes > 0 ? stressScore / session.durationMinutes : 0;

  return {
    sessionId: session.id,
    primaryZone,
    zoneDistribution,
    plannedStressScore: stressScore,
    plannedDurationMinutes: session.durationMinutes,
    stressPerMinute,
    intensityColour: getIntensityColour(primaryZone),
    discipline: session.sport,
    rawStress: stressScore
  };
}

/**
 * Compute weekly intensity summary from session profiles.
 */
export function computeWeeklyIntensitySummary(
  profiles: SessionIntensityProfile[],
  weekStartDate: string,
  previousWeekSummary?: { totalPlannedHours: number; totalStressScore: number } | null
): WeeklyIntensitySummary {
  const aggDist: ZoneDistribution = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, strength: 0 };
  let totalMinutes = 0;
  let totalStress = 0;
  const disciplineMinutes: Record<string, number> = {};

  for (const profile of profiles) {
    const weight = profile.plannedDurationMinutes;
    totalMinutes += weight;
    totalStress += profile.plannedStressScore;
    disciplineMinutes[profile.discipline] =
      (disciplineMinutes[profile.discipline] ?? 0) + weight;

    for (const [zone, fraction] of Object.entries(profile.zoneDistribution)) {
      aggDist[zone as ZoneKey] += fraction * weight;
    }
  }

  // Normalize zone distribution
  if (totalMinutes > 0) {
    for (const zone of Object.keys(aggDist) as ZoneKey[]) {
      aggDist[zone] = Math.round((aggDist[zone] / totalMinutes) * 100) / 100;
    }
  }

  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const disciplineHours: Record<string, number> = {};
  for (const [sport, mins] of Object.entries(disciplineMinutes)) {
    disciplineHours[sport] = Math.round((mins / 60) * 10) / 10;
  }

  const hoursDeltaPct = previousWeekSummary?.totalPlannedHours
    ? Math.round(((totalHours - previousWeekSummary.totalPlannedHours) / previousWeekSummary.totalPlannedHours) * 100)
    : null;
  const stressDeltaPct = previousWeekSummary?.totalStressScore
    ? Math.round(((totalStress - previousWeekSummary.totalStressScore) / previousWeekSummary.totalStressScore) * 100)
    : null;

  return {
    weekStartDate,
    zoneDistribution: aggDist,
    totalPlannedHours: totalHours,
    totalStressScore: Math.round(totalStress),
    sessionCount: profiles.length,
    hoursDeltaPct,
    stressDeltaPct,
    disciplineHours,
    trainingBlock: null,
    weekInBlock: null,
    blockType: null
  };
}
