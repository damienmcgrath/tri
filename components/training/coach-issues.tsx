import Link from "next/link";
import { StatusPill } from "@/components/training/status-pill";
import { REVIEW_OUTCOME_META, type ReviewOutcomeState } from "@/lib/training/semantics";

export type IssueListItem = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  issueType: string;
  reviewOutcome: ReviewOutcomeState;
  whyItMatters: string;
  recommendation: string;
  summary: string;
};

export function IssueList({
  issues,
  selectedIssueId,
  onSelect
}: {
  issues: IssueListItem[];
  selectedIssueId: string | null;
  onSelect: (issueId: string) => void;
}) {
  return (
    <div className="space-y-2">
      {issues.length === 0 ? (
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4 text-sm text-muted">
          No flagged issues right now. Reviewed sessions are either on target or still waiting for more evidence.
        </div>
      ) : (
        issues.map((issue) => {
          const meta = REVIEW_OUTCOME_META[issue.reviewOutcome];
          const selected = issue.id === selectedIssueId;

          return (
            <button
              key={issue.id}
              type="button"
              onClick={() => onSelect(issue.id)}
              className={`w-full rounded-2xl border p-4 text-left transition ${selected ? "border-[hsl(var(--accent-performance)/0.44)] bg-[hsl(var(--accent-performance)/0.08)]" : "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] hover:border-[hsl(var(--accent-performance)/0.28)]"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-[hsl(var(--text-primary))]">{issue.sessionTitle}</p>
                  <p className="mt-1 text-xs text-muted">{issue.issueType}</p>
                </div>
                <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} compact />
              </div>
              <p className="mt-3 text-sm text-muted">{issue.whyItMatters}</p>
            </button>
          );
        })
      )}
    </div>
  );
}

export function IssueDetailPanel({ issue }: { issue: IssueListItem | null }) {
  if (!issue) {
    return (
      <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-5">
        <p className="text-sm text-muted">Select an issue to see what happened, why it matters, and what to ask Coach next.</p>
      </div>
    );
  }

  const meta = REVIEW_OUTCOME_META[issue.reviewOutcome];

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--surface-subtle)/0.7),hsl(var(--surface-subtle)/0.38))] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Selected issue</p>
          <h3 className="mt-1 text-lg font-semibold">{issue.sessionTitle}</h3>
          <p className="mt-2 text-sm text-muted">{issue.issueType}</p>
        </div>
        <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} compact />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">What happened</p>
          <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{issue.summary}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Why it matters</p>
          <p className="mt-2 text-sm text-muted">{issue.whyItMatters}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Recommendation</p>
        <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{issue.recommendation}</p>
      </div>

      <div className="mt-4">
        <Link href={`/sessions/${issue.sessionId}`} className="btn-secondary px-3 py-1.5 text-xs">
          Open Session Review
        </Link>
      </div>
    </div>
  );
}
