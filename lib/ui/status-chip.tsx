import type { ReactNode } from "react";

export type SessionStatus = "planned" | "completed" | "skipped";

const statusMeta: Record<SessionStatus, { label: string; icon: ReactNode; className: string }> = {
  planned: { label: "Planned", icon: "◌", className: "status-chip-planned" },
  completed: { label: "Completed", icon: "✓", className: "status-chip-completed" },
  skipped: { label: "Skipped", icon: "—", className: "status-chip-skipped" }
};

export function getSessionStatusMeta(status: SessionStatus) {
  return statusMeta[status];
}

export function SessionStatusChip({ status, className = "" }: { status: SessionStatus; className?: string }) {
  const meta = getSessionStatusMeta(status);

  return (
    <span className={`status-chip ${meta.className} ${className}`.trim()}>
      <span aria-hidden="true">{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  );
}
