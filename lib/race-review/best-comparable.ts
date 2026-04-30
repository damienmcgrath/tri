/**
 * Best comparable training session finder.
 *
 * Given a race-leg discipline, the leg's duration, and a 12-week pool of
 * completed sessions with metrics, return the most-comparable training
 * session — or null when nothing in the pool is close enough. The "do not
 * fabricate" rule from the spec maps directly: a low-scoring best is no
 * best at all.
 *
 * Scoring (each axis 0..1, multiplied):
 *   - sport match (hard requirement; mismatch = 0)
 *   - duration similarity: 1 at exact match, decaying linearly to 0 at ±60%
 *   - intent overlap: 1 when name/role flags race-pace / threshold / tempo
 *     keywords, 0.6 for endurance/long, 0.3 for "recovery", 0.5 default
 *
 * The score floor is 0.45 — below that we return null.
 */

export type ComparableCandidate = {
  sessionId: string;
  date: string;
  sport: "swim" | "bike" | "run" | "strength" | "other" | string;
  durationSec: number;
  sessionName: string | null;
  type: string | null;
  sessionRole: string | null;
};

export type ComparableMatch = {
  sessionId: string;
  date: string;
  sessionName: string;
  durationSec: number;
  score: number;
};

const SCORE_FLOOR = 0.45;

const RACE_PACE_KEYWORDS = ["race pace", "race-pace", "racepace", "tempo", "threshold", "time trial", "tt", "ftp"];
const ENDURANCE_KEYWORDS = ["long", "endurance", "z2", "aerobic"];
const RECOVERY_KEYWORDS = ["recovery", "easy", "shakeout"];

export function findBestComparableTraining(args: {
  discipline: "swim" | "bike" | "run";
  raceLegDurationSec: number;
  candidates: ComparableCandidate[];
}): ComparableMatch | null {
  const { discipline, raceLegDurationSec, candidates } = args;
  if (raceLegDurationSec <= 0 || candidates.length === 0) return null;

  let best: ComparableMatch | null = null;
  for (const c of candidates) {
    if (c.sport !== discipline) continue;
    if (c.durationSec <= 0) continue;
    const durationScore = scoreDuration(c.durationSec, raceLegDurationSec);
    if (durationScore <= 0) continue;
    const intentScore = scoreIntent(c.sessionName, c.type, c.sessionRole);
    const score = durationScore * intentScore;
    if (score < SCORE_FLOOR) continue;
    if (!best || score > best.score) {
      best = {
        sessionId: c.sessionId,
        date: c.date,
        sessionName: c.sessionName ?? c.type ?? `${capitalize(discipline)} session`,
        durationSec: c.durationSec,
        score
      };
    }
  }
  return best;
}

function scoreDuration(candidateSec: number, targetSec: number): number {
  const ratio = candidateSec / targetSec;
  // Symmetric: 1 at ratio=1, 0 at ratio=0.4 or 1.6
  const distance = Math.abs(1 - ratio);
  if (distance >= 0.6) return 0;
  return 1 - distance / 0.6;
}

function scoreIntent(name: string | null, type: string | null, role: string | null): number {
  const haystack = `${(name ?? "").toLowerCase()} ${(type ?? "").toLowerCase()} ${(role ?? "").toLowerCase()}`;
  if (RACE_PACE_KEYWORDS.some((k) => haystack.includes(k))) return 1;
  if (ENDURANCE_KEYWORDS.some((k) => haystack.includes(k))) return 0.7;
  if (RECOVERY_KEYWORDS.some((k) => haystack.includes(k))) return 0.3;
  if (role === "key") return 0.85;
  return 0.55;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
