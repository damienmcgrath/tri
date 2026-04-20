"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  blockEnd?: string;
  label?: string;
};

export function ProgressReportRefreshButton({ blockEnd, label = "Refresh" }: Props) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRefresh() {
    setIsRefreshing(true);
    setError(null);

    try {
      const response = await fetch("/api/progress-report/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blockEnd ? { blockEnd } : {})
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not refresh progress report.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh.");
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="debrief-pill transition hover:border-[hsl(var(--accent)/0.5)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRefreshing ? "Refreshing…" : label}
      </button>
      {error ? <p className="text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}
