import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeAerobicDecoupling,
  extractWeatherSignal,
  type AerobicDecoupling,
  type WeatherSignal
} from "./session-signals";
import { fetchHistoricalComparables, type HistoricalComparable } from "./historical-comparables";

/**
 * Bundled per-session signals that sit alongside the deterministic evidence.
 * These are the "non-obvious" inputs the AI reviewer uses to reach beyond a
 * restatement of the session's numbers — trends against the athlete's own
 * history, environmental context, and cardiac-vs-output durability.
 */
export type ExtendedSignals = {
  aerobicDecoupling: AerobicDecoupling | null;
  weather: WeatherSignal | null;
  historicalComparables: HistoricalComparable[];
};

export const EMPTY_EXTENDED_SIGNALS: ExtendedSignals = {
  aerobicDecoupling: null,
  weather: null,
  historicalComparables: []
};

type SplitHalves = {
  firstHalfAvgHr?: number | null;
  lastHalfAvgHr?: number | null;
  firstHalfAvgPower?: number | null;
  lastHalfAvgPower?: number | null;
  firstHalfPaceSPerKm?: number | null;
  lastHalfPaceSPerKm?: number | null;
};

export async function buildExtendedSignals(
  supabase: SupabaseClient,
  args: {
    athleteId: string;
    sessionId: string;
    sport: string;
    intentCategory: string | null;
    sessionDate: string;
    splitHalves: SplitHalves | null;
    environment: unknown;
  }
): Promise<ExtendedSignals> {
  const [historicalComparables] = await Promise.all([
    fetchHistoricalComparables(supabase, {
      athleteId: args.athleteId,
      sport: args.sport,
      intentCategory: args.intentCategory,
      beforeDate: args.sessionDate,
      excludeSessionId: args.sessionId,
      limit: 4
    }).catch(() => [] as HistoricalComparable[])
  ]);

  const aerobicDecoupling = args.splitHalves
    ? computeAerobicDecoupling({
        sport: args.sport,
        firstHalfAvgHr: args.splitHalves.firstHalfAvgHr,
        lastHalfAvgHr: args.splitHalves.lastHalfAvgHr,
        firstHalfAvgPower: args.splitHalves.firstHalfAvgPower,
        lastHalfAvgPower: args.splitHalves.lastHalfAvgPower,
        firstHalfPaceSPerKm: args.splitHalves.firstHalfPaceSPerKm,
        lastHalfPaceSPerKm: args.splitHalves.lastHalfPaceSPerKm
      })
    : null;

  const weather = extractWeatherSignal(args.environment);

  return {
    aerobicDecoupling,
    weather,
    historicalComparables
  };
}
