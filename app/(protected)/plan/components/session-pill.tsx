"use client";

import { computeSessionIntensityProfile, type ZoneKey } from "@/lib/training/intensity-profile";
import { getDisciplineMeta } from "@/lib/ui/discipline";
import { getSessionDisplayName } from "@/lib/training/session";

type ExecutionResultStatus = "matched_intent" | "partial_intent" | "missed_intent";

export type SessionPillSession = {
  id: string;
  sport: string;
  type: string;
  session_name?: string | null;
  discipline?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  target: string | null;
  notes: string | null;
  intent_category?: string | null;
  duration_minutes: number;
  session_role?: string | null;
  is_key?: boolean | null;
  execution_result?: { status?: ExecutionResultStatus | null; summary?: string | null } | null;
};

type Props = {
  session: SessionPillSession;
  hasAdaptation?: boolean;
};

const DISCIPLINE_BAR: Record<string, string> = {
  swim: "var(--color-swim)",
  bike: "var(--color-bike)",
  run: "var(--color-run)",
  strength: "var(--color-strength)",
  other: "rgba(255,255,255,0.35)"
};

// Phase 1 spec: Z1–2 green, Z3 yellow, Z4 orange, Z5+ red.
const INTENSITY_UNDERLINE: Record<ZoneKey, string> = {
  z1: "hsl(140, 55%, 55%)",
  z2: "hsl(140, 55%, 55%)",
  z3: "hsl(48, 90%, 58%)",
  z4: "hsl(28, 90%, 58%)",
  z5: "hsl(5, 80%, 58%)",
  strength: "hsl(260, 40%, 60%)"
};

function dominantZone(distribution: Record<ZoneKey, number>): ZoneKey {
  let best: ZoneKey = "z2";
  let bestValue = -1;
  for (const key of Object.keys(distribution) as ZoneKey[]) {
    const value = distribution[key];
    if (value > bestValue) {
      bestValue = value;
      best = key;
    }
  }
  return best;
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

export function SessionPill({ session, hasAdaptation }: Props) {
  const sport = (session.sport ?? "other").toLowerCase();
  const disciplineColour = DISCIPLINE_BAR[sport] ?? DISCIPLINE_BAR.other;
  const disciplineLabel = getDisciplineMeta(sport).label;

  const profile = computeSessionIntensityProfile({
    id: session.id,
    sport,
    type: session.type ?? "",
    target: session.target ?? null,
    notes: session.notes ?? null,
    durationMinutes: session.duration_minutes,
    intentCategory: session.intent_category ?? null
  });
  const zone = dominantZone(profile.zoneDistribution);
  const underlineColour = INTENSITY_UNDERLINE[zone];

  const fullName = getSessionDisplayName({
    sessionName: session.session_name,
    discipline: session.discipline ?? sport,
    sport,
    subtype: session.subtype,
    workoutType: session.workout_type,
    type: session.type,
    durationMinutes: session.duration_minutes,
    intentCategory: session.intent_category,
    session_role: session.session_role as never,
    is_key: session.is_key ?? null,
    execution_result: session.execution_result ?? null
  });
  const displayName = truncate(fullName, 16);

  const isKey =
    session.is_key === true || (session.session_role ?? "").toString().toLowerCase() === "key";
  const isCompleted = session.execution_result != null;

  return (
    <div
      title={`${disciplineLabel} · ${fullName} · ${session.duration_minutes} min`}
      className="relative flex items-stretch gap-1.5 overflow-hidden rounded-sm bg-[rgba(255,255,255,0.03)] pr-1.5"
      style={{ minHeight: "22px" }}
    >
      <span aria-hidden className="w-[3px] shrink-0" style={{ backgroundColor: disciplineColour }} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-[rgba(255,255,255,0.78)]">
          {displayName}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[rgba(255,255,255,0.55)]">
          {session.duration_minutes}
        </span>
      </div>
      {isKey ? (
        <span
          aria-label="Key session"
          className="shrink-0 self-center font-mono text-[9px] uppercase tracking-wide text-[rgba(190,255,0,0.85)]"
        >
          ★ KEY
        </span>
      ) : null}
      {hasAdaptation ? (
        <span
          aria-label="Adapted by coach"
          className="shrink-0 self-center font-mono text-[9px] uppercase tracking-wide text-[rgba(140,200,255,0.8)]"
        >
          ↻ Adapted
        </span>
      ) : null}
      {isCompleted ? (
        <span
          aria-label="Completed"
          className="absolute right-1 top-0.5 font-mono text-[9px] text-[rgba(140,255,170,0.9)]"
        >
          ✓
        </span>
      ) : null}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]"
        style={{ backgroundColor: underlineColour }}
      />
    </div>
  );
}
