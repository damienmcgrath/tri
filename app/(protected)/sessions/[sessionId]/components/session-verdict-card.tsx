"use client";

import { useState, useEffect, useCallback } from "react";

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
};

type Props = {
  sessionId: string;
  existingVerdict?: SessionVerdict | null;
  sessionCompleted: boolean;
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

export function SessionVerdictCard({ sessionId, existingVerdict, sessionCompleted }: Props) {
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

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-0">
        <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Session verdict</p>
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

      <div className="divide-y divide-[hsl(var(--border))]">
        {/* Part 1: Purpose Statement */}
        <div className="px-5 py-4">
          <p className="text-sm text-muted">{verdict.purpose_statement}</p>
          {verdict.training_block_context && (
            <p className="mt-1 text-xs text-tertiary">{verdict.training_block_context}</p>
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
            <p className="mt-3 text-sm text-white leading-relaxed">{verdict.execution_summary}</p>
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
                        <td className="px-3 py-2 text-muted">{mc.metric}</td>
                        <td className="px-3 py-2 text-right text-tertiary">{mc.target}</td>
                        <td className={`px-3 py-2 text-right font-medium ${
                          mc.assessment === "on_target" ? "text-success" :
                          mc.assessment === "missing" ? "text-tertiary" : "text-warning"
                        }`}>
                          {mc.actual}
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
                  <span className="text-muted leading-relaxed">{dev.description}</span>
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
                The verdict status reflects how well the actual execution matched the session&apos;s intended physiological stimulus.
                &quot;Achieved&quot; means the session delivered its intended training effect.
                &quot;Partial&quot; means some but not all targets were met.
                &quot;Missed&quot; means the session did not deliver its intended stimulus.
                Key deviations highlight specific metrics that diverged meaningfully from the plan.
              </p>
            </div>
          )}
        </div>

        {/* Part 3: Adaptation Signal */}
        <div className="px-5 py-4">
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">What this means for your plan</p>
          <p className="mt-2 text-sm text-white leading-relaxed">{verdict.adaptation_signal}</p>
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
