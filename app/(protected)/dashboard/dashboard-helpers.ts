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

export type CompletedSession = {
  date: string;
  sport: string;
};

export type CompletedActivity = {
  id: string;
  upload_id: string | null;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  schedule_status: "scheduled" | "unscheduled";
  is_unplanned: boolean;
};

export type Profile = {
  active_plan_id: string | null;
  race_date: string | null;
  race_name: string | null;
};

export type Plan = {
  id: string;
};

export type ContextualItem = {
  kicker: string;
  title: string;
  detail: string;
  cta: string;
  href: string;
  ctaStyle: "primary" | "secondary";
};

export type StatusChip = {
  label: string;
  className: string;
};

export type DiagnosisAwareSignal = {
  statusChipOverride?: StatusChip;
  interpretationRisk?: ExecutionRisk;
  statusInterpretation?: string;
  focusOverride?: ContextualItem;
  todayCue?: string;
};

export type ExecutionRisk = "easy_control" | "recovery_control" | "bike_consistency" | "strong_execution";

export type DayTone = "rest" | "upcoming" | "today-remaining" | "today-complete" | "completed" | "missed" | "adapted";

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

export function getDayToneClass(tone: DayTone) {
  if (tone === "today-remaining") {
    return "border-[rgba(190,255,0,0.32)] bg-[rgba(190,255,0,0.11)]";
  }

  if (tone === "today-complete") {
    return "border-[rgba(190,255,0,0.2)] bg-[rgba(190,255,0,0.06)]";
  }

  if (tone === "completed") {
    return "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]";
  }

  if (tone === "missed") {
    return "border-[rgba(255,90,40,0.24)] bg-[rgba(255,90,40,0.09)]";
  }

  if (tone === "adapted") {
    return "border-[hsl(var(--warning)/0.34)] bg-[rgba(255,180,60,0.10)]";
  }

  if (tone === "upcoming") {
    return "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.035)]";
  }

  return "border-[rgba(255,255,255,0.06)] bg-transparent";
}

export function getDayChipContent(day: { tone: DayTone; stateLabel: string; microLabel: string }) {
  if (day.tone === "completed" || day.tone === "today-complete") {
    return {
      title: day.microLabel.replace(/ done$/i, ""),
      meta: day.tone === "today-complete" ? "Today" : "Done"
    };
  }

  if (day.tone === "missed") {
    return {
      title: day.microLabel.replace(/ missed$/i, ""),
      meta: "Missed"
    };
  }

  if (day.tone === "upcoming") {
    return {
      title: day.stateLabel,
      meta: day.microLabel.replace(/ planned$/i, "") || "Upcoming"
    };
  }

  if (day.tone === "today-remaining") {
    const [title, meta] = day.microLabel.split(" · ");
    return {
      title: title ?? day.stateLabel,
      meta: meta ?? "Today"
    };
  }

  return {
    title: day.stateLabel,
    meta: day.microLabel === day.stateLabel ? "" : day.microLabel
  };
}

export function getDayChipTitleClass(day: { tone: DayTone; stateLabel: string }) {
  if (day.tone === "upcoming" && day.stateLabel.length > 8) {
    return "mt-1 line-clamp-2 text-[12px] font-medium leading-tight text-white";
  }

  return "mt-1 line-clamp-2 text-[13px] font-medium leading-tight text-white";
}

// F11 (revised): small status pip color per day tone. The pip is a 6px dot
// at the top-right of each chip in the week-shape strip — it answers "is
// this day done, missed, or upcoming?" without any numbers.
export function getDayPipClass(tone: DayTone) {
  switch (tone) {
    case "today-remaining":
    case "today-complete":
      return "bg-[var(--color-accent)]";
    case "completed":
      return "bg-[var(--color-success)]";
    case "missed":
      return "bg-[var(--color-danger)]";
    case "adapted":
      return "bg-[var(--color-warning)]";
    case "upcoming":
      return "bg-[rgba(255,255,255,0.4)]";
    default:
      return "bg-[rgba(255,255,255,0.18)]";
  }
}

