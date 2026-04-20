"use client";

import { useState } from "react";
import type { CoachVerdict } from "@/lib/execution-review-types";
import { ReclassifyIntentSelector } from "./reclassify-intent-selector";

/** Sanitize camelCase field names that may leak from stored verdict text. */
function sanitizeText(text: string): string {
  let result = text;
  const fieldMap: [RegExp, string][] = [
    [/\bintervalCompletion(?:Pct)?\b/gi, "interval completion"],
    [/\btimeAboveTargetPct\b/gi, "time above target"],
    [/\bavgPower\b/gi, "avg power"],
    [/\bavgHr\b/gi, "avg heart rate"],
    [/\bnormalizedPower\b/gi, "normalized power"],
    [/\bvariabilityIndex\b/gi, "variability index"],
    [/\btrainingStressScore\b/gi, "training stress score"],
    [/\bavgCadence\b/gi, "avg cadence"],
    [/\bavgPacePer100mSec\b/gi, "avg pace per 100m"],
    [/\bavgStrokeRateSpm\b/gi, "avg stroke rate"],
    [/\bavgSwolf\b/gi, "avg SWOLF"],
    [/\belevationGainM\b/gi, "elevation gain"],
    [/\bdurationCompletion\b/gi, "duration completion"],
    [/\btotalWorkKj\b/gi, "total work"],
    [/\bmaxHr\b/gi, "max heart rate"],
    [/\bmaxPower\b/gi, "max power"],
  ];
  for (const [pattern, replacement] of fieldMap) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

type IntentMatch = CoachVerdict["sessionVerdict"]["intentMatch"];
type NextCall = CoachVerdict["sessionVerdict"]["nextCall"];

const INTENT_MATCH_CONFIG: Record<IntentMatch, { label: string; color: string; bg: string; border: string }> = {
  on_target: {
    label: "Supportive load",
    color: "rgb(52,211,153)",
    bg: "rgba(52,211,153,0.1)",
    border: "rgba(52,211,153,0.3)",
  },
  partial: {
    label: "Mixed signals",
    color: "rgb(251,191,36)",
    bg: "rgba(251,191,36,0.1)",
    border: "rgba(251,191,36,0.3)",
  },
  missed: {
    label: "Risky load",
    color: "rgb(248,113,113)",
    bg: "rgba(248,113,113,0.1)",
    border: "rgba(248,113,113,0.3)",
  },
};

function IntentMatchIcon({ match }: { match: IntentMatch }) {
  const color = INTENT_MATCH_CONFIG[match].color;
  if (match === "on_target") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color }} aria-hidden="true">
        <path d="M11.5 3.5L5.5 10L2.5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (match === "partial") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color }} aria-hidden="true">
        <path d="M7 4V7.5M7 10H7.005" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color }} aria-hidden="true">
      <path d="M10 4L4 10M4 4L10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const NEXT_CALL_LABELS: Record<NextCall, string> = {
  move_on: "No adjustment needed",
  proceed_with_caution: "Proceed with caution",
  repeat_session: "Consider repeating",
  protect_recovery: "Protect recovery",
  adjust_next_key_session: "Adjust next key session",
};

type Props = {
  verdict: CoachVerdict;
  intentCategory: string | null;
  narrativeSource: "ai" | "fallback" | "legacy_unknown";
  /** Synthetic session ID (e.g. "activity-{uuid}") for the regenerate endpoint. */
  sessionId?: string;
  /** Sport type used to filter the reclassify intent options. */
  sport?: string;
};

