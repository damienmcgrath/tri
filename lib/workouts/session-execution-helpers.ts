import type { PersistedExecutionReview } from "@/lib/execution-review";

export type SessionExecutionSessionRow = {
  id: string;
  athlete_id?: string;
  user_id: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  date?: string | null;
  target?: string | null;
  notes?: string | null;
  intent_category?: string | null;
  session_name?: string | null;
  session_role?: string | null;
  status?: "planned" | "completed" | "skipped" | null;
};

export type SessionExecutionActivityRow = {
  id: string;
  sport_type: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  avg_pace_per_100m_sec?: number | null;
  laps_count?: number | null;
  parse_summary?: Record<string, unknown> | null;
  metrics_v2?: Record<string, unknown> | null;
};

export type PersistedExecutionResult = PersistedExecutionReview;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function getNumber(source: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function getNestedNumber(sources: Array<Record<string, unknown> | null | undefined>, keyPaths: string[][]) {
  for (const source of sources) {
    for (const path of keyPaths) {
      let cursor: unknown = source;
      for (const key of path) {
        if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(key in cursor)) {
          cursor = null;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[key];
      }
      if (typeof cursor === "number" && Number.isFinite(cursor)) return cursor;
    }
  }
  return null;
}

export function sumZoneDurations(zones: unknown[] | undefined) {
  if (!Array.isArray(zones)) return null;
  return zones.reduce<number>((sum, zone) => sum + (getNumber(asRecord(zone), ["durationSec", "duration_sec"]) ?? 0), 0);
}

export function asExecutionResult(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
