"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { addDays } from "@/lib/date-utils";
import { inferDefaultDiscipline } from "@/lib/training/discipline-defaults";
import { BlockHeader } from "./components/block-header";
import { BlockGrid } from "./components/block-grid";
import { PhoneWeekView } from "./components/phone-week-view";
import { CellContextMenu, type CellContextMenuAction } from "./components/cell-context-menu";
import {
  SessionPillContextMenu,
  buildWeekDays,
  type SessionPillContextMenuAction
} from "./components/session-pill-context-menu";
import type { SessionPillSession } from "./components/session-pill";
import { SessionDrawer, type AdaptationEntry, type DrawerCreateCell, type DrawerSession } from "./components/session-drawer";
import { useBlockGridDndSensors } from "./components/use-block-grid-dnd";
import {
  convertSessionToRestAction,
  createSessionFromCellAction,
  duplicateSessionAction,
  deleteSessionAction,
  rescheduleSessionAction,
  updateSessionDetailsAction
} from "./actions";

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
  const [createCell, setCreateCell] = useState<DrawerCreateCell | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    weekId: string;
    date: string;
    x: number;
    y: number;
  } | null>(null);
  const [pillContextMenu, setPillContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [lastEditedDiscipline, setLastEditedDiscipline] = useState<string | null>(null);

  const dndSensors = useBlockGridDndSensors();

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
    setLastEditedDiscipline(next.sport);
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

  const appendCreatedSession = useCallback(
    (created: DrawerSession) => {
      setLocalSessions((prev) => [
        ...prev,
        {
          id: created.id,
          sport: created.sport,
          type: created.type,
          session_name: created.session_name,
          intent_category: created.intent_category,
          target: created.target,
          notes: created.notes,
          duration_minutes: created.duration_minutes,
          session_role: created.session_role,
          is_key: created.is_key,
          status: "planned",
          week_id: created.week_id,
          date: created.date,
          day_order: null,
          plan_id: created.plan_id ?? plan?.id ?? null
        }
      ]);
      setLastEditedDiscipline(created.sport);
    },
    [plan]
  );

  const handleSessionCreated = useCallback(
    (created: DrawerSession) => {
      appendCreatedSession(created);
    },
    [appendCreatedSession]
  );

  const sessionsInActiveBlock = useCallback(
    (weekIds: Set<string>) => localSessions.filter((session) => weekIds.has(session.week_id)),
    [localSessions]
  );

  const handleEmptyCellClick = useCallback(
    (weekId: string, date: string) => {
      if (!plan) return;
      const weekIds = new Set(weeks.filter((w) => w.block_id === activeBlockId).map((w) => w.id));
      const blockSessions = sessionsInActiveBlock(weekIds);
      const defaultDiscipline = inferDefaultDiscipline({
        cellDate: date,
        weekSessions: blockSessions.map((s) => ({ date: s.date, sport: s.sport })),
        lastEditedDiscipline
      });
      setContextMenu(null);
      setCreateCell({
        plan_id: plan.id,
        week_id: weekId,
        date,
        defaultDiscipline
      });
    },
    [plan, weeks, activeBlockId, sessionsInActiveBlock, lastEditedDiscipline]
  );

  const handleEmptyCellContextMenu = useCallback(
    (weekId: string, date: string, x: number, y: number) => {
      setContextMenu({ weekId, date, x, y });
    },
    []
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const closeCreateDrawer = useCallback(() => setCreateCell(null), []);
  const closePillContextMenu = useCallback(() => setPillContextMenu(null), []);

  const handleSessionContextMenu = useCallback(
    (sessionId: string, x: number, y: number) => {
      setContextMenu(null);
      setPillContextMenu({ sessionId, x, y });
    },
    []
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !plan) return;

      const activeData = active.data.current as
        | { sessionId: string; blockId: string; sourceWeekId: string; sourceDate: string }
        | undefined;
      const overData = over.data.current as
        | { weekId: string; date: string; blockId: string }
        | undefined;
      if (!activeData || !overData) return;

      // No-op when the pill is dropped on its own cell.
      if (
        activeData.sourceWeekId === overData.weekId &&
        activeData.sourceDate === overData.date
      ) {
        return;
      }

      // Cross-block drag is not supported in v1 (per spec §5.1).
      if (activeData.blockId !== overData.blockId) {
        toast.error("Drag across blocks is not supported yet.");
        return;
      }

      const sessionId = activeData.sessionId;
      const previous = localSessions;
      const source = previous.find((s) => s.id === sessionId);
      if (!source) return;

      // Optimistic update: append to the target day's stack.
      const targetDayCount = previous.filter(
        (s) =>
          s.week_id === overData.weekId && s.date === overData.date && s.id !== sessionId
      ).length;
      const targetHasRest = previous.some(
        (s) =>
          s.week_id === overData.weekId &&
          s.date === overData.date &&
          (s.type ?? "").toLowerCase() === "rest"
      );

      setLocalSessions((prev) =>
        prev
          .filter(
            (s) =>
              !(
                s.week_id === overData.weekId &&
                s.date === overData.date &&
                (s.type ?? "").toLowerCase() === "rest"
              )
          )
          .map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  week_id: overData.weekId,
                  date: overData.date,
                  day_order: targetHasRest ? 0 : targetDayCount
                }
              : s
          )
      );

      try {
        await rescheduleSessionAction({
          sessionId,
          planId: plan.id,
          targetWeekId: overData.weekId,
          targetDate: overData.date
        });
      } catch (err) {
        setLocalSessions(previous);
        toast.error(err instanceof Error ? err.message : "Could not move session.");
      }
    },
    [plan, localSessions]
  );

  const handleContextMenuAction = useCallback(
    async (action: CellContextMenuAction) => {
      const target = contextMenu;
      setContextMenu(null);
      if (!target || !plan) return;
      if (action === "add") {
        handleEmptyCellClick(target.weekId, target.date);
        return;
      }
      // "rest"
      try {
        const created = await createSessionFromCellAction({
          kind: "rest",
          planId: plan.id,
          weekId: target.weekId,
          date: target.date,
          sport: "other",
          sessionName: null,
          intentCategory: null,
          durationMinutes: 0,
          target: null,
          notes: null,
          sessionRole: "Recovery"
        });
        appendCreatedSession({
          id: created.id,
          plan_id: created.plan_id,
          week_id: created.week_id,
          date: created.date,
          sport: created.sport,
          type: created.type,
          session_name: created.session_name,
          intent_category: created.intent_category,
          duration_minutes: created.duration_minutes,
          target: created.target,
          notes: created.notes,
          session_role: created.session_role,
          is_key: created.is_key
        });
      } catch (err) {
        // Best-effort: log to console; surfacing a toast is out of scope for
        // this phase. The failure is recoverable by the user retrying.
        console.error("Failed to create rest day", err);
      }
    },
    [contextMenu, plan, handleEmptyCellClick, appendCreatedSession]
  );

  const handlePillContextMenuAction = useCallback(
    async (action: SessionPillContextMenuAction) => {
      const target = pillContextMenu;
      if (!target || !plan) return;
      const session = localSessions.find((s) => s.id === target.sessionId);
      setPillContextMenu(null);
      if (!session) return;

      if (action.type === "duplicate-next-day") {
        const nextDate = addDays(session.date, 1);
        const targetWeek =
          weeks.find((w) => {
            const end = addDays(w.week_start_date, 6);
            return w.week_start_date <= nextDate && nextDate <= end;
          }) ?? null;
        if (!targetWeek) {
          toast.error("Next day is outside this plan.");
          return;
        }
        try {
          const result = await duplicateSessionAction({
            sessionId: session.id,
            planId: plan.id,
            targetWeekId: targetWeek.id,
            targetDate: nextDate
          });
          const removed = new Set(result.removedRestIds);
          setLocalSessions((prev) => {
            const filtered = removed.size > 0 ? prev.filter((s) => !removed.has(s.id)) : prev;
            return [
              ...filtered,
              {
                id: result.created.id,
                sport: result.created.sport,
                type: result.created.type,
                session_name: result.created.session_name,
                intent_category: result.created.intent_category,
                target: result.created.target,
                notes: result.created.notes,
                duration_minutes: result.created.duration_minutes,
                session_role: result.created.session_role,
                is_key: result.created.is_key,
                status: "planned",
                week_id: result.created.week_id,
                date: result.created.date,
                day_order: null,
                plan_id: result.created.plan_id
              }
            ];
          });
          setLastEditedDiscipline(result.created.sport);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not duplicate session.");
        }
        return;
      }

      if (action.type === "move-to") {
        const previous = localSessions;
        if (action.date === session.date && action.weekId === session.week_id) return;
        const targetDayCount = previous.filter(
          (s) =>
            s.week_id === action.weekId && s.date === action.date && s.id !== session.id
        ).length;
        const targetHasRest = previous.some(
          (s) =>
            s.week_id === action.weekId &&
            s.date === action.date &&
            (s.type ?? "").toLowerCase() === "rest"
        );
        setLocalSessions((prev) =>
          prev
            .filter(
              (s) =>
                !(
                  s.week_id === action.weekId &&
                  s.date === action.date &&
                  (s.type ?? "").toLowerCase() === "rest"
                )
            )
            .map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    week_id: action.weekId,
                    date: action.date,
                    day_order: targetHasRest ? 0 : targetDayCount
                  }
                : s
            )
        );
        try {
          await rescheduleSessionAction({
            sessionId: session.id,
            planId: plan.id,
            targetWeekId: action.weekId,
            targetDate: action.date
          });
        } catch (err) {
          setLocalSessions(previous);
          toast.error(err instanceof Error ? err.message : "Could not move session.");
        }
        return;
      }

      if (action.type === "toggle-key") {
        const nextIsKey = !(session.is_key ?? false);
        const previous = localSessions;
        setLocalSessions((prev) =>
          prev.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  is_key: nextIsKey,
                  session_role: nextIsKey ? "Key" : s.session_role === "Key" ? "Supporting" : s.session_role
                }
              : s
          )
        );
        try {
          await updateSessionDetailsAction({
            sessionId: session.id,
            planId: plan.id,
            weekId: session.week_id,
            sport: (session.sport ?? "other") as "swim" | "bike" | "run" | "strength" | "other",
            sessionType: session.type,
            sessionName: session.session_name ?? null,
            intentCategory: session.intent_category ?? null,
            durationMinutes: session.duration_minutes,
            target: session.target ?? null,
            notes: session.notes ?? null,
            sessionRole: nextIsKey
              ? "Key"
              : session.session_role === "Key"
                ? "Supporting"
                : ((session.session_role ?? null) as "Key" | "Supporting" | "Recovery" | null)
          });
        } catch (err) {
          setLocalSessions(previous);
          toast.error(err instanceof Error ? err.message : "Could not update session.");
        }
        return;
      }

      if (action.type === "convert-to-rest") {
        const previous = localSessions;
        try {
          const result = await convertSessionToRestAction({
            sessionId: session.id,
            planId: plan.id,
            weekId: session.week_id,
            date: session.date
          });
          setLocalSessions((prev) => {
            let next = prev.filter((s) => s.id !== session.id);
            if (result.restCreated) {
              next = [
                ...next,
                {
                  id: result.restCreated.id,
                  sport: result.restCreated.sport,
                  type: result.restCreated.type,
                  session_name: result.restCreated.session_name,
                  intent_category: result.restCreated.intent_category,
                  target: result.restCreated.target,
                  notes: result.restCreated.notes,
                  duration_minutes: result.restCreated.duration_minutes,
                  session_role: result.restCreated.session_role,
                  is_key: result.restCreated.is_key,
                  status: "planned",
                  week_id: result.restCreated.week_id,
                  date: result.restCreated.date,
                  day_order: null,
                  plan_id: result.restCreated.plan_id
                }
              ];
            }
            return next;
          });
        } catch (err) {
          setLocalSessions(previous);
          toast.error(err instanceof Error ? err.message : "Could not convert to rest.");
        }
        return;
      }

      if (action.type === "delete") {
        if (!window.confirm("Delete this session? This cannot be undone.")) return;
        const previous = localSessions;
        setLocalSessions((prev) => prev.filter((s) => s.id !== session.id));
        try {
          const formData = new FormData();
          formData.set("sessionId", session.id);
          await deleteSessionAction(formData);
        } catch (err) {
          setLocalSessions(previous);
          toast.error(err instanceof Error ? err.message : "Could not delete session.");
        }
      }
    },
    [pillContextMenu, plan, localSessions, weeks]
  );

  const pillContextMenuSession = useMemo(() => {
    if (!pillContextMenu) return null;
    return localSessions.find((s) => s.id === pillContextMenu.sessionId) ?? null;
  }, [pillContextMenu, localSessions]);

  const pillContextMenuWeekDays = useMemo(() => {
    if (!pillContextMenu || !pillContextMenuSession) return [];
    const week = weeks.find((w) => w.id === pillContextMenuSession.week_id);
    if (!week) return [];
    return buildWeekDays(week.week_start_date, week.id, pillContextMenuSession.date);
  }, [pillContextMenu, pillContextMenuSession, weeks]);

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
      <div className="sm:hidden">
        <PhoneWeekView
          weeks={weeksInBlock}
          sessions={sessionsInBlock}
          todayIso={todayIso}
          adaptationsBySession={adaptationsBySession}
          completedByWeek={completedByWeek}
          onSelectSession={handleOpenSession}
          onSessionContextMenu={handleSessionContextMenu}
          onEmptyCellClick={handleEmptyCellClick}
        />
      </div>
      <div className="hidden sm:block">
        <DndContext sensors={dndSensors} onDragEnd={handleDragEnd}>
          <BlockGrid
            weeks={weeksInBlock}
            sessions={sessionsInBlock}
            todayIso={todayIso}
            adaptationsBySession={adaptationsBySession}
            completedByWeek={completedByWeek}
            onSelectSession={handleOpenSession}
            onSessionContextMenu={handleSessionContextMenu}
            onEmptyCellClick={handleEmptyCellClick}
            onEmptyCellContextMenu={handleEmptyCellContextMenu}
            blockId={activeBlock?.id ?? null}
          />
        </DndContext>
      </div>
      <SessionDrawer
        session={drawerSession}
        adaptations={drawerAdaptations}
        open={drawerSession !== null}
        onClose={handleCloseDrawer}
        onSaved={handleSessionSaved}
        onDeleted={handleSessionDeleted}
      />
      <SessionDrawer
        mode="create"
        cell={createCell}
        adaptations={[]}
        open={createCell !== null}
        onClose={closeCreateDrawer}
        onSaved={handleSessionSaved}
        onDeleted={handleSessionDeleted}
        onCreated={handleSessionCreated}
      />
      {contextMenu ? (
        <CellContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onSelect={handleContextMenuAction}
          onClose={closeContextMenu}
        />
      ) : null}
      {pillContextMenu && pillContextMenuSession ? (
        <SessionPillContextMenu
          x={pillContextMenu.x}
          y={pillContextMenu.y}
          isKey={pillContextMenuSession.is_key === true}
          weekDays={pillContextMenuWeekDays}
          onSelect={handlePillContextMenuAction}
          onClose={closePillContextMenu}
        />
      ) : null}
    </div>
  );
}
