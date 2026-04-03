"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ActivityMetricsBackfillButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleBackfill() {
    startTransition(async () => {
      setMessage(null);

      try {
        const response = await fetch("/api/uploads/activities/backfill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ all: true })
        });
        const payload = (await response.json()) as {
          attempted?: number;
          updated?: number;
          skipped?: number;
          failed?: number;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not backfill activity metrics.");
        }

        setMessage(
          payload.attempted === 0
            ? "No uploaded activities needed activity-metrics backfill."
            : `Backfilled ${payload.updated ?? 0} of ${payload.attempted ?? 0} uploaded activities.${payload.skipped ? ` Skipped ${payload.skipped}.` : ""}${payload.failed ? ` Failed ${payload.failed}.` : ""}`
        );
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not backfill activity metrics.");
      }
    });
  }

  return (
    <article className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-accent">Data tools</p>
          <h2 className="mt-1 text-lg font-semibold">Backfill richer activity metrics</h2>
          <p className="mt-1 text-sm text-muted">Reparse retained uploaded FIT/TCX files so older activities gain the richer metrics now used by reviews and debriefs.</p>
        </div>
        <button type="button" onClick={handleBackfill} disabled={isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
          {isPending ? "Backfilling..." : "Run activity backfill"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}
    </article>
  );
}
