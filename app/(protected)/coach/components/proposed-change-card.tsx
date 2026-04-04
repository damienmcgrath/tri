"use client";

import { useState } from "react";

type ProposedChange = {
  id: string;
  title: string;
  changeSummary: string;
  rationale: string;
  targetSessionId?: string | null;
};

type Props = {
  change: ProposedChange;
  onApprove?: (changeId: string) => void;
  onReject?: (changeId: string) => void;
};

export function ProposedChangeCard({ change, onApprove, onReject }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");

  function handleApprove() {
    setStatus("approved");
    onApprove?.(change.id);
  }

  function handleReject() {
    setStatus("rejected");
    onReject?.(change.id);
  }

  return (
    <div className="my-2 rounded-lg border border-accent/30 bg-accent/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <h4 className="text-sm font-medium text-surface-foreground">
            {change.title}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {change.changeSummary}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 text-xs text-muted-foreground hover:text-surface-foreground"
        >
          {expanded ? "Hide" : "Why?"}
        </button>
      </div>

      {expanded && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {change.rationale}
        </p>
      )}

      {status === "pending" && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={handleApprove}
            className="rounded-md bg-success/20 px-3 py-1 text-xs font-medium text-success transition hover:bg-success/30"
          >
            Approve
          </button>
          <button
            onClick={handleReject}
            className="rounded-md bg-danger/20 px-3 py-1 text-xs font-medium text-danger transition hover:bg-danger/30"
          >
            Reject
          </button>
        </div>
      )}

      {status === "approved" && (
        <p className="mt-2 text-xs font-medium text-success">Applied</p>
      )}
      {status === "rejected" && (
        <p className="mt-2 text-xs font-medium text-muted-foreground">Dismissed</p>
      )}
    </div>
  );
}
