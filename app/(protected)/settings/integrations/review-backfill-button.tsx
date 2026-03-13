"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ReviewBackfillButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleRunReviews() {
    startTransition(async () => {
      setMessage(null);

      try {
        const response = await fetch("/api/coach/review-backfill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ all: true })
        });
        const payload = (await response.json()) as { attempted?: number; updated?: number; error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not run execution reviews.");
        }

        setMessage(
          payload.attempted === 0
            ? "No confirmed linked sessions were available to review."
            : `Reviewed ${payload.updated ?? 0} of ${payload.attempted ?? 0} confirmed linked sessions.`
        );
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not run execution reviews.");
      }
    });
  }

  return (
    <article className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-accent">Execution reviews</p>
          <h2 className="mt-1 text-lg font-semibold">Run reviews for linked sessions</h2>
          <p className="mt-1 text-sm text-muted">Manually trigger the execution review process for all confirmed linked sessions.</p>
        </div>
        <button type="button" onClick={handleRunReviews} disabled={isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
          {isPending ? "Running reviews..." : "Run execution reviews"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </article>
  );
}