export function ExtrasVerdictCard({ verdict, intentCategory, narrativeSource, sessionId, sport }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);

  const match = INTENT_MATCH_CONFIG[verdict.sessionVerdict.intentMatch];
  const nextCallLabel = NEXT_CALL_LABELS[verdict.sessionVerdict.nextCall] ?? verdict.sessionVerdict.nextCall;
  const showNextCallChip = verdict.sessionVerdict.nextCall !== "move_on";

  const intentLabel = intentCategory
    ? intentCategory.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Extra workout";

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-0">
        <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Extra session verdict</p>
        {narrativeSource === "ai" ? (
          <span className="rounded-full border border-[rgba(190,255,0,0.2)] bg-[rgba(190,255,0,0.06)] px-2 py-0.5 text-[10px] text-[var(--color-accent)]">
            AI review
          </span>
        ) : (
          <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-[10px] text-tertiary">
            Directional
          </span>
        )}
      </div>

      <div className="divide-y divide-[hsl(var(--border))]">
        {/* Part 1: What this session was */}
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2.5 py-0.5 text-[11px] font-medium text-muted">
              {intentLabel}
            </span>
            {sessionId && sport ? (
              <ReclassifyIntentSelector
                sessionId={sessionId}
                currentIntent={intentCategory}
                sport={sport}
              />
            ) : null}
          </div>
          {verdict.explanation.sessionIntent ? (
            <p className="mt-2 text-sm text-muted">{sanitizeText(verdict.explanation.sessionIntent)}</p>
          ) : null}
        </div>

        {/* Part 2: How it went */}
        <div className="px-5 py-4">
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: match.border, backgroundColor: match.bg }}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{ backgroundColor: match.bg, color: match.color, border: `1.5px solid ${match.border}` }}
              >
                <IntentMatchIcon match={verdict.sessionVerdict.intentMatch} />
              </span>
              <p className="text-sm font-medium" style={{ color: match.color }}>
                {match.label}
              </p>
            </div>
            <p className="mt-2 text-xs font-medium" style={{ color: match.color }}>
              {sanitizeText(verdict.sessionVerdict.headline)}
            </p>
            <p className="mt-2 text-sm text-white leading-relaxed">{sanitizeText(verdict.sessionVerdict.summary)}</p>
          </div>

          {/* What happened — expanded detail below the status box */}
          {verdict.explanation.whatHappened ? (
            <p className="mt-3 text-sm text-muted leading-relaxed">{sanitizeText(verdict.explanation.whatHappened)}</p>
          ) : null}

          {/* Cited evidence — progressive disclosure */}
          {verdict.citedEvidence.length > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setShowEvidence(!showEvidence)}
                className="mt-3 rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-tertiary hover:border-[rgba(255,255,255,0.25)] hover:text-white"
              >
                {showEvidence ? "Hide evidence" : "Show evidence"}
              </button>
              {showEvidence ? (
                <div className="mt-2 space-y-2 rounded-lg bg-[rgba(0,0,0,0.2)] p-3">
                  {verdict.citedEvidence.map((item, i) => (
                    <div key={i}>
                      <p className="text-xs font-medium text-white">{sanitizeText(item.claim)}</p>
                      <ul className="mt-1 space-y-0.5">
                        {item.support.map((s, j) => (
                          <li key={j} className="text-xs text-muted pl-3 relative before:absolute before:left-0 before:top-[7px] before:h-1 before:w-1 before:rounded-full before:bg-[rgba(255,255,255,0.2)]">
                            {sanitizeText(s)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Coach insight — the non-obvious cross-session finding, and optional teach */}
        {verdict.nonObviousInsight || verdict.teach ? (
          <div className="px-5 py-4">
            {verdict.nonObviousInsight ? (
              <>
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--color-accent)]">Coach insight</p>
                <p className="mt-2 text-sm text-white leading-relaxed">{sanitizeText(verdict.nonObviousInsight)}</p>
              </>
            ) : null}
            {verdict.teach ? (
              <>
                <p className="mt-3 text-xs uppercase tracking-[0.14em] text-tertiary">Why this matters</p>
                <p className="mt-2 text-sm text-muted leading-relaxed">{sanitizeText(verdict.teach)}</p>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Part 3: What it means for your plan */}
        <div className="px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">What this means for your plan</p>
          <p className="mt-2 text-sm text-white leading-relaxed">{sanitizeText(verdict.explanation.whatToDoThisWeek)}</p>
          {verdict.explanation.whyItMatters ? (
            <p className="mt-2 text-sm text-muted leading-relaxed">{sanitizeText(verdict.explanation.whyItMatters)}</p>
          ) : null}
          {showNextCallChip ? (
            <div
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
              style={{ borderColor: match.border, color: match.color, backgroundColor: match.bg }}
            >
              {nextCallLabel}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
