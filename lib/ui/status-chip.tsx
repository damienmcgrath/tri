import type { ReactNode } from "react";

import {
  getSessionLifecycleLabel,
  type SessionLifecycleState,
  SESSION_LIFECYCLE_TONES
} from "@/lib/training/semantics";

export type SessionStatus = SessionLifecycleState;

const statusMeta: Record<SessionStatus, { label: string; icon: ReactNode; className: string }> = {
  planned: { label: getSessionLifecycleLabel("planned"), icon: "◌", className: "status-chip-planned" },
  completed: { label: getSessionLifecycleLabel("completed"), icon: "✓", className: "status-chip-completed" },
  skipped: { label: getSessionLifecycleLabel("skipped"), icon: "—", className: "status-chip-skipped" },
  moved: { label: getSessionLifecycleLabel("moved"), icon: "↔", className: "status-chip-moved" },
  extra: { label: getSessionLifecycleLabel("extra"), icon: "+", className: "status-chip-extra" },
  assigned_from_upload: {
    label: getSessionLifecycleLabel("assigned_from_upload"),
    icon: "↳",
    className: "status-chip-assigned"
  },
  unmatched_upload: { label: getSessionLifecycleLabel("unmatched_upload"), icon: "?", className: "status-chip-unmatched" }
};

function getSessionStatusMeta(status: SessionStatus) {
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
