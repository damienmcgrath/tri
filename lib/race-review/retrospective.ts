/**
 * Phase 3.3 — Pre-race Retrospective orchestrator.
 *
 * Looks back at the 8-week build cycle and assesses whether periodisation
 * worked. Reads athlete_fitness for CTL/ATL/TSB trajectory, sessions
 * (session_role='key' in window) for execution rate, and the bundle's
 * pre-race snapshot for taper compliance.
 *
 * The deterministic pieces (trajectory, taper read-out, execution rate)
 * are computed by this orchestrator; only the verdict block (headline +
 * body + actionable adjustment) is AI-generated. Falls back to a
 * deterministic verdict on AI failure.
 */

import "openai/shims/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zodTextFormat } from "openai/helpers/zod";
import { callOpenAIWithFallback } from "@/lib/ai/call-with-fallback";
import {
  retrospectiveAiSchema,
  type CtlTrajectory,
  type CtlTrajectoryPoint,
  type KeySessionExecutionEntry,
  type KeySessionExecutionRate,
  type PreRaceRetrospective,
  type RetrospectiveVerdict,
  type TaperReadOut
} from "@/lib/race-review/retrospective-schemas";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GenerateRetrospectiveArgs = {
  supabase: SupabaseClient;
  userId: string;
  bundleId: string;
  raceDateIso: string;
  /** Mirrors bundle.pre_race_ctl/atl/tsb and the taper score from the bundle. */
  bundle: {
    pre_race_ctl: number | null;
    pre_race_atl: number | null;
    pre_race_tsb: number | null;
    taper_compliance_score: number | null;
    taper_compliance_summary: string | null;
  };
  /** Default 56 (8 weeks). */
  buildWindowDays?: number;
};

export type GenerateRetrospectiveResult =
  | { status: "ok"; payload: PreRaceRetrospective }
  | { status: "skipped"; reason: string };

const DEFAULT_BUILD_WINDOW_DAYS = 56;

// ─── Pure helpers (exported for testing) ────────────────────────────────────

export function summarizeTrajectory(series: CtlTrajectoryPoint[], raceDateIso: string): {
  peakCtl: number;
  peakCtlDate: string;
  daysFromPeakToRace: number;
} {
  if (series.length === 0) {
    return { peakCtl: 0, peakCtlDate: raceDateIso.slice(0, 10), daysFromPeakToRace: 0 };
  }
  let peakIdx = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i].ctl > series[peakIdx].ctl) peakIdx = i;
  }
  const peak = series[peakIdx];
  const raceDate = new Date(raceDateIso);
  const peakDate = new Date(`${peak.date}T00:00:00.000Z`);
  const daysFromPeakToRace = Math.max(0, Math.round((raceDate.getTime() - peakDate.getTime()) / (24 * 3600 * 1000)));
  return {
    peakCtl: round1(peak.ctl),
    peakCtlDate: peak.date,
    daysFromPeakToRace
  };
}

/** intentMatch token → numeric score: on_target=1, partial=0.5, missed=0. */
export function intentMatchToScore(token: unknown): number | null {
  if (token === "on_target") return 1;
  if (token === "partial") return 0.5;
  if (token === "missed") return 0;
  return null;
}

