// Date + race-segment helpers used to build the preview seed in
// data-scenarios.ts. Pulled out of the original data.ts so the seed scenario
// itself reads as data-only.

// Bundle starts at 08:00 UTC on the previewMonday()+6 Sunday and runs ~2:24.
// Per-segment offsets in seconds from the race start.
export const RACE_SEGMENT_OFFSETS_SEC = {
  swim: 0,        // 0:26:41
  t1: 1601,       // 0:02:10
  bike: 1731,     // 1:16:59
  t2: 6350,       // 0:01:39
  run: 6449       // 0:44:01
};
export const RACE_SEGMENT_DURATIONS_SEC = {
  swim: 1601,
  t1: 130,
  bike: 4619,
  t2: 99,
  run: 2641
};
export const RACE_TOTAL_DURATION_SEC =
  RACE_SEGMENT_DURATIONS_SEC.swim
  + RACE_SEGMENT_DURATIONS_SEC.t1
  + RACE_SEGMENT_DURATIONS_SEC.bike
  + RACE_SEGMENT_DURATIONS_SEC.t2
  + RACE_SEGMENT_DURATIONS_SEC.run;

export function raceSegmentStartIso(mondayIso: string, role: keyof typeof RACE_SEGMENT_OFFSETS_SEC) {
  const baseIso = `${previewDateOffset(mondayIso, 6)}T08:00:00.000Z`;
  const ms = new Date(baseIso).getTime() + RACE_SEGMENT_OFFSETS_SEC[role] * 1000;
  return new Date(ms).toISOString();
}

export function raceSegmentEndIso(mondayIso: string, role: keyof typeof RACE_SEGMENT_OFFSETS_SEC) {
  const startMs = new Date(raceSegmentStartIso(mondayIso, role)).getTime();
  return new Date(startMs + RACE_SEGMENT_DURATIONS_SEC[role] * 1000).toISOString();
}

export function previewMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const dist = day === 0 ? 6 : day - 1;
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dist));
  return mon.toISOString().slice(0, 10);
}

export function previewDateOffset(mondayIso: string, offset: number): string {
  const d = new Date(`${mondayIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Monday of the week BEFORE previewMonday(). Used to anchor the existing
 * race (Joe Hannon Olympic) one week in the past so it counts as a "prior"
 * race for race-week intelligence — letting us seed a future race for the
 * current week and exercise the carry-forward surface.
 */
export function previewPriorRaceMonday(): string {
  const mon = previewMonday();
  const d = new Date(`${mon}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}
