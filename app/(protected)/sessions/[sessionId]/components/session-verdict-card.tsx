"use client";

import { useState, useEffect, useCallback } from "react";

/** Sanitize raw camelCase field names that may exist in stored verdict text. */
function sanitizeText(text: string): string {
  let result = text;
  // Handle intervalCompletion(Pct) with comparison operators and values
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*[≥>=]+\s*1(?:\.0)?\b/gi, "all planned intervals completed");
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*([≥≤]|>=|<=|>|<)\s*([\d.]+)/gi, (_m, op, v) => {
    const pct = Math.round(parseFloat(v) * 100);
    if (pct >= 100) return "all planned intervals completed";
    const isLessThan = /[<≤]/.test(op);
    const isStrict = op === "<" || op === ">";
    if (isLessThan) {
      return isStrict
        ? `less than ${pct}% of planned intervals completed`
        : `at most ${pct}% of planned intervals completed`;
    }
    return isStrict
      ? `more than ${pct}% of planned intervals completed`
      : `at least ${pct}% of planned intervals completed`;
  });
  result = result.replace(/\bintervalCompletion(?:Pct)?\s*[=:]\s*([\d.]+)/gi, (_m, v) => {
    const pct = Math.round(parseFloat(v) * 100);
    return pct >= 100 ? "all planned intervals completed" : `${pct}% of planned intervals completed`;
  });
  // Handle (intervalCompletionPct <value>) pattern in parentheses
  result = result.replace(/\(intervalCompletion(?:Pct)?\s+([\d.]+)\)/gi, (_m, v) => {
    const pct = Math.round(parseFloat(v) * 100);
    return pct >= 100 ? "(all planned intervals completed)" : `(${pct}% of planned intervals completed)`;
  });
  // Replace remaining raw field names
  const fieldMap: [RegExp, string][] = [
    [/\bintervalCompletion(?:Pct)?\b/gi, "interval completion"],
    [/\btimeAboveTargetPct\b/gi, "time above target"],
    [/\bavgPower\b/gi, "avg power"],
    [/\bavgHr\b/gi, "avg heart rate"],
    [/\bavgHR\b/g, "avg HR"],
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
  // Expand "NP" and "VI" abbreviations in metric contexts
  result = result.replace(/\bNP\b(?=\s+(?:remains|target|within|of|from|rose|is|was|at|near|≈|~|\d))/g, "normalized power");
  result = result.replace(/today's NP\b/g, "today's normalized power");
  result = result.replace(/\bVI\b(?=\s+(?:of|was|is|at|\d))/g, "variability index");
  return result;
}

type VerdictStatus = "achieved" | "partial" | "missed" | "off_target";
type AdaptationType = "proceed" | "flag_review" | "modify" | "redistribute";

type MetricComparison = {
  metric: string;
  target: string;
  actual: string;
  assessment: "on_target" | "above" | "below" | "missing";
};

type Deviation = {
  metric: string;
  description: string;
  severity: "minor" | "moderate" | "significant";
};

type SessionVerdict = {
  id?: string;
  purpose_statement: string;
  training_block_context: string | null;
  execution_summary: string;
  verdict_status: VerdictStatus;
  metric_comparisons: MetricComparison[];
  key_deviations: Deviation[] | null;
  adaptation_signal: string;
  adaptation_type: AdaptationType | null;
  stale_reason?: string | null;
};

function getStaleLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case "feel_updated":
      return "New feel captured — refresh for updated verdict";
    case "activity_rematched":
      return "Activity re-linked — refresh for updated verdict";
    case "plan_edited":
      return "Plan updated — refresh for updated verdict";
    case "prompt_version_bump":
      return "Coach logic updated — refresh for updated verdict";
    default:
      return "New info available — refresh for updated verdict";
  }
}

type Props = {
  sessionId: string;
  existingVerdict?: SessionVerdict | null;
  sessionCompleted: boolean;
  discipline?: string | null;
};

const STATUS_CONFIG: Record<VerdictStatus, { label: string; color: string; bg: string; border: string }> = {
  achieved: {
    label: "Session achieved its purpose",
    color: "rgb(52,211,153)",
    bg: "rgba(52,211,153,0.1)",
    border: "rgba(52,211,153,0.3)"
  },
  partial: {
    label: "Partially achieved its purpose",
    color: "rgb(251,191,36)",
    bg: "rgba(251,191,36,0.1)",
    border: "rgba(251,191,36,0.3)"
  },
  missed: {
    label: "Did not achieve its purpose",
    color: "rgb(248,113,113)",
    bg: "rgba(248,113,113,0.1)",
    border: "rgba(248,113,113,0.3)"
  },
  off_target: {
    label: "Significantly off target",
    color: "rgb(248,113,113)",
    bg: "rgba(248,113,113,0.1)",
    border: "rgba(248,113,113,0.3)"
  }
};