export function buildDeterministicVerdict(args: {
  taper: TaperReadOut;
  trajectory: CtlTrajectory;
  execution: KeySessionExecutionRate;
}): RetrospectiveVerdict {
  const { taper, trajectory, execution } = args;
  const taperPct = taper.complianceScore != null ? Math.round(taper.complianceScore * 100) : null;
  const exPct = Math.round(execution.rate * 100);

  let headline = "Build held together.";
  let actionable = "Hold the same structure for the next build.";

  if (trajectory.daysFromPeakToRace > 14) {
    headline = "CTL peaked early.";
    actionable = `Next build: extend the peak block so peak CTL lands within 10 days of race day (peak fell ${trajectory.daysFromPeakToRace} days out this time).`;
  } else if (taperPct != null && taperPct < 75) {
    headline = `Taper undershot at ${taperPct}%.`;
    actionable = `Next build: hold final-week TSS at 60% of peak (compliance ran ${taperPct}% this time).`;
  } else if (execution.totalKeySessions > 0 && execution.rate < 0.7) {
    headline = `Key sessions executed at ${exPct}%.`;
    actionable = `Next build: protect the ${execution.totalKeySessions} key-session blocks — execution dropped to ${exPct}% this cycle.`;
  } else if (taperPct != null && taperPct >= 90 && execution.rate >= 0.85) {
    headline = "Build executed cleanly into a clean taper.";
    actionable = "Hold the same periodisation shape for the next build cycle.";
  }

  const peakLine = `Peak CTL ${trajectory.peakCtl} on ${trajectory.peakCtlDate}, ${trajectory.daysFromPeakToRace} days before race.`;
  const taperLine = taperPct != null ? ` Taper compliance ${taperPct}%.` : "";
  const execLine = execution.totalKeySessions > 0
    ? ` Key sessions: ${execution.completedKeySessions}/${execution.totalKeySessions} (${exPct}%).`
    : "";
  const body = `${peakLine}${taperLine}${execLine}`.trim();

  return { headline, body, actionableAdjustment: actionable };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Loaders ────────────────────────────────────────────────────────────────

async function loadCtlTrajectory(
  supabase: SupabaseClient,
  userId: string,
  raceDateIso: string,
  windowDays: number
): Promise<CtlTrajectoryPoint[]> {
  const raceDate = new Date(raceDateIso);
  const windowStart = new Date(raceDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const raceDateOnly = raceDateIso.slice(0, 10);

  const { data: rows } = await supabase
    .from("athlete_fitness")
    .select("date,ctl,atl,tsb")
    .eq("user_id", userId)
    .eq("sport", "total")
    .gte("date", windowStartIso)
    .lte("date", raceDateOnly)
    .order("date", { ascending: true });

  return (rows ?? []).map((r) => ({
    date: (r as { date: string }).date,
    ctl: Number((r as { ctl: number }).ctl ?? 0),
    atl: Number((r as { atl: number }).atl ?? 0),
    tsb: Number((r as { tsb: number }).tsb ?? 0)
  }));
}

async function loadKeySessionsInWindow(
  supabase: SupabaseClient,
  userId: string,
  raceDateIso: string,
  windowDays: number
): Promise<KeySessionExecutionRate> {
  const raceDate = new Date(raceDateIso);
  const windowStart = new Date(raceDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  const raceDateOnly = raceDateIso.slice(0, 10);

  const { data: rows } = await supabase
    .from("sessions")
    .select("id,date,session_name,sport,type,status,execution_result")
    .eq("user_id", userId)
    .eq("session_role", "key")
    .gte("date", windowStartIso)
    .lt("date", raceDateOnly)
    .order("date", { ascending: true });

  const list: KeySessionExecutionEntry[] = [];
  for (const r of rows ?? []) {
    const row = r as {
      id: string;
      date: string;
      session_name: string | null;
      sport: string;
      type: string | null;
      status: string;
      execution_result: unknown;
    };
    const executed = row.status === "completed";
    let executionScore: number | null = null;
    if (executed && row.execution_result && typeof row.execution_result === "object") {
      const verdict = (row.execution_result as Record<string, unknown>).coach_verdict
        ?? (row.execution_result as Record<string, unknown>).coachVerdict
        ?? (row.execution_result as Record<string, unknown>).verdict;
      const sessionVerdict = verdict && typeof verdict === "object"
        ? ((verdict as Record<string, unknown>).sessionVerdict as Record<string, unknown> | undefined)
        : undefined;
      executionScore = intentMatchToScore(sessionVerdict?.intentMatch);
    }
    list.push({
      sessionId: row.id,
      date: row.date,
      name: row.session_name ?? row.type ?? `Key ${row.sport} session`,
      executed,
      executionScore
    });
  }

  const totalKeySessions = list.length;
  const completedKeySessions = list.filter((s) => s.executed).length;
  const rate = totalKeySessions === 0 ? 1 : completedKeySessions / totalKeySessions;
  return { totalKeySessions, completedKeySessions, rate: round1(rate * 100) / 100, keySessionsList: list.slice(0, 20) };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export async function buildPreRaceRetrospective(
  args: GenerateRetrospectiveArgs
): Promise<GenerateRetrospectiveResult> {
  const { supabase, userId, raceDateIso, bundle } = args;
  const buildWindowDays = args.buildWindowDays ?? DEFAULT_BUILD_WINDOW_DAYS;

  const series = await loadCtlTrajectory(supabase, userId, raceDateIso, buildWindowDays);
  const summary = summarizeTrajectory(series, raceDateIso);
  const trajectory: CtlTrajectory = {
    sport: "total",
    series,
    peakCtl: summary.peakCtl,
    peakCtlDate: summary.peakCtlDate,
    targetPeakCtl: null,
    daysFromPeakToRace: summary.daysFromPeakToRace,
    raceMorningCtl: bundle.pre_race_ctl
  };

  const taperReadOut: TaperReadOut = {
    complianceScore: bundle.taper_compliance_score,
    summary: bundle.taper_compliance_summary
  };

  const execution = await loadKeySessionsInWindow(supabase, userId, raceDateIso, buildWindowDays);

  const fallbackVerdict = buildDeterministicVerdict({ taper: taperReadOut, trajectory, execution });

  const aiAttempt = await callOpenAIWithFallback({
    logTag: "race-review-retrospective",
    fallback: fallbackVerdict,
    buildRequest: () => ({
      instructions: buildRetrospectiveInstructions(),
      reasoning: { effort: "low" },
      max_output_tokens: 600,
      text: {
        format: zodTextFormat(retrospectiveAiSchema, "retrospective_verdict", {
          description: "Pre-race retrospective verdict: headline + body + actionable adjustment for the NEXT build."
        })
      },
      input: [
        {
          role: "user" as const,
          content: [
            {
              type: "input_text" as const,
              text: JSON.stringify({
                buildWindowDays,
                trajectory: {
                  peakCtl: trajectory.peakCtl,
                  peakCtlDate: trajectory.peakCtlDate,
                  daysFromPeakToRace: trajectory.daysFromPeakToRace,
                  raceMorningCtl: trajectory.raceMorningCtl
                },
                taperReadOut,
                execution: {
                  totalKeySessions: execution.totalKeySessions,
                  completedKeySessions: execution.completedKeySessions,
                  rate: execution.rate
                }
              })
            }
          ]
        }
      ]
    }),
    schema: retrospectiveAiSchema,
    logContext: { bundleId: args.bundleId }
  });

  const verdict = aiAttempt.value;
  const source = aiAttempt.source;

  const payload: PreRaceRetrospective = {
    buildWindowDays,
    ctlTrajectory: trajectory,
    taperReadOut,
    keySessionExecutionRate: execution,
    verdict,
    source,
    generatedAt: new Date().toISOString()
  };

  return { status: "ok", payload };
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export function buildRetrospectiveInstructions(): string {
  return [
    "You are writing the verdict block for a race's Pre-race Retrospective section.",
    "Input: peak CTL + days from peak to race, taper compliance score, key-session execution rate.",
    "",
    "Write a verdict object: { headline, body, actionableAdjustment }.",
    "",
    "Tone rules (HARD):",
    "- Never use 'should have', 'failed', 'missed' as moralising verbs.",
    "- Diagnose, don't judge.",
    "- Cite at least one specific number per field.",
    "- The actionableAdjustment is for the NEXT build, not this race. Use directives like 'Hold X', 'Extend Y by N days'.",
    "",
    "Length budgets: headline ≤140, body ≤600, actionableAdjustment ≤280.",
    "",
    "Empathy cue: if the build executed cleanly (taper ≥90% AND execution ≥85% AND days-from-peak 7-14),",
    "lead the verdict with a direct 'the build worked' framing. Don't soften.",
    "",
    "When the build undershot taper or execution, frame it as 'distribution to fix' rather than 'effort missing'."
  ].join("\n");
}
