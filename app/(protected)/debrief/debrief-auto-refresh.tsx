"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  weekStart: string;
  enabled: boolean;
};

export function DebriefAutoRefresh({ weekStart, enabled }: Props) {
  const router = useRouter();
  const hasFiredRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled || hasFiredRef.current) return;
    hasFiredRef.current = true;

    setIsRefreshing(true);

    (async () => {
      try {
        const response = await fetch("/api/weekly-debrief/refresh", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ weekStart })
        });
        if (response.ok) {
          router.refresh();
        }
      } catch {
        // Swallow — stale artifact stays visible; user can retry via DebriefRefreshButton.
      } finally {
        setIsRefreshing(false);
      }
    })();
  }, [enabled, weekStart, router]);

  if (!isRefreshing) return null;

  return (
    <span role="status" className="debrief-pill signal-load inline-flex items-center gap-2">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--accent-performance))]" />
      Refreshing weekly brief…
    </span>
  );
}
