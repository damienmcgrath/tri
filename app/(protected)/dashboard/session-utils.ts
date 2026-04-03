import { getSessionDisplayName } from "@/lib/training/session";
import { getDisciplineMeta } from "@/lib/ui/discipline";

export type Session = {
  id: string;
  plan_id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  subtype?: string | null;
  workout_type?: string | null;
  intent_category?: string | null;
  session_role?: "key" | "supporting" | "recovery" | "optional" | "Key" | "Supporting" | "Recovery" | "Optional" | null;
  source_metadata?: { uploadId?: string | null; assignmentId?: string | null; assignedBy?: "planner" | "upload" | "coach" | null } | null;
  execution_result?: { status?: "matched_intent" | "partial_intent" | "missed_intent" | null; summary?: string | null } | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  status: "planned" | "completed" | "skipped";
  is_key?: boolean | null;
};

export function kickerClassName(kicker: string) {
  const normalized = kicker.trim().toLowerCase();
  if (normalized === "needs attention") return "text-danger";
  if (normalized === "focus this week") return "text-accent";
  if (normalized === "this week") return "text-accent";
  return "text-tertiary";
}

export function toHoursAndMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}h ${mins}m`;
}

export function getNextImportantSession(sessions: Session[], todayIso: string) {
  const upcoming = sessions.filter((session) => session.status === "planned" && session.date >= todayIso);
  if (upcoming.length === 0) return null;

  const tomorrowIso = (() => {
    const d = new Date(`${todayIso}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  upcoming.sort((a, b) => {
    const aIsNear = a.date <= tomorrowIso;
    const bIsNear = b.date <= tomorrowIso;

    // Today and tomorrow: sort by priority within the same date
    if (aIsNear || bIsNear) {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const aPriority = Number(Boolean(a.is_key)) * 3 + Number(/long run|race prep|brick/i.test(getSessionDisplayName(a))) * 2;
      const bPriority = Number(Boolean(b.is_key)) * 3 + Number(/long run|race prep|brick/i.test(getSessionDisplayName(b))) * 2;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    }

    // Sessions further out: purely chronological
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

  return upcoming[0] ?? null;
}

export function getUpcomingSessionMeta(session: Session | null) {
  if (!session) return null;

  const dayName = weekdayName(session.date);
  const emphasis = session.is_key ? "Key session" : "Upcoming";
  return `${dayName} • ${session.duration_minutes} min • ${emphasis}`;
}

export function getSessionStatus(session: Session, completionLedger: Record<string, number>) {
  if (session.status === "completed" || session.status === "skipped") {
    return session.status;
  }

  const isSkipped = /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(session.notes ?? "");
  if (isSkipped) {
    return "skipped" as const;
  }

  const key = `${session.date}:${session.sport}`;
  const completedCount = completionLedger[key] ?? 0;

  if (completedCount > 0) {
    completionLedger[key] = completedCount - 1;
    return "completed" as const;
  }

  return "planned" as const;
}

export function weekdayName(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

export function isMissingSessionColumnError(message: string | undefined) {
  return /42703|schema cache|sessions\.(session_name|subtype|workout_type|intent_category|session_role|source_metadata|execution_result|is_key)/i.test(
    message ?? ""
  );
}

export function getDayMeaningLabel(daySessions: Session[]) {
  const plannedSessions = daySessions.filter((session) => session.status === "planned");
  if (plannedSessions.length === 0) return null;

  if (plannedSessions.length === 1) {
    return getSessionDisplayName(plannedSessions[0]);
  }

  const uniqueSports = [...new Set(plannedSessions.map((session) => getDisciplineMeta(session.sport).label))];
  if (uniqueSports.length === 1) {
    return `${uniqueSports[0]} x${plannedSessions.length}`;
  }

  if (uniqueSports.length >= 2) {
    return `${uniqueSports[0]} + ${uniqueSports[1]}`;
  }

  return `${plannedSessions.length} sessions`;
}