function StatusIcon({ status }: { status: VerdictStatus }) {
  const color = STATUS_CONFIG[status].color;
  if (status === "achieved") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color }} aria-hidden="true">
        <path d="M11.5 3.5L5.5 10L2.5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "partial") {
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

function DeviationIcon({ severity }: { severity: Deviation["severity"] }) {
  if (severity === "significant") {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" className="mt-[5px] shrink-0 text-danger" aria-hidden="true">
        <circle cx="4" cy="4" r="4" fill="currentColor" />
      </svg>
    );
  }
  if (severity === "moderate") {
    return (
      <svg width="8" height="8" viewBox="0 0 8 8" className="mt-[5px] shrink-0 text-warning" aria-hidden="true">
        <circle cx="4" cy="4" r="3" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    );
  }
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" className="mt-[5px] shrink-0 text-muted" aria-hidden="true">
      <circle cx="4" cy="4" r="2" fill="currentColor" />
    </svg>
  );
}

const ADAPTATION_LABELS: Record<string, string> = {
  flag_review: "Flagged",
  modify: "Modification suggested",
  redistribute: "Redistribution suggested"
};

function getContextualExplanation(verdictStatus: VerdictStatus, discipline: string | null | undefined, deviations: Deviation[] | null): string {
  const statusExplanation: Record<VerdictStatus, string> = {
    achieved: "The session delivered its intended physiological stimulus — the training effect you planned for landed.",
    partial: "Some of the intended training stimulus landed, but meaningful gaps reduce the session's effectiveness.",
    missed: "The session did not deliver its intended stimulus — the planned training effect was largely missed.",
    off_target: "Execution diverged significantly from the plan — the session delivered a different stimulus than intended."
  };

  let explanation = statusExplanation[verdictStatus];

  // Add sport-specific context about what deviations mean
  if (deviations && deviations.length > 0) {
    const sport = (discipline ?? "").toLowerCase();
    const deviationTopics = deviations.map(d => d.metric.toLowerCase()).join(", ");

    if (sport === "swim" && /interval|block|set/.test(deviationTopics)) {
      explanation += " For swim, completing the full set structure matters more than raw pace — missing blocks reduces the volume of specific stimulus your body adapts to.";
    } else if (sport === "bike" && /power|block|interval/.test(deviationTopics)) {
      explanation += " For cycling, completing sustained power blocks at the intended intensity is the primary adaptation driver — cutting blocks short reduces the time-at-intensity your body needs to improve.";
    } else if (sport === "run" && /pace|hr|drift/.test(deviationTopics)) {
      explanation += " For running, the combination of pace control and cardiac response tells you whether the effort was sustainable or pushed into fatigue territory.";
    } else if (/completion|interval|block|rep/.test(deviationTopics)) {
      explanation += " Completing planned work blocks matters because each rep or block contributes a specific dose of training stimulus — cutting them short reduces the intended adaptation.";
    }
  }

  return explanation;
}