export function buildDayChipTooltip(
  day: { label: string; stateLabel: string; microLabel: string; totalMinutes: number },
  chipContent: { title: string; meta: string }
) {
  const parts: string[] = [day.label];
  if (day.totalMinutes > 0) parts.push(`${day.totalMinutes}m`);
  if (chipContent.title && chipContent.title !== day.label) parts.push(chipContent.title);
  if (chipContent.meta) parts.push(chipContent.meta);
  return parts.filter(Boolean).join(" · ");
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

export function getStatusChip(completionPct: number, expectedByTodayPct: number) {
  if (expectedByTodayPct <= 0) {
    return { label: "On track", className: "signal-ready" };
  }

  const delta = completionPct - expectedByTodayPct;

  if (delta >= -12) {
    return { label: "On track", className: "signal-ready" };
  }

  if (delta >= -22) {
    return { label: "Slightly behind", className: "signal-load" };
  }

  return { label: "At risk", className: "signal-risk" };
}

export function getDefaultStatusInterpretation(statusLabel: string) {
  if (statusLabel === "On track") {
    return "On track — keep session order and keep easy work controlled.";
  }

  if (statusLabel === "Slightly behind") {
    return "Slightly behind — protect key sessions and avoid stacking missed work.";
  }

  return "At risk — complete the next key session and keep weekend load unchanged.";
}

export function getDiagnosisStatusInterpretation(statusLabel: string, risk: ExecutionRisk) {
  if (risk === "easy_control") {
    if (statusLabel === "On track") {
      return "On track — easy days are drifting too hard.";
    }
    if (statusLabel === "Slightly behind") {
      return "Slightly behind — keep easy work truly easy.";
    }
    return "At risk — rein in easy-day intensity now.";
  }

  if (risk === "recovery_control") {
    if (statusLabel === "On track") {
      return "On track — recovery sessions are running too hard.";
    }
    if (statusLabel === "Slightly behind") {
      return "Slightly behind — hold recovery intent this week.";
    }
    return "At risk — protect recovery quality before adding load.";
  }

  if (risk === "bike_consistency") {
    if (statusLabel === "On track") {
      return "On track — bike execution needs tighter control.";
    }
    if (statusLabel === "Slightly behind") {
      return "Slightly behind — bike sessions need better execution.";
    }
    return "At risk — stabilize bike execution before adding work.";
  }

  if (statusLabel === "On track") {
    return "On track — execution is strong, hold the current load.";
  }
  if (statusLabel === "Slightly behind") {
    return "Slightly behind, but execution quality is strong.";
  }
  return "At risk on progress — keep quality high while stabilizing load.";
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

export function getDiagnosisAwareSignal({
  sessions,
  todayIso,
  nextPendingTodaySession,
  fallbackFocusItem
}: {
  sessions: Session[];
  todayIso: string;
  nextPendingTodaySession: Session | null;
  fallbackFocusItem: ContextualItem | null;
}): DiagnosisAwareSignal {
  const completedWithDiagnosis = sessions.filter(
    (session) => session.status === "completed" && session.execution_result?.status
  );

  if (completedWithDiagnosis.length < 2) {
    return { focusOverride: fallbackFocusItem ?? undefined };
  }

  const easySessions = completedWithDiagnosis.filter((session) => /easy|aerobic|base|endurance|recovery/i.test(session.intent_category ?? ""));
  const easyOffIntent = easySessions.filter((session) => session.execution_result?.status !== "matched_intent");

  const bikeSessions = completedWithDiagnosis.filter((session) => session.sport === "bike");
  const bikeOffIntent = bikeSessions.filter((session) => session.execution_result?.status !== "matched_intent");

  const recoverySessions = completedWithDiagnosis.filter((session) => /recovery/i.test(session.intent_category ?? ""));
  const recoveryOffIntent = recoverySessions.filter((session) => session.execution_result?.status !== "matched_intent");

  const keySessions = completedWithDiagnosis.filter((session) => session.is_key);
  const keyMatched = keySessions.filter((session) => session.execution_result?.status === "matched_intent");

  const easyOffRatio = easySessions.length > 0 ? easyOffIntent.length / easySessions.length : 0;
  const bikeOffRatio = bikeSessions.length > 0 ? bikeOffIntent.length / bikeSessions.length : 0;
  const recoveryOffRatio = recoverySessions.length > 0 ? recoveryOffIntent.length / recoverySessions.length : 0;

  const nextEasyToday = nextPendingTodaySession && /easy|aerobic|base|endurance|recovery/i.test(nextPendingTodaySession.intent_category ?? "");
  const nextRecoveryToday = nextPendingTodaySession && /recovery/i.test(nextPendingTodaySession.intent_category ?? "");
  const upcomingBike = sessions
    .filter((session) => session.status === "planned" && session.date >= todayIso && session.sport === "bike")
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  if (easySessions.length >= 2 && easyOffRatio >= 0.66) {
    return {
      interpretationRisk: "easy_control",
      focusOverride: {
        kicker: "Focus this week",
        title: "Easy sessions are drifting too hard",
        detail: "Hold easy sessions below target strain so key work stays high quality.",
        cta: nextEasyToday ? "Open today\'s easy session" : "Review upcoming easy sessions",
        href: nextEasyToday && nextPendingTodaySession ? `/calendar?focus=${nextPendingTodaySession.id}` : "/calendar",
        ctaStyle: "secondary"
      },
      todayCue: nextEasyToday ? "Keep this easy session truly easy." : undefined
    };
  }

  if (recoverySessions.length >= 2 && recoveryOffRatio >= 0.66) {
    return {
      interpretationRisk: "recovery_control",
      focusOverride: {
        kicker: "Focus this week",
        title: "Recovery quality is slipping",
        detail: "Keep recovery sessions genuinely light to protect your next key day.",
        cta: nextRecoveryToday ? "Open today\'s recovery session" : "Review recovery sessions",
        href: nextRecoveryToday && nextPendingTodaySession ? `/calendar?focus=${nextPendingTodaySession.id}` : "/calendar",
        ctaStyle: "secondary"
      },
      todayCue: nextRecoveryToday ? "Maintain recovery intent." : undefined
    };
  }

  if (bikeSessions.length >= 2 && bikeOffRatio >= 0.66) {
    return {
      interpretationRisk: "bike_consistency",
      focusOverride: {
        kicker: "Focus this week",
        title: "Protect bike consistency",
        detail: `${bikeOffIntent.length} of last ${bikeSessions.length} bike sessions missed intent. Lock in execution before adding load.`,
        cta: upcomingBike ? `Open ${weekdayName(upcomingBike.date)} bike` : "Open next bike session",
        href: upcomingBike ? `/calendar?focus=${upcomingBike.id}` : "/calendar",
        ctaStyle: "secondary"
      },
      todayCue: nextPendingTodaySession?.sport === "bike" ? "Cap effort early." : undefined
    };
  }

  if (keySessions.length >= 2 && keyMatched.length / keySessions.length >= 0.75) {
    return {
      interpretationRisk: "strong_execution",
      focusOverride: {
        kicker: "Focus this week",
        title: "Key session execution is strong — maintain load",
        detail: "Key sessions are landing. Keep easy and recovery days controlled to sustain momentum.",
        cta: "Open weekly plan",
        href: "/calendar",
        ctaStyle: "secondary"
      }
    };
  }

  return { focusOverride: fallbackFocusItem ?? undefined };
}
