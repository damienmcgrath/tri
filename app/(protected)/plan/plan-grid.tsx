"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays } from "@/lib/date-utils";
import { BlockHeader } from "./components/block-header";
import { BlockGrid } from "./components/block-grid";
import type { SessionPillSession } from "./components/session-pill";
import { SessionDrawer, type AdaptationEntry, type DrawerSession } from "./components/session-drawer";

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
  plan_id?: string | null;
};

type Props = {
  plan: Plan | null;
  blocks: TrainingBlock[];
  weeks: TrainingWeek[];
  sessions: PlanGridSession[];
  selectedBlockId: string | null;
  adaptationsBySession: Record<string, boolean>;
  adaptationEntriesBySession?: Record<string, AdaptationEntry[]>;
  completedByWeek?: Record<string, Array<{ duration_minutes: number }>>;
  initialOpenSessionId?: string | null;
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
  adaptationEntriesBySession,
  completedByWeek,
  initialOpenSessionId
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeBlockId, setActiveBlockId] = useState<string | null>(selectedBlockId);
  const [localSessions, setLocalSessions] = useState<PlanGridSession[]>(sessions);
  const [openSessionId, setOpenSessionId] = useState<string | null>(initialOpenSessionId ?? null);

  useEffect(() => {
    setLocalSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    setOpenSessionId(initialOpenSessionId ?? null);
  }, [initialOpenSessionId]);

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

  const sortedAllWeeks = useMemo(
    () => [...weeks].sort((a, b) => a.week_index - b.week_index),
    [weeks]
  );

  // If a deep-linked session lives in a different block than the current
  // selection, switch the active block to the one that contains it so the
  // pill is visible behind the drawer. Also sync the URL so a subsequent copy
  // of the URL reflects the block the user is actually looking at.
  useEffect(() => {
    if (!openSessionId) return;
    const target = sessions.find((session) => session.id === openSessionId);
    if (!target) return;
    const targetWeek = sortedAllWeeks.find((week) => week.id === target.week_id);
    if (!targetWeek?.block_id) return;
    if (targetWeek.block_id === activeBlockId) return;
    setActiveBlockId(targetWeek.block_id);
    if (!plan) return;
    const params = new URLSearchParams();
    params.set("plan", plan.id);
    params.set("block", targetWeek.block_id);
    params.set("session", openSessionId);
    startTransition(() => {
      router.replace(`/plan?${params.toString()}`);
    });
  }, [openSessionId, sessions, sortedAllWeeks, activeBlockId, plan, router]);

  const activeBlock = useMemo(
    () => sortedBlocks.find((block) => block.id === activeBlockId) ?? sortedBlocks[0] ?? null,
    [sortedBlocks, activeBlockId]
  );

  const weeksInBlock = useMemo(() => {
    if (!activeBlock) return sortedAllWeeks;
    return sortedAllWeeks.filter((week) => week.block_id === activeBlock.id);
  }, [sortedAllWeeks, activeBlock]);

  const sessionsInBlock = useMemo(() => {
    const weekIds = new Set(weeksInBlock.map((w) => w.id));
    return localSessions.filter((session) => weekIds.has(session.week_id));
  }, [localSessions, weeksInBlock]);

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

  const buildPlanUrl = useCallback(
    (extras: Record<string, string | null>) => {
      const params = new URLSearchParams();
      if (plan) params.set("plan", plan.id);
      if (activeBlockId) params.set("block", activeBlockId);
      for (const [key, value] of Object.entries(extras)) {
        if (value === null) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      return qs ? `/plan?${qs}` : "/plan";
    },
    [plan, activeBlockId]
  );

  const handleSelectBlock = (blockId: string) => {
    setActiveBlockId(blockId);
    if (!plan) return;
    const params = new URLSearchParams();
    params.set("plan", plan.id);
    params.set("block", blockId);
    if (openSessionId) params.set("session", openSessionId);
    startTransition(() => {
      router.replace(`/plan?${params.toString()}`);
    });
  };

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      setOpenSessionId(sessionId);
      startTransition(() => {
        router.replace(buildPlanUrl({ session: sessionId }));
      });
    },
    [router, buildPlanUrl]
  );

  const handleCloseDrawer = useCallback(() => {
    setOpenSessionId(null);
    startTransition(() => {
      router.replace(buildPlanUrl({ session: null }));
    });
  }, [router, buildPlanUrl]);

  const handleSessionSaved = useCallback((next: DrawerSession) => {
    setLocalSessions((prev) =>
      prev.map((session) =>
        session.id === next.id
          ? {
              ...session,
              sport: next.sport,
              type: next.type,
              session_name: next.session_name,
              intent_category: next.intent_category,
              duration_minutes: next.duration_minutes,
              target: next.target,
              notes: next.notes,
              session_role: next.session_role,
              is_key: next.is_key
            }
          : session
      )
    );
  }, []);

  const handleSessionDeleted = useCallback((id: string) => {
    setLocalSessions((prev) => prev.filter((session) => session.id !== id));
  }, []);

  const drawerSession = useMemo<DrawerSession | null>(() => {
    if (!openSessionId) return null;
    const found = localSessions.find((session) => session.id === openSessionId);
    if (!found) return null;
    return {
      id: found.id,
      plan_id: found.plan_id ?? plan?.id ?? "",
      week_id: found.week_id,
      date: found.date,
      sport: found.sport,
      type: found.type,
      session_name: found.session_name ?? null,
      intent_category: found.intent_category ?? null,
      duration_minutes: found.duration_minutes,
      target: found.target ?? null,
      notes: found.notes ?? null,
      session_role: (found.session_role ?? null) as string | null,
      is_key: found.is_key ?? null
    };
  }, [openSessionId, localSessions, plan]);

  const drawerAdaptations = useMemo<AdaptationEntry[]>(() => {
    if (!openSessionId) return [];
    return adaptationEntriesBySession?.[openSessionId] ?? [];
  }, [openSessionId, adaptationEntriesBySession]);

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
        onSelectSession={handleOpenSession}
      />
      <SessionDrawer
        session={drawerSession}
        adaptations={drawerAdaptations}
        open={drawerSession !== null}
        onClose={handleCloseDrawer}
        onSaved={handleSessionSaved}
        onDeleted={handleSessionDeleted}
      />
    </div>
  );
}
