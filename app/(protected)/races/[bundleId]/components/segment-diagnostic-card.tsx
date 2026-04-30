/**
 * AI Layer 3 — per-discipline diagnostic drill-down.
 *
 * One card per discipline (swim/bike/run) when data is present. Each card
 * shows: the AI synthesis paragraph, the four reference frames in a 2x2
 * grid, the pacing analysis, and any anomalies the detector surfaced. Each
 * frame degrades gracefully to a "no data" state instead of disappearing.
 *
 * Reference-frame data is computed deterministically upstream — this
 * component only renders.
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { AskCoachButton } from "./ask-coach-button";

export type SegmentDiagnosticPayload = {
  discipline: "swim" | "bike" | "run";
  referenceFrames: {
    vsPlan: { label: "on_plan" | "under" | "over"; deltaPct: number; summary: string } | null;
    vsThreshold: {
      thresholdValue: number;
      thresholdUnit: "watts" | "sec_per_km" | "sec_per_100m";
      intensityFactor: number;
      summary: string;
    } | null;
    vsBestComparableTraining: {
      sessionId: string;
      sessionDate: string;
      sessionName: string;
      comparison: string;
    } | null;
    vsPriorRace: {
      bundleId: string;
      raceName: string;
      raceDate: string;
      comparison: string;
    } | null;
  };
  pacingAnalysis: {
    splitType: "even" | "positive" | "negative" | null;
    driftObservation: string | null;
    decouplingObservation: string | null;
  };
  anomalies: Array<{
    type: "hr_spike" | "power_dropout" | "pace_break" | "cadence_drop";
    atSec: number;
    observation: string;
  }>;
  aiNarrative: string | null;
};

const DISCIPLINE_LABEL: Record<"swim" | "bike" | "run", string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run"
};

const SPLIT_LABEL: Record<"even" | "positive" | "negative", string> = {
  even: "Even split",
  positive: "Positive split (eased)",
  negative: "Negative split (built)"
};

const PLAN_TONE: Record<"on_plan" | "under" | "over", string> = {
  on_plan: "text-success",
  under: "text-warning",
  over: "text-warning"
};

const ANOMALY_LABEL: Record<SegmentDiagnosticPayload["anomalies"][number]["type"], string> = {
  hr_spike: "HR spike",
  power_dropout: "Power dropout",
  pace_break: "Pace break",
  cadence_drop: "Cadence drop"
};

export function SegmentDiagnosticCard({
  diagnostic,
  bundleId
}: {
  diagnostic: SegmentDiagnosticPayload;
  bundleId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { referenceFrames, pacingAnalysis, anomalies, aiNarrative, discipline } = diagnostic;

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-5">
      <header className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
          {DISCIPLINE_LABEL[discipline]} diagnostic
        </p>
        <div className="flex items-center gap-2">
          {pacingAnalysis.splitType ? (
            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-tertiary">
              {SPLIT_LABEL[pacingAnalysis.splitType]}
            </span>
          ) : null}
          {bundleId ? (
            <AskCoachButton
              bundleId={bundleId}
              focus={`segment:${discipline}`}
              variant="ghost"
              label="Ask"
            />
          ) : null}
        </div>
      </header>

      {aiNarrative ? (
        <p className="mt-3 text-sm leading-relaxed text-[rgba(255,255,255,0.86)]">{aiNarrative}</p>
      ) : null}

      <details
        className="mt-4 group"
        open={expanded}
        onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none text-xs text-tertiary underline-offset-2 transition-ui hover:text-white hover:underline">
          {expanded ? "Hide reference frames" : "Show reference frames"}
        </summary>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <ReferenceFrame title="vs Plan">
            {referenceFrames.vsPlan ? (
              <>
                <p className={`text-xs font-medium uppercase tracking-[0.1em] ${PLAN_TONE[referenceFrames.vsPlan.label]}`}>
                  {referenceFrames.vsPlan.label.replace("_", " ")}
                </p>
                <p className="mt-1 text-sm text-[rgba(255,255,255,0.86)]">{referenceFrames.vsPlan.summary}</p>
              </>
            ) : (
              <NoData reason="No plan target was set for this leg." />
            )}
          </ReferenceFrame>

          <ReferenceFrame title="vs Threshold">
            {referenceFrames.vsThreshold ? (
              <>
                <p className="text-xs font-medium uppercase tracking-[0.1em] text-tertiary">
                  IF {referenceFrames.vsThreshold.intensityFactor.toFixed(2)}
                </p>
                <p className="mt-1 text-sm text-[rgba(255,255,255,0.86)]">{referenceFrames.vsThreshold.summary}</p>
              </>
            ) : (
              <NoData reason={discipline === "bike" ? "FTP not set." : "Threshold pace not yet stored for this discipline."} />
            )}
          </ReferenceFrame>

          <ReferenceFrame title="vs Best Comparable Training">
            {referenceFrames.vsBestComparableTraining ? (
              <>
                <Link
                  href={`/sessions/${referenceFrames.vsBestComparableTraining.sessionId}`}
                  className="text-xs font-medium uppercase tracking-[0.1em] text-tertiary underline-offset-2 hover:text-white hover:underline"
                >
                  {referenceFrames.vsBestComparableTraining.sessionName}
                </Link>
                <p className="mt-1 text-sm text-[rgba(255,255,255,0.86)]">{referenceFrames.vsBestComparableTraining.comparison}</p>
              </>
            ) : (
              <NoData reason="No comparable training session in the last 12 weeks." />
            )}
          </ReferenceFrame>

          <ReferenceFrame title="vs Prior Race">
            {referenceFrames.vsPriorRace ? (
              <>
                <Link
                  href={`/races/${referenceFrames.vsPriorRace.bundleId}`}
                  className="text-xs font-medium uppercase tracking-[0.1em] text-tertiary underline-offset-2 hover:text-white hover:underline"
                >
                  {referenceFrames.vsPriorRace.raceName}
                </Link>
                <p className="mt-1 text-sm text-[rgba(255,255,255,0.86)]">{referenceFrames.vsPriorRace.comparison}</p>
              </>
            ) : (
              <NoData reason="No prior race at this distance." />
            )}
          </ReferenceFrame>
        </div>

        {(pacingAnalysis.driftObservation || pacingAnalysis.decouplingObservation) ? (
          <div className="mt-4 border-t border-[hsl(var(--border))] pt-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Pacing analysis</p>
            <ul className="mt-2 space-y-1.5">
              {pacingAnalysis.driftObservation ? (
                <li className="text-sm text-[rgba(255,255,255,0.86)]">{pacingAnalysis.driftObservation}</li>
              ) : null}
              {pacingAnalysis.decouplingObservation ? (
                <li className="text-sm text-[rgba(255,255,255,0.86)]">{pacingAnalysis.decouplingObservation}</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {anomalies.length > 0 ? (
          <div className="mt-4 border-t border-[hsl(var(--border))] pt-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Anomalies</p>
            <ul className="mt-2 space-y-1.5">
              {anomalies.map((a, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-tertiary">
                    {ANOMALY_LABEL[a.type]}
                  </span>
                  <span className="text-[rgba(255,255,255,0.86)]">{a.observation}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </details>
    </article>
  );
}

function ReferenceFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-tertiary">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function NoData({ reason }: { reason: string }) {
  return <p className="text-sm text-tertiary italic">{reason}</p>;
}