export function SessionVerdictCard({ sessionId, existingVerdict, sessionCompleted, discipline }: Props) {
  const [verdict, setVerdict] = useState<SessionVerdict | null>(existingVerdict ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllMetrics, setShowAllMetrics] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  const fetchVerdict = useCallback(async (regenerate = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/session-verdicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, regenerate })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to generate verdict.");
      }
      const data = await res.json();
      setVerdict(data.verdict);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate verdict.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!verdict && sessionCompleted && !loading && !error) {
      void fetchVerdict();
    }
  }, [verdict, sessionCompleted, loading, error, fetchVerdict]);

  if (!sessionCompleted) return null;

  if (loading && !verdict) {
    return (
      <article className="surface border border-[hsl(var(--border))] p-5">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(190,255,0,0.3)] border-t-[var(--color-accent)]" />
          <p className="text-sm text-muted">Generating session verdict...</p>
        </div>
      </article>
    );
  }

  if (error && !verdict) {
    return (
      <article className="surface border border-[hsl(var(--border))] p-5">
        <p className="text-sm text-danger">{error}</p>
        <button
          type="button"
          onClick={() => void fetchVerdict()}
          className="mt-2 rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-tertiary hover:border-[rgba(255,255,255,0.25)] hover:text-white"
        >
          Retry
        </button>
      </article>
    );
  }

  if (!verdict) return null;

  const status = STATUS_CONFIG[verdict.verdict_status];
  const visibleMetrics = showAllMetrics ? verdict.metric_comparisons : verdict.metric_comparisons.slice(0, 3);
  const hasMoreMetrics = verdict.metric_comparisons.length > 3;

  const staleLabel = getStaleLabel(verdict.stale_reason);

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-0">
        <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Session verdict</p>
        <div className="flex items-center gap-2">
          {staleLabel && (
            <span
              className="hidden items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 text-[11px] text-warning sm:inline-flex"
              title={staleLabel}
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="6" cy="6" r="1.5" fill="currentColor" />
              </svg>
              {staleLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => void fetchVerdict(true)}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs text-tertiary hover:border-[rgba(255,255,255,0.25)] hover:text-white disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            {loading ? "Regenerating\u2026" : "Regenerate"}
          </button>
        </div>
      </div>
      {staleLabel && (
        <div className="px-5 pt-2 sm:hidden">
          <p className="text-[11px] text-warning">{staleLabel}</p>
        </div>
      )}

      <div className="divide-y divide-[hsl(var(--border))]">
        {/* Part 1: Purpose Statement */}
        <div className="px-5 py-4">
          <p className="text-sm text-muted">{sanitizeText(verdict.purpose_statement)}</p>
          {verdict.training_block_context && (
            <p className="mt-1 text-xs text-tertiary">{sanitizeText(verdict.training_block_context)}</p>
          )}
        </div>

        {/* Part 2: Execution Assessment */}
        <div className="px-5 py-4">
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: status.border, backgroundColor: status.bg }}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{ backgroundColor: status.bg, color: status.color, border: `1.5px solid ${status.border}` }}
              >
                <StatusIcon status={verdict.verdict_status} />
              </span>
              <p className="text-sm font-medium" style={{ color: status.color }}>
                {status.label}
              </p>
            </div>
            <p className="mt-3 text-sm text-white leading-relaxed">{sanitizeText(verdict.execution_summary)}</p>
          </div>

          {/* Metric comparisons */}
          {verdict.metric_comparisons.length > 0 && (
            <div className="mt-4">
              <div className="overflow-hidden rounded-lg border border-[hsl(var(--border))]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[rgba(255,255,255,0.03)]">
                      <th className="px-3 py-2 text-left text-xs font-normal text-tertiary">Metric</th>
                      <th className="px-3 py-2 text-right text-xs font-normal text-tertiary">Target</th>
                      <th className="px-3 py-2 text-right text-xs font-normal text-tertiary">Actual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[hsl(var(--border))]">
                    {visibleMetrics.map((mc, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-muted">{sanitizeText(mc.metric)}</td>
                        <td className="px-3 py-2 text-right text-tertiary">{sanitizeText(mc.target)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${
                          mc.assessment === "on_target" ? "text-success" :
                          mc.assessment === "missing" ? "text-tertiary" : "text-warning"
                        }`}>
                          {sanitizeText(mc.actual)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMoreMetrics && (
                <button
                  type="button"
                  onClick={() => setShowAllMetrics(!showAllMetrics)}
                  className="mt-2 text-xs text-tertiary hover:text-white"
                >
                  {showAllMetrics ? "Show fewer" : `Show all ${verdict.metric_comparisons.length} metrics`}
                </button>
              )}
            </div>
          )}

          {/* Key deviations */}
          {verdict.key_deviations && verdict.key_deviations.length > 0 && (
            <div className="mt-4 space-y-2">
              {verdict.key_deviations.map((dev, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <DeviationIcon severity={dev.severity} />
                  <span className="text-muted leading-relaxed">{sanitizeText(dev.description)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Expandable explanation */}
          <button
            type="button"
            onClick={() => setShowExplanation(!showExplanation)}
            className="mt-3 rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs text-tertiary hover:border-[rgba(255,255,255,0.25)] hover:text-white"
          >
            {showExplanation ? "Hide explanation" : "What does this mean?"}
          </button>
          {showExplanation && (
            <div className="mt-2 rounded-lg bg-[rgba(0,0,0,0.2)] p-3">
              <p className="text-sm text-muted leading-relaxed">
                {getContextualExplanation(verdict.verdict_status, discipline, verdict.key_deviations)}
              </p>
            </div>
          )}
        </div>

        {/* Part 3: Adaptation Signal */}
        <div className="px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">What this means for your plan</p>
          <p className="mt-2 text-sm text-white leading-relaxed">{sanitizeText(verdict.adaptation_signal)}</p>
          {verdict.adaptation_type && verdict.adaptation_type !== "proceed" && (
            <div
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
              style={{ borderColor: status.border, color: status.color, backgroundColor: status.bg }}
            >
              {ADAPTATION_LABELS[verdict.adaptation_type] ?? verdict.adaptation_type}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
