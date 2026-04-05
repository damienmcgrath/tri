/**
 * Season periodization engine.
 *
 * Given a set of races with priorities and a training period, generates
 * an ordered sequence of training blocks (Base, Build, Peak, Taper, Race,
 * Recovery, Transition) that peaks for A-races, handles B-race mini-tapers,
 * and trains through C-races.
 */

import type { RaceProfile } from "./race-profile";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BlockType = "Base" | "Build" | "Peak" | "Taper" | "Race" | "Recovery" | "Transition";

export type GeneratedBlock = {
  name: string;
  blockType: BlockType;
  startDate: string; // ISO date
  endDate: string; // ISO date
  targetRaceId: string | null;
  targetRacePriority: string | null;
  notes: string | null;
  sortOrder: number;
};

export type SeasonConstraints = {
  seasonStartDate: string;
  seasonEndDate: string;
  maxHoursPerWeek?: number;
};

// ─── Constants ─────────────────────────────────────────────────────────────

/** Taper duration in weeks by race distance */
const TAPER_WEEKS: Record<string, number> = {
  sprint: 1,
  olympic: 1,
  "70.3": 2,
  ironman: 3,
  custom: 1,
};

/** Peak/race-specific block duration in weeks */
const PEAK_WEEKS: Record<string, number> = {
  sprint: 2,
  olympic: 2,
  "70.3": 3,
  ironman: 4,
  custom: 2,
};

/** Recovery weeks after a race */
const RECOVERY_WEEKS: Record<string, number> = {
  sprint: 1,
  olympic: 1,
  "70.3": 1,
  ironman: 2,
  custom: 1,
};

// ─── Date helpers ──────────────────────────────────────────────────────────

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addWeeks(iso: string, weeks: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return toIso(d);
}

function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

function weeksBetween(startIso: string, endIso: string): number {
  const ms = toDate(endIso).getTime() - toDate(startIso).getTime();
  return Math.floor(ms / (7 * 86400000));
}

function daysBetween(startIso: string, endIso: string): number {
  const ms = toDate(endIso).getTime() - toDate(startIso).getTime();
  return Math.floor(ms / 86400000);
}

// ─── Engine ────────────────────────────────────────────────────────────────

/**
 * Generate a periodized season of training blocks from a race calendar.
 *
 * Algorithm:
 * 1. Sort races chronologically
 * 2. For each A-race, allocate Taper + Race + Recovery blocks working backwards
 * 3. For B-races within an A-race build cycle, insert a mini-taper note (no full block)
 * 4. C-races get no structural changes (train-through)
 * 5. Fill remaining gaps between fixed blocks with Build phases
 * 6. Fill the start of the season with Base phase
 * 7. Insert Transition blocks between A-race recovery and next cycle
 */
