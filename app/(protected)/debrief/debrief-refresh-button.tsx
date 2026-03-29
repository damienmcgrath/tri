"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  weekStart: string;
  label?: string;
};

export function DebriefRefreshButton({ weekStart, label = "Refresh" }: Props) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function onRefresh() {
    setIsRefreshing(true);

    try {
      const response = await fetch("/api/weekly-debrief/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart })
      });
      const payload = (await response.json()) as { error?: string; readiness?: { isReady?: boolean; reason?: string } };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not refresh Weekly Debrief.");
      }
      router.refresh();
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="relative flex min-w-[88px] items-center">
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="debrief-pill transition hover:border-[hsl(var(--accent)/0.5)] hover:text-bright disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRefreshing ? "Refreshing..." : label}
      </button>
    </div>
  );
}
