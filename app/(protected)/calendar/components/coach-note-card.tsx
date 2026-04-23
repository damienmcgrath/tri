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

type TriggerType =
  | "recovery_signal"
  | "missed_session"
  | "load_rebalance"
  | "cross_discipline"
  | "feel_based"
  | "block_transition"
  | "athlete_request"
  | "schedule_change";

const TRIGGER_LABELS: Record<TriggerType, string> = {
  recovery_signal: "Recovery adjustment",
  missed_session: "Missed session",
  load_rebalance: "Load rebalance",
  cross_discipline: "Cross-discipline",
  feel_based: "Feel-based",
  block_transition: "Block transition",
  athlete_request: "Your request",
  schedule_change: "Schedule change"
};

type TriggerColors = { bg: string; border: string; text: string };
const DEFAULT_TRIGGER_COLORS: TriggerColors = {
  bg: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.15)",
  text: "rgba(255,255,255,0.7)"
};
const TRIGGER_COLORS: Partial<Record<TriggerType, TriggerColors>> = {
  recovery_signal: { bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.3)", text: "rgb(251,191,36)" },
  missed_session: { bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.3)", text: "rgb(248,113,113)" },
  load_rebalance: { bg: "rgba(99,179,237,0.08)", border: "rgba(99,179,237,0.3)", text: "rgb(99,179,237)" },
  feel_based: { bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.3)", text: "rgb(167,139,250)" },
  block_transition: { bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.3)", text: "rgb(52,211,153)" }
};

/**
 * Summarize a multi-sentence rationale into a single coach-note headline:
 * - First sentence, capped at 140 characters
 * - If no sentence break, first 140 chars with ellipsis
 */
function summarizeRationale(text: string): { summary: string; hasMore: boolean } {
  const cleaned = text.trim();
  if (cleaned.length === 0) return { summary: "", hasMore: false };
  const sentenceMatch = cleaned.match(/^[^.!?\n]+[.!?]/);
  if (sentenceMatch) {
    const first = sentenceMatch[0].trim();
    if (first.length <= 140) {
      return { summary: first, hasMore: cleaned.length > first.length };
    }
  }
  if (cleaned.length <= 140) return { summary: cleaned, hasMore: false };
  return { summary: `${cleaned.slice(0, 137).trimEnd()}…`, hasMore: true };
}

function SingleCoachNote({ rationale, defaultCollapsed = true }: { rationale: AdaptationRationale; defaultCollapsed?: boolean }) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const [acknowledging, setAcknowledging] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const triggerType = rationale.trigger_type as TriggerType;
  const triggerLabel = TRIGGER_LABELS[triggerType] ?? "Plan adjustment";
  const colors = TRIGGER_COLORS[triggerType] ?? DEFAULT_TRIGGER_COLORS;
  const changes = Array.isArray(rationale.changes_summary) ? rationale.changes_summary : [];
  const preserved = rationale.preserved_elements ?? [];
  const { summary: summaryLine, hasMore } = summarizeRationale(rationale.rationale_text);
  const canCollapse = hasMore || changes.length > 0 || preserved.length > 0;

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
          <span className="text-ui-label uppercase tracking-wider" style={{ color: colors.text }}>
            Coach note
          </span>
          <span className="rounded-full border px-2 py-0.5 text-ui-label" style={{ borderColor: colors.border, color: colors.text }}>
            {triggerLabel}
          </span>
        </div>
      </div>

      <p className="mt-2 text-body text-white">
        {expanded ? rationale.rationale_text : summaryLine}
      </p>

      {canCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-ui-label text-tertiary hover:text-white"
        >
          {expanded ? "Show less" : "Show full reasoning"}
        </button>
      ) : null}

      {expanded && (changes.length > 0 || preserved.length > 0) && (
        <div className="mt-3 space-y-3 rounded-lg bg-[rgba(0,0,0,0.2)] p-3">
          {changes.length > 0 && (
            <div>
              <p className="text-ui-label uppercase tracking-wider text-tertiary">Changes</p>
              <div className="mt-1.5 space-y-1.5">
                {changes.map((change, i) => (
                  <div key={i} className="text-ui-label">
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
              <p className="text-ui-label uppercase tracking-wider text-tertiary">Preserved</p>
              <ul className="mt-1 space-y-0.5">
                {preserved.map((item, i) => (
                  <li key={i} className="text-ui-label text-muted">{item}</li>
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
          className="rounded-lg bg-[rgba(255,255,255,0.08)] px-3 py-1.5 text-ui-label text-white hover:bg-[rgba(255,255,255,0.14)] disabled:opacity-40"
        >
          {acknowledging ? "..." : "Got it"}
        </button>
        <Link
          href={`/coach?prompt=${encodeURIComponent(`I want to discuss this adaptation: ${rationale.rationale_text}`)}`}
          className="text-ui-label text-tertiary hover:text-white"
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
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-ui-label text-tertiary transition hover:border-[rgba(255,255,255,0.16)] hover:text-white"
        >
          {showAll
            ? "Hide older notes"
            : `${restNotes.length} more coach note${restNotes.length > 1 ? "s" : ""}`}
          <span className="text-ui-label">{showAll ? "\u25B2" : "\u25BC"}</span>
        </button>
      )}

      {showAll &&
        restNotes.map((r) => (
          <SingleCoachNote key={r.id} rationale={r} />
        ))}
    </div>
  );
}