export function generateSeasonPeriodization(
  races: RaceProfile[],
  constraints: SeasonConstraints
): GeneratedBlock[] {
  if (races.length === 0) {
    return [makeBlock("Base Phase", "Base", constraints.seasonStartDate, constraints.seasonEndDate, null, null, null, 0)];
  }

  const sorted = [...races].sort((a, b) => a.date.localeCompare(b.date));
  const aRaces = sorted.filter((r) => r.priority === "A");
  const bRaces = sorted.filter((r) => r.priority === "B");
  const cRaces = sorted.filter((r) => r.priority === "C");

  // If no A-races, treat the highest-priority race as the target
  const targetRaces = aRaces.length > 0 ? aRaces : bRaces.length > 0 ? [bRaces[0]!] : [sorted[0]!];

  const blocks: GeneratedBlock[] = [];
  let cursor = constraints.seasonStartDate;
  let sortOrder = 0;

  for (let i = 0; i < targetRaces.length; i++) {
    const race = targetRaces[i]!;
    const taperWeeks = TAPER_WEEKS[race.distanceType] ?? 1;
    const peakWeeks = PEAK_WEEKS[race.distanceType] ?? 2;
    const recoveryWeeks = RECOVERY_WEEKS[race.distanceType] ?? 1;

    // Calculate key dates
    const raceWeekStart = getWeekStart(race.date);
    const taperStart = addWeeks(raceWeekStart, -taperWeeks);
    const peakStart = addWeeks(taperStart, -peakWeeks);
    const recoveryEnd = addWeeks(raceWeekStart, 1 + recoveryWeeks);

    // Fill gap before peak with Base/Build
    const gapWeeks = weeksBetween(cursor, peakStart);
    if (gapWeeks > 0) {
      if (i === 0 && gapWeeks >= 4) {
        // First cycle: split into Base + Build
        const baseWeeks = Math.min(Math.ceil(gapWeeks * 0.4), 6);
        const buildWeeks = gapWeeks - baseWeeks;

        if (baseWeeks > 0) {
          const baseEnd = addDays(addWeeks(cursor, baseWeeks), -1);
          blocks.push(makeBlock("Base Phase", "Base", cursor, baseEnd, race.id, race.priority, null, sortOrder++));
          cursor = addWeeks(cursor, baseWeeks);
        }
        if (buildWeeks > 0) {
          const buildEnd = addDays(peakStart, -1);
          blocks.push(makeBlock(`Build Phase${i > 0 ? ` ${i + 1}` : ""}`, "Build", cursor, buildEnd, race.id, race.priority, null, sortOrder++));
        }
      } else if (gapWeeks >= 2) {
        const buildEnd = addDays(peakStart, -1);
        blocks.push(makeBlock(`Build Phase${i > 0 ? ` ${i + 1}` : ""}`, "Build", cursor, buildEnd, race.id, race.priority, null, sortOrder++));
      }
    }

    // Peak block
    if (peakWeeks > 0 && peakStart >= cursor) {
      const peakEnd = addDays(taperStart, -1);
      blocks.push(makeBlock("Race-Specific", "Peak", peakStart, peakEnd, race.id, race.priority, null, sortOrder++));
    }

    // Taper block
    if (taperWeeks > 0) {
      const taperEnd = addDays(raceWeekStart, -1);
      blocks.push(makeBlock("Taper", "Taper", taperStart, taperEnd, race.id, race.priority, null, sortOrder++));
    }

    // Race week
    const raceWeekEnd = addDays(raceWeekStart, 6);
    blocks.push(makeBlock(`Race: ${race.name}`, "Race", raceWeekStart, raceWeekEnd, race.id, race.priority, null, sortOrder++));

    // Recovery
    const recoveryStart = addDays(raceWeekEnd, 1);
    const recovEnd = addDays(recoveryEnd, -1);
    if (recoveryWeeks > 0 && recovEnd >= recoveryStart) {
      blocks.push(makeBlock("Recovery", "Recovery", recoveryStart, recovEnd, race.id, race.priority, null, sortOrder++));
    }

    cursor = recoveryEnd;

    // Transition between A-race cycles
    if (i < targetRaces.length - 1) {
      const nextRace = targetRaces[i + 1]!;
      const nextPeakStart = addWeeks(getWeekStart(nextRace.date), -(PEAK_WEEKS[nextRace.distanceType] ?? 2) - (TAPER_WEEKS[nextRace.distanceType] ?? 1));
      const transitionGap = weeksBetween(cursor, nextPeakStart);

      if (transitionGap >= 2) {
        const transitionEnd = addDays(addWeeks(cursor, Math.min(2, transitionGap)), -1);
        blocks.push(makeBlock("Transition", "Transition", cursor, transitionEnd, null, null, "Unstructured training between race cycles", sortOrder++));
        cursor = addDays(transitionEnd, 1);
      }
    }
  }

  // Handle B-races: add notes to surrounding blocks
  for (const bRace of bRaces) {
    if (targetRaces.includes(bRace)) continue;
    annotateRaceInBlocks(blocks, bRace, "B-race: mini-taper 3-5 days before, reduced volume. Not a full peak.");
  }

  // Handle C-races: add notes only
  for (const cRace of cRaces) {
    annotateRaceInBlocks(blocks, cRace, "C-race: train-through. No taper. Rest day before, recovery after.");
  }

  // Fill any remaining time after last recovery
  if (cursor < constraints.seasonEndDate) {
    const remaining = weeksBetween(cursor, constraints.seasonEndDate);
    if (remaining >= 1) {
      blocks.push(makeBlock("Off-Season", "Transition", cursor, constraints.seasonEndDate, null, null, null, sortOrder++));
    }
  }

  return blocks;
}

/**
 * Validate a block sequence for gaps and overlaps.
 */
export function validateBlockSequence(blocks: GeneratedBlock[]): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const sorted = [...blocks].sort((a, b) => a.startDate.localeCompare(b.startDate));

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;

    const gap = daysBetween(prev.endDate, curr.startDate);
    if (gap > 1) {
      issues.push(`Gap of ${gap} days between "${prev.name}" and "${curr.name}"`);
    }
    if (gap < 1) {
      issues.push(`Overlap between "${prev.name}" (ends ${prev.endDate}) and "${curr.name}" (starts ${curr.startDate})`);
    }
  }

  return { valid: issues.length === 0, issues };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function getWeekStart(dateIso: string): string {
  const d = toDate(dateIso);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day; // Monday = start of week
  d.setUTCDate(d.getUTCDate() + offset);
  return toIso(d);
}

function makeBlock(
  name: string,
  blockType: BlockType,
  startDate: string,
  endDate: string,
  targetRaceId: string | null,
  targetRacePriority: string | null,
  notes: string | null,
  sortOrder: number
): GeneratedBlock {
  return { name, blockType, startDate, endDate, targetRaceId, targetRacePriority, notes, sortOrder };
}

function annotateRaceInBlocks(blocks: GeneratedBlock[], race: RaceProfile, note: string): void {
  // Find the block that contains this race's date and append a note
  for (const block of blocks) {
    if (block.startDate <= race.date && block.endDate >= race.date) {
      block.notes = block.notes ? `${block.notes}\n${race.name}: ${note}` : `${race.name}: ${note}`;
      return;
    }
  }
}
