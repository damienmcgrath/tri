"use client";

import { SessionPill, type SessionPillSession } from "./session-pill";

type Props = {
  sessions: SessionPillSession[];
  isToday?: boolean;
  adaptationsBySession?: Record<string, boolean>;
};

export function BlockGridCell({ sessions, isToday, adaptationsBySession }: Props) {
  return (
    <div
      className={`flex min-h-[52px] flex-col gap-1 border-l border-[rgba(255,255,255,0.04)] px-1.5 py-1 ${
        isToday ? "bg-[rgba(190,255,0,0.04)]" : ""
      }`}
    >
      {isToday ? (
        <span aria-hidden className="absolute h-1 w-1 -translate-y-0.5 rounded-full bg-[rgba(190,255,0,0.85)]" />
      ) : null}
      {sessions.map((session) => (
        <SessionPill
          key={session.id}
          session={session}
          hasAdaptation={adaptationsBySession?.[session.id] === true}
        />
      ))}
    </div>
  );
}
