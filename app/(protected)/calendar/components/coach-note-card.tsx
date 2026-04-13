"use client";

import { useState } from "react";
import Link from "next/link";

type ChangeItem = {
  session_id?: string | null;
  session_label: string;
  change_type: string;
  before: string;
  after: string;
};

type AdaptationRationale = {
  id: string;
  trigger_type: string;
  rationale_text: string;
  changes_summary: ChangeItem[];
  preserved_elements: string[] | null;
  training_block: string | null;
  week_number: number | null;
  status: string;
  created_at: string;
};

type Props = {
  rationales: AdaptationRationale[];
};

const TRIGGER_LABELS: Record<string, string> = {
  recovery_signal: "Recovery adjustment",
  missed_session: "Missed session",
  load_rebalance: "Load rebalance",
  cross_discipline: "Cross-discipline",
  feel_based: "Feel-based",
  block_transition: "Block transition",
  athlete_request: "Your request",
  schedule_change: "Schedule change"
};

const TRIGGER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  recovery_signal: { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.3)", text: "rgb(251,191,36)" },
  missed_session: { bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.3)", text: "rgb(248,113,113)" },
  load_rebalance: { bg: "rgba(99,179,237,0.08)", border: "rgba(99,179,237,0.3)", text: "rgb(99,179,237)" },
  feel_based: { bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.3)", text: "rgb(167,139,250)" },
  block_transition: { bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.3)", text: "rgb(52,211,153)" },
  default: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.15)", text: "rgba(255,255,255,0.7)" }
};

function SingleCoachNote({ rationale }: { rationale: AdaptationRationale }) {
  const [expanded, setExpanded] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const triggerLabel = TRIGGER_LABELS[rationale.trigger_type] ?? "Plan adjustment";
  const colors = TRIGGER_COLORS[rationale.trigger_type] ?? TRIGGER_COLORS.default;
  const changes = Array.isArray(rationale.changes_summary) ? rationale.changes_summary : [];
  const preserved = rationale.preserved_elements ?? [];

  async function handleAcknowledge() {
    setAcknowledging(true);
    try {
      const res = await fetch("/api/adaptation-rationales", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rationaleId: rationale.id, action: "acknowledge" })
      });
      if (res.ok) setDismissed(true);
    } finally {
      setAcknowledging(false);
    }
  }

  return (
    <article
      className="rounded-xl border p-4"
      style={{ borderColor: colors.border, backgroundColor: colors.bg }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider" style={{ color: colors.text }}>
            Coach note
          </span>
          <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: colors.border, color: colors.text }}>
            {triggerLabel}
          </span>
        </div>
      </div>

      <p className="mt-2 text-sm text-white">{rationale.rationale_text}</p>

      {/* Expandable details */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-xs text-tertiary hover:text-white"
      >
        {expanded ? "Hide details" : "Why?"}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 rounded-lg bg-[rgba(0,0,0,0.2)] p-3">
          {changes.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-tertiary">Changes</p>
              <div className="mt-1.5 space-y-1.5">
                {changes.map((change, i) => (
                  <div key={i} className="text-xs">
                    <span className="font-medium text-white">{change.session_label}</span>
                    <span className="text-tertiary"> — </span>
                    <span className="text-muted line-through">{change.before}</span>
                    <span className="text-tertiary"> → </span>
                    <span className="text-white">{change.after}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {preserved.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-tertiary">Preserved</p>
              <ul className="mt-1 space-y-0.5">
                {preserved.map((item, i) => (
                  <li key={i} className="text-xs text-muted">{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleAcknowledge()}
          disabled={acknowledging}
          className="rounded-lg bg-[rgba(255,255,255,0.08)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[rgba(255,255,255,0.14)] disabled:opacity-40"
        >
          {acknowledging ? "..." : "Got it"}
        </button>
        <Link
          href={`/coach?prompt=${encodeURIComponent(`I want to discuss this adaptation: ${rationale.rationale_text}`)}`}
          className="text-xs text-tertiary hover:text-white"
        >
          Let&apos;s discuss
        </Link>
      </div>
    </article>
  );
}

export function CoachNoteCards({ rationales }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (rationales.length === 0) return null;

  const firstNote = rationales[0];
  const restNotes = rationales.slice(1);

  return (
    <div className="space-y-3">
      <SingleCoachNote key={firstNote.id} rationale={firstNote} />

      {restNotes.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-xs text-tertiary transition hover:border-[rgba(255,255,255,0.16)] hover:text-white"
        >
          {showAll
            ? "Hide older notes"
            : `${restNotes.length} more coach note${restNotes.length > 1 ? "s" : ""}`}
          <span className="text-[10px]">{showAll ? "\u25B2" : "\u25BC"}</span>
        </button>
      )}

      {showAll &&
        restNotes.map((r) => (
          <SingleCoachNote key={r.id} rationale={r} />
        ))}
    </div>
  );
}
