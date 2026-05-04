/**
 * Zod schemas + structural types for session verdict generation. Kept
 * separate from the prompt template and the orchestrating caller so each
 * concern can be re-used / unit-tested independently.
 */

import { z } from "zod";
import type { ExtendedSignals } from "@/lib/analytics/extended-signals";

const metricComparisonSchema = z.object({
  metric: z.string().min(1).max(60),
  target: z.string().min(1).max(100),
  actual: z.string().min(1).max(100),
  assessment: z.enum(["on_target", "above", "below", "missing"])
});

const deviationSchema = z.object({
  metric: z.string().min(1).max(60),
  description: z.string().min(1).max(300),
  severity: z.enum(["minor", "moderate", "significant"])
});

export const sessionVerdictOutputSchema = z.object({
  purpose_statement: z.string().min(1).max(400),
  training_block_context: z.string().min(1).max(200),
  intended_zones: z.string().max(500),
  intended_metrics: z.string().max(500),
  execution_summary: z.string().min(1).max(600),
  verdict_status: z.enum(["achieved", "partial", "missed", "off_target"]),
  metric_comparisons: z.array(metricComparisonSchema).max(6),
  key_deviations: z.array(deviationSchema).max(5),
  /**
   * A single finding that goes beyond restating the session. Must cite a
   * historical comparable, aerobic decoupling, weather-adjusted context, or a
   * cross-session pattern. Required so the model can never fall back to a pure
   * summary of this session's numbers.
   */
  non_obvious_insight: z.string().min(1).max(320),
  /**
   * Optional one-sentence teach moment explaining *why* a metric exposed by
   * this session matters (VI spike, aerobic decoupling, negative-split
   * failure, durability fade, cadence drop, HR↔pace divergence). Null when
   * no mechanism is worth teaching, so the model does not manufacture
   * platitudes. Rotate focus across sessions.
   */
  teach: z.string().min(1).max(200).nullable(),
  /**
   * Concrete citation of at least one prior same-intent session the reader
   * can anchor to (date + metric delta). Required non-null whenever
   * `extendedSignals.historicalComparables` has at least one entry, so the
   * model cannot ignore the comparables that were injected. Null only when
   * no comparables are available.
   */
  comparable_reference: z.string().min(1).max(240).nullable(),
  adaptation_signal: z.string().min(1).max(800),
  adaptation_type: z.enum(["proceed", "flag_review", "modify", "redistribute"]),
  affected_session_ids: z.array(z.string()).max(5)
});

export type SessionVerdictOutput = z.infer<typeof sessionVerdictOutputSchema>;

export type SessionVerdictContext = {
  session: {
    id: string;
    sport: string;
    type: string;
    sessionName: string | null;
    intentCategory: string | null;
    target: string | null;
    notes: string | null;
    durationMinutes: number | null;
    isKey: boolean;
    date: string;
  };
  activity: {
    durationSec: number | null;
    distanceM: number | null;
    avgHr: number | null;
    avgPower: number | null;
    /** Duration-weighted average power from work-interval laps only. */
    avgIntervalPower: number | null;
    avgPacePer100mSec: number | null;
    metrics: Record<string, unknown> | null;
  } | null;
  executionResult: Record<string, unknown> | null;
  feel: {
    overallFeel: number | null;
    energyLevel: string | null;
    legsFeel: string | null;
    motivation: string | null;
    sleepQuality: string | null;
    lifeStress: string | null;
    note: string | null;
  } | null;
  trainingBlock: {
    currentBlock: string;
    blockWeek: number;
    blockTotalWeeks: number;
    raceName: string | null;
    daysToRace: number | null;
  };
  upcomingSessions: Array<{
    id: string;
    date: string;
    sport: string;
    type: string;
    isKey: boolean;
  }>;
  recentLoadTrend: {
    last7daysTss: number | null;
    last14daysTss: number | null;
    currentCtl: number | null;
    currentAtl: number | null;
    currentTsb: number | null;
  } | null;
  /**
   * Optional so older test fixtures remain valid. When absent at runtime the
   * fallback verdict still emits a `non_obvious_insight` grounded in whatever
   * evidence is present.
   */
  extendedSignals?: ExtendedSignals;
};
