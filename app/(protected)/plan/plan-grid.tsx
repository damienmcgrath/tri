"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays } from "@/lib/date-utils";
import { BlockHeader } from "./components/block-header";
import { BlockGrid } from "./components/block-grid";
import type { SessionPillSession } from "./components/session-pill";

type Plan = { id: string; name: string; start_date: string; duration_weeks: number };

type TrainingBlock = {
  id: string;
  plan_id: string | null;
  name: string;
  block_type: "Base" | "Build" | "Peak" | "Taper" | "Race" | "Recovery" | "Transition";
  start_date: string;
  end_date: string;
  sort_order: number;
  notes: string | null;
};

type TrainingWeek = {
  id: string;
  plan_id: string;
  block_id: string | null;
  week_index: number;
  week_start_date: string;
};

export type PlanGridSession = SessionPillSession & {
  week_id: string;
  date: string;
  day_order: number | null;
};

type Props = {
  plan: Plan | null;
  blocks: TrainingBlock[];
  weeks: TrainingWeek[];
  sessions: PlanGridSession[];
  selectedBlockId: string | null;
  adaptationsBySession: Record<string, boolean>;
  completedByWeek?: Record<string, Array<{ duration_minutes: number }>>;
};

function getLocalTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function PlanGrid({
  plan,
  blocks,
  weeks,
  sessions,
  selectedBlockId,
  adaptationsBySession,
  completedByWeek
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeBlockId, setActiveBlockId] = useState<string | null>(selectedBlockId);

  const sortedBlocks = useMemo(
    () => [...blocks].sort((a, b) => a.sort_order - b.sort_order),
    [blocks]
  );

  // Reconcile local state when the URL-driven prop changes (back/forward,
  // or any external link that mounts the same PlanGrid with a new ?block=).
  useEffect(() => {
    if (!sortedBlocks.length) {
      if (activeBlockId !== null) setActiveBlockId(null);
      return;
    }
    if (activeBlockId && sortedBlocks.some((block) => block.id === activeBlockId)) {
      if (selectedBlockId && selectedBlockId !== activeBlockId && sortedBlocks.some((b) => b.id === selectedBlockId)) {
        setActiveBlockId(selectedBlockId);
      }
      return;
    }
    setActiveBlockId(selectedBlockId ?? sortedBlocks[0].id);
  }, [sortedBlocks, selectedBlockId, activeBlockId]);

  const activeBlock = useMemo(
    () => sortedBlocks.find((block) => block.id === activeBlockId) ?? sortedBlocks[0] ?? null,
    [sortedBlocks, activeBlockId]
  );

  const sortedAllWeeks = useMemo(
    () => [...weeks].sort((a, b) => a.week_index - b.week_index),
    [weeks]
  );

  const weeksInBlock = useMemo(() => {
    if (!activeBlock) return sortedAllWeeks;
    return sortedAllWeeks.filter((week) => week.block_id === activeBlock.id);
  }, [sortedAllWeeks, activeBlock]);

  const sessionsInBlock = useMemo(() => {
    const weekIds = new Set(weeksInBlock.map((w) => w.id));
    return sessions.filter((session) => weekIds.has(session.week_id));
  }, [sessions, weeksInBlock]);

  const todayIso = getLocalTodayIso();

  const blockIndex = activeBlock ? sortedBlocks.findIndex((b) => b.id === activeBlock.id) + 1 : 0;
  const currentWeekIndexInBlock = useMemo(() => {
    if (!activeBlock) return null;
    const idx = weeksInBlock.findIndex((week) => {
      const end = addDays(week.week_start_date, 6);
      return week.week_start_date <= todayIso && todayIso <= end;
    });
    return idx >= 0 ? idx + 1 : null;
  }, [activeBlock, weeksInBlock, todayIso]);

  const handleSelectBlock = (blockId: string) => {
    setActiveBlockId(blockId);
    if (!plan) return;
    const params = new URLSearchParams();
    params.set("plan", plan.id);
    params.set("block", blockId);
    startTransition(() => {
      router.replace(`/plan?${params.toString()}`);
    });
  };

  if (!plan) {
    return (
      <div className="surface-subtle px-4 py-8 text-center text-sm text-tertiary">
        No training plan yet. Create a plan to get started.
      </div>
    );
  }

  if (!activeBlock && weeksInBlock.length === 0) {
    return (
      <div className="surface-subtle px-4 py-8 text-center text-sm text-tertiary">
        No training blocks have been set up for this plan yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activeBlock ? (
        <BlockHeader
          block={activeBlock}
          blocks={sortedBlocks}
          blockIndex={blockIndex}
          currentWeekIndexInBlock={currentWeekIndexInBlock}
          totalWeeksInBlock={weeksInBlock.length}
          onSelectBlock={handleSelectBlock}
        />
      ) : null}
      <BlockGrid
        weeks={weeksInBlock}
        sessions={sessionsInBlock}
        todayIso={todayIso}
        adaptationsBySession={adaptationsBySession}
        completedByWeek={completedByWeek}
      />
    </div>
  );
}
