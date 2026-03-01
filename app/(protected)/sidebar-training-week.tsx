"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type TrainingWeek = {
  week_index: number;
  focus: "Build" | "Recovery" | "Taper" | "Race" | "Custom";
  week_start_date: string;
  target_minutes: number | null;
};

export function SidebarTrainingWeek({
  weekContext,
  showTrainingWeekBlock = true
}: {
  weekContext: TrainingWeek | null;
  showTrainingWeekBlock?: boolean;
}) {
  const pathname = usePathname();
  const shouldShowBlock = showTrainingWeekBlock && pathname !== "/dashboard";

  if (!shouldShowBlock) {
    return null;
  }

  return (
    <div className="hidden xl:block surface-subtle p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">Training week</p>
      {weekContext ? (
        <>
          <p className="mt-2 text-sm font-semibold">Week {weekContext.week_index} · {weekContext.focus}</p>
          <p className="mt-1 text-xs text-muted">Starts {weekContext.week_start_date}</p>
          <p className="mt-1 text-xs text-muted">Target: {weekContext.target_minutes ? `${weekContext.target_minutes} min` : "not set"}</p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Create or activate a plan to see week context.</p>
      )}
      <Link href="/plan/builder" className="mt-3 inline-flex text-xs text-accent underline">Manage plan</Link>
    </div>
  );
}
