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

const STATUS_CONFIG: Record<VerdictStatus, { label: string; icon: string; color: string; bg: string; border: string }> = {
  achieved: {
    label: "Session achieved its purpose",
    icon: "\u2713",
    color: "rgb(52,211,153)",
    bg: "rgba(52,211,153,0.1)",
    border: "rgba(52,211,153,0.3)"
  },
  partial: {
    label: "Session partially achieved its purpose",
    icon: "\u26A0",
    color: "rgb(251,191,36)",
    bg: "rgba(251,191,36,0.1)",
    border: "rgba(251,191,36,0.3)"
  },
  missed: {
    label: "Session did not achieve its intended purpose",
    icon: "\u2717",
    color: "rgb(248,113,113)",
    bg: "rgba(248,113,113,0.1)",
    border: "rgba(248,113,113,0.3)"
  },
  off_target: {
    label: "Session significantly off target",
    icon: "\u2717",
    color: "rgb(248,113,113)",
    bg: "rgba(248,113,113,0.1)",
    border: "rgba(248,113,113,0.3)"
  }
};

const ASSESSMENT_COLORS: Record<MetricComparison["assessment"], string> = {
  on_target: "text-success",
  above: "text-warning",
  below: "text-warning",
  missing: "text-tertiary"
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
          className="mt-2 text-xs text-tertiary hover:text-white"
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
    <article className="space-y-4">
      {/* Part 1: Purpose Statement */}
      <section className="surface border border-[hsl(var(--border))] p-5">
        <p className="label-base text-tertiary">Purpose</p>
        <p className="mt-1 text-sm text-muted">{verdict.purpose_statement}</p>
        {verdict.training_block_context && (
          <p className="mt-1 text-xs text-tertiary">{verdict.training_block_context}</p>
        )}
      </section>

      {/* Part 2: Execution Assessment */}
      <section
        className="surface border p-5"
        style={{ borderColor: status.border, backgroundColor: status.bg }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
                style={{ backgroundColor: status.bg, color: status.color, border: `1px solid ${status.border}` }}
              >
                {status.icon}
              </span>
              <p className="text-sm font-medium" style={{ color: status.color }}>
                {status.label}
              </p>
            </div>
            <p className="mt-3 text-sm text-white">{verdict.execution_summary}</p>
          </div>
        </div>

        {/* Metric comparisons */}
        {verdict.metric_comparisons.length > 0 && (
          <div className="mt-4">
            <div className="space-y-2">
              {visibleMetrics.map((mc, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-tertiary">{mc.metric}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-muted">Target: {mc.target}</span>
                    <span className={ASSESSMENT_COLORS[mc.assessment]}>
                      Actual: {mc.actual}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {hasMoreMetrics && (
              <button
                type="button"
                onClick={() => setShowAllMetrics(!showAllMetrics)}
                className="mt-2 text-xs text-tertiary hover:text-white"
              >
                {showAllMetrics ? "Show less" : `Show all ${verdict.metric_comparisons.length} metrics`}
              </button>
            )}
          </div>
        )}

        {/* Key deviations */}
        {verdict.key_deviations && verdict.key_deviations.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {verdict.key_deviations.map((dev, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={
                  dev.severity === "significant" ? "text-danger" :
                  dev.severity === "moderate" ? "text-warning" : "text-muted"
                }>
                  {dev.severity === "significant" ? "\u25CF" : dev.severity === "moderate" ? "\u25CB" : "\u00B7"}
                </span>
                <span className="text-muted">{dev.description}</span>
              </div>
            ))}
          </div>
        )}

        {/* Expandable explanation */}
        <button
          type="button"
          onClick={() => setShowExplanation(!showExplanation)}
          className="mt-3 text-xs text-tertiary hover:text-white"
        >
          {showExplanation ? "Hide explanation" : "What does this mean?"}
        </button>
        {showExplanation && (
          <div className="mt-2 rounded-lg bg-[rgba(0,0,0,0.2)] p-3">
            <p className="text-xs text-muted leading-relaxed">
              The verdict status reflects how well the actual execution matched the session&apos;s intended physiological stimulus.
              &quot;Achieved&quot; means the session delivered its intended training effect.
              &quot;Partial&quot; means some but not all targets were met.
              &quot;Missed&quot; means the session did not deliver its intended stimulus.
              Key deviations highlight specific metrics that diverged meaningfully from the plan.
            </p>
          </div>
        )}
      </section>

      {/* Part 3: Adaptation Signal */}
      <section className="surface border border-[hsl(var(--border))] p-5">
        <p className="label-base text-tertiary">What this means for your plan</p>
        <p className="mt-1 text-sm text-white">{verdict.adaptation_signal}</p>
        {verdict.adaptation_type && verdict.adaptation_type !== "proceed" && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] px-2.5 py-0.5 text-xs text-warning">
            {verdict.adaptation_type === "flag_review" && "Flagged for review"}
            {verdict.adaptation_type === "modify" && "Plan modification suggested"}
            {verdict.adaptation_type === "redistribute" && "Load redistribution suggested"}
          </div>
        )}
      </section>

      {/* Regenerate button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void fetchVerdict(true)}
          disabled={loading}
          className="text-xs text-tertiary hover:text-white disabled:opacity-40"
        >
          {loading ? "Regenerating..." : "Regenerate verdict"}
        </button>
      </div>
    </article>
  );
}
