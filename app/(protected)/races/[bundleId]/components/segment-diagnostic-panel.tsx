"use client";

import { useEffect } from "react";
import type { RaceBundleSummary } from "@/lib/race/bundle-helpers";
import type { CoachCitation } from "@/lib/coach/types";

type Props = {
  citation: CoachCitation | null;
  summary: RaceBundleSummary;
  onClose: () => void;
};

const SEG_TITLE: Record<string, string> = {
  swim: "Swim segment",
  bike: "Bike segment",
  run: "Run segment"
};

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pickSegment(summary: RaceBundleSummary, role: string) {
  return summary.segments.find((s) => s.role === role) ?? null;
}

function pickDiagnostic(summary: RaceBundleSummary, role: string): Record<string, unknown> | null {
  const list = Array.isArray(summary.review?.segment_diagnostics)
    ? (summary.review!.segment_diagnostics as unknown[])
    : [];
  const match = list.find((d) => d && typeof d === "object" && (d as Record<string, unknown>).discipline === role);
  return match ? (match as Record<string, unknown>) : null;
}

export function SegmentDiagnosticPanel({ citation, summary, onClose }: Props) {
  useEffect(() => {
    if (!citation) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [citation, onClose]);

  if (!citation) return null;

  let body: React.ReactNode = null;
  let title = "Source data";

  if (citation.type === "segment" || citation.type === "reference_frame") {
    const role = citation.type === "segment" ? citation.refId : citation.refId.split(":")[0];
    title = SEG_TITLE[role] ?? "Segment";
    const seg = pickSegment(summary, role);
    const diag = pickDiagnostic(summary, role);
    body = (
      <div className="flex flex-col gap-3 text-sm">
        {seg ? (
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <DLPair label="Duration" value={formatDuration(seg.durationSec)} />
            <DLPair
              label="Distance"
              value={seg.distanceM != null ? `${(seg.distanceM / 1000).toFixed(2)} km` : "—"}
            />
            <DLPair label="Avg HR" value={seg.avgHr != null ? `${seg.avgHr} bpm` : "—"} />
            <DLPair label="Avg Power" value={seg.avgPower != null ? `${seg.avgPower} W` : "—"} />
          </dl>
        ) : null}
        {diag && typeof diag.aiNarrative === "string" ? (
          <p className="text-[rgba(255,255,255,0.8)]">{diag.aiNarrative}</p>
        ) : null}
        {diag ? <RefFrameSummary diagnostic={diag} /> : null}
      </div>
    );
  } else if (citation.type === "pre_race") {
    title = "Pre-race state";
    body = (
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <DLPair label="CTL" value={summary.bundle.pre_race_ctl != null ? String(summary.bundle.pre_race_ctl) : "—"} />
        <DLPair label="ATL" value={summary.bundle.pre_race_atl != null ? String(summary.bundle.pre_race_atl) : "—"} />
        <DLPair label="TSB" value={summary.bundle.pre_race_tsb != null ? String(summary.bundle.pre_race_tsb) : "—"} />
        <DLPair
          label="Taper"
          value={
            summary.bundle.taper_compliance_score != null
              ? `${Math.round(summary.bundle.taper_compliance_score * 100)}%`
              : "—"
          }
        />
        {summary.bundle.taper_compliance_summary ? (
          <div className="col-span-2 text-tertiary">{summary.bundle.taper_compliance_summary}</div>
        ) : null}
      </dl>
    );
  } else if (citation.type === "subjective") {
    title = "Race notes";
    body = (
      <div className="flex flex-col gap-2 text-sm">
        {summary.bundle.athlete_rating != null ? (
          <p>Rating: {summary.bundle.athlete_rating}/5</p>
        ) : null}
        {summary.bundle.issues_flagged.length > 0 ? (
          <p>Issues: {summary.bundle.issues_flagged.join(", ")}</p>
        ) : null}
        {summary.bundle.athlete_notes ? <p className="whitespace-pre-wrap">{summary.bundle.athlete_notes}</p> : null}
      </div>
    );
  } else if (citation.type === "lesson") {
    title = "Lesson";
    const lessons = summary.lessons;
    const [kind, idxRaw] = citation.refId.split(":");
    const idx = Number(idxRaw);
    if (lessons && kind === "takeaway" && Number.isFinite(idx)) {
      const t = lessons.athleteProfileTakeaways[idx];
      body = t ? <p className="text-sm">{t.headline} — {t.body}</p> : <p className="text-sm text-muted">Lesson not found.</p>;
    } else if (lessons && kind === "implication" && Number.isFinite(idx)) {
      const t = lessons.trainingImplications[idx];
      body = t ? <p className="text-sm">{t.headline} — {t.change}</p> : <p className="text-sm text-muted">Implication not found.</p>;
    } else if (lessons?.carryForward && kind === "carry_forward") {
      body = <p className="text-sm">{lessons.carryForward.headline} — {lessons.carryForward.instruction}</p>;
    } else {
      body = <p className="text-sm text-muted">Lesson not found.</p>;
    }
  } else {
    title = citation.label;
    body = <p className="text-sm text-muted">Open this on the race page for full detail.</p>;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
      />
      <article className="relative w-full max-w-md rounded-t-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5 shadow-xl sm:rounded-2xl">
        <header className="mb-3 flex items-center justify-between gap-3 border-b border-[hsl(var(--border))] pb-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[hsl(var(--border))] px-2 py-0.5 text-[11px] text-tertiary hover:border-[rgba(255,255,255,0.18)]"
          >
            Close
          </button>
        </header>
        {body}
      </article>
    </div>
  );
}

function DLPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-tertiary">{label}</dt>
      <dd className="font-mono text-sm text-[rgba(255,255,255,0.92)]">{value}</dd>
    </div>
  );
}

function RefFrameSummary({ diagnostic }: { diagnostic: Record<string, unknown> }) {
  const refs = (diagnostic.referenceFrames as Record<string, unknown> | undefined) ?? {};
  const lines: Array<{ label: string; text: string }> = [];
  const vsPlan = refs.vsPlan as Record<string, unknown> | undefined;
  if (vsPlan && typeof vsPlan.summary === "string") lines.push({ label: "vs plan", text: vsPlan.summary });
  const vsThreshold = refs.vsThreshold as Record<string, unknown> | undefined;
  if (vsThreshold && typeof vsThreshold.summary === "string") lines.push({ label: "vs threshold", text: vsThreshold.summary });
  const vsBest = refs.vsBestComparableTraining as Record<string, unknown> | undefined;
  if (vsBest && typeof vsBest.comparison === "string") lines.push({ label: "vs best training", text: vsBest.comparison });
  const vsPrior = refs.vsPriorRace as Record<string, unknown> | undefined;
  if (vsPrior && typeof vsPrior.comparison === "string") lines.push({ label: "vs prior race", text: vsPrior.comparison });

  if (lines.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-[rgba(255,255,255,0.78)]">
      {lines.map((l, i) => (
        <li key={i}>
          <span className="text-tertiary">{l.label}:</span> {l.text}
        </li>
      ))}
    </ul>
  );
}
