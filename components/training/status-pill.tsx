import type { ReactNode } from "react";
import type { StateTone } from "@/lib/training/semantics";

export function toneClassName(tone: StateTone, muted = false) {
  if (tone === "success") {
    return muted
      ? "border-[hsl(var(--success)/0.22)] bg-[hsl(var(--success)/0.06)] text-[hsl(var(--success))]"
      : "border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]";
  }

  if (tone === "warning") {
    return muted
      ? "border-[hsl(var(--warning)/0.22)] bg-[hsl(var(--warning)/0.06)] text-[hsl(var(--warning))]"
      : "border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]";
  }

  if (tone === "attention") {
    return muted
      ? "border-[hsl(var(--signal-risk)/0.22)] bg-[hsl(var(--signal-risk)/0.06)] text-[hsl(var(--signal-risk))]"
      : "border-[hsl(var(--signal-risk)/0.35)] bg-[hsl(var(--signal-risk)/0.12)] text-[hsl(var(--signal-risk))]";
  }

  if (tone === "info") {
    return muted
      ? "border-[hsl(var(--accent-performance)/0.24)] bg-[hsl(var(--accent-performance)/0.06)] text-accent"
      : "border-[hsl(var(--accent-performance)/0.35)] bg-[hsl(var(--accent-performance)/0.12)] text-accent";
  }

  return muted
    ? "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.45)] text-muted"
    : "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] text-muted";
}

export function StatusPill({
  label,
  tone,
  icon,
  compact = false,
  className = ""
}: {
  label: string;
  tone: StateTone;
  icon?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"} font-medium uppercase tracking-[0.14em] ${toneClassName(tone)} ${className}`.trim()}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}
