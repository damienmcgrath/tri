import type { ReactNode } from "react";

import {
  SESSION_LIFECYCLE_META,
  type SessionLifecycleState,
  SESSION_LIFECYCLE_TONES
} from "@/lib/training/semantics";

export type SessionStatus = SessionLifecycleState;

const statusMeta: Record<SessionStatus, { label: string; icon: ReactNode; className: string }> = {
  planned: { label: SESSION_LIFECYCLE_META.planned.label, icon: SESSION_LIFECYCLE_META.planned.icon, className: "status-chip-planned" },
  today: { label: SESSION_LIFECYCLE_META.today.label, icon: SESSION_LIFECYCLE_META.today.icon, className: "status-chip-today" },
  completed: { label: SESSION_LIFECYCLE_META.completed.label, icon: SESSION_LIFECYCLE_META.completed.icon, className: "status-chip-completed" },
  skipped: { label: SESSION_LIFECYCLE_META.skipped.label, icon: SESSION_LIFECYCLE_META.skipped.icon, className: "status-chip-skipped" },
  missed: { label: SESSION_LIFECYCLE_META.missed.label, icon: SESSION_LIFECYCLE_META.missed.icon, className: "status-chip-missed" },
  extra: { label: SESSION_LIFECYCLE_META.extra.label, icon: SESSION_LIFECYCLE_META.extra.icon, className: "status-chip-extra" }
};

export function getSessionStatusMeta(status: SessionStatus) {
  return statusMeta[status];
}

export function SessionStatusChip({
  status,
  className = "",
  compact = false
}: {
  status: SessionStatus;
  className?: string;
  compact?: boolean;
}) {
  const meta = getSessionStatusMeta(status);
  const toneClass = `status-chip-tone-${SESSION_LIFECYCLE_TONES[status]}`;

  return (
    <span
      className={`status-chip ${meta.className} ${toneClass} ${compact ? "status-chip-compact" : ""} ${className}`.trim()}
      aria-label={meta.label}
    >
      <span aria-hidden="true">{meta.icon}</span>
      {compact ? null : <span>{meta.label}</span>}
    </span>
  );
}
