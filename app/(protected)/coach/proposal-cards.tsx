"use client";

import { useOptimistic, useTransition } from "react";
import { approveProposalAction, rejectProposalAction } from "./proposal-actions";

type Proposal = {
  id: string;
  title: string;
  rationale: string;
  change_summary: string;
  proposed_date: string | null;
  proposed_duration_minutes: number | null;
  status: string;
  created_at: string;
};

type ProposalCardsProps = {
  proposals: Proposal[];
};

type OptimisticState = {
  ids: Set<string>;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center rounded-md border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.1)] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--success))]">
        Approved
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[11px] font-medium text-[rgba(255,255,255,0.4)]">
        Dismissed
      </span>
    );
  }
  return null;
}

function ProposalCard({ proposal, onApprove, onDismiss, isPending }: {
  proposal: Proposal;
  onApprove: () => void;
  onDismiss: () => void;
  isPending: boolean;
}) {
  const isPendingStatus = proposal.status === "pending";

  return (
    <article className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] p-4 transition-opacity duration-300">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent">Coach proposal</p>
          <h3 className="mt-1 text-sm font-semibold leading-snug text-[rgba(255,255,255,0.9)]">{proposal.title}</h3>
        </div>
        {!isPendingStatus && <StatusBadge status={proposal.status} />}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-[rgba(255,255,255,0.6)]">{proposal.rationale}</p>

      <div className="mt-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-3">
        <p className="text-[11px] uppercase tracking-[0.12em] text-[rgba(255,255,255,0.35)]">Proposed change</p>
        <p className="mt-1 text-sm leading-relaxed text-[rgba(255,255,255,0.75)]">{proposal.change_summary}</p>
      </div>

      {(proposal.proposed_date || proposal.proposed_duration_minutes) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {proposal.proposed_date && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-xs text-[rgba(255,255,255,0.6)]">
              <span className="text-[rgba(255,255,255,0.3)]">Date</span>
              {proposal.proposed_date}
            </span>
          )}
          {proposal.proposed_duration_minutes && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-2.5 py-1 text-xs text-[rgba(255,255,255,0.6)]">
              <span className="text-[rgba(255,255,255,0.3)]">Duration</span>
              {proposal.proposed_duration_minutes} min
            </span>
          )}
        </div>
      )}

      {isPendingStatus && (
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={onApprove}
            disabled={isPending}
            className="rounded-lg bg-[hsl(var(--accent))] px-3 py-1.5 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={onDismiss}
            disabled={isPending}
            className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-1.5 text-xs font-medium text-[rgba(255,255,255,0.6)] transition-opacity hover:border-[rgba(255,255,255,0.2)] hover:text-[rgba(255,255,255,0.8)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}
    </article>
  );
}

export function ProposalCards({ proposals }: ProposalCardsProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticHidden, addOptimisticHidden] = useOptimistic<OptimisticState, string>(
    { ids: new Set<string>() },
    (state, id) => ({ ids: new Set([...state.ids, id]) })
  );

  if (proposals.length === 0) {
    return null;
  }

  const visible = proposals.filter((p) => !optimisticHidden.ids.has(p.id));

  if (visible.length === 0) {
    return null;
  }

  function handleApprove(proposalId: string) {
    startTransition(async () => {
      addOptimisticHidden(proposalId);
      await approveProposalAction(proposalId);
    });
  }

  function handleDismiss(proposalId: string) {
    startTransition(async () => {
      addOptimisticHidden(proposalId);
      await rejectProposalAction(proposalId);
    });
  }

  return (
    <section className="space-y-2.5">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[rgba(255,255,255,0.25)]">Plan proposals</p>
      </div>
      <div className="space-y-3">
        {visible.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            onApprove={() => handleApprove(proposal.id)}
            onDismiss={() => handleDismiss(proposal.id)}
            isPending={isPending}
          />
        ))}
      </div>
    </section>
  );
}
