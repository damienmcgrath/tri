export type CalendarSessionRecord = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  status?: "planned" | "completed" | "skipped";
  is_key?: boolean | null;
};

export type CalendarActivityRecord = {
  id: string;
  sport_type: string;
  start_time_utc: string;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_power: number | null;
};

export type CalendarLinkRecord = {
  planned_session_id: string | null;
  completed_activity_id: string;
};

export type LegacyCompletedRecord = {
  date: string;
  sport: string;
};

export type CalendarDisplayItem = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration: number;
  notes: string | null;
  created_at: string;
  status: "planned" | "completed" | "skipped";
  linkedActivityCount: number;
  linkedStats: { durationMin: number; distanceKm: number; avgHr: number | null; avgPower: number | null } | null;
  unassignedSameDayCount: number;
  is_key: boolean;
  displayType: "planned_session" | "completed_activity";
};

type ActivityItem = {
  id: string;
  date: string;
  sport: string;
  duration_min: number;
  distance_km: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  created_at: string;
};

function isSkipped(notes: string | null) {
  return /\[skipped\s\d{4}-\d{2}-\d{2}\]/i.test(notes ?? "");
}

function localIsoDate(utcIso: string, timeZone: string) {
  const date = new Date(utcIso);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}


function dateInRange(date: string, start?: string, endExclusive?: string) {
  if (start && date < start) return false;
  if (endExclusive && date >= endExclusive) return false;
  return true;
}
function fallbackStatus(
  session: Pick<CalendarSessionRecord, "date" | "sport" | "notes" | "status">,
  completionLedger: Record<string, number>
) {
  if (session.status) return session.status;
  if (isSkipped(session.notes)) return "skipped";

  const key = `${session.date}:${session.sport}`;
  const completedCount = completionLedger[key] ?? 0;
  if (completedCount > 0) {
    completionLedger[key] = completedCount - 1;
    return "completed";
  }

  return "planned";
}

export function buildCalendarDisplayItems(input: {
  sessions: CalendarSessionRecord[];
  activities: CalendarActivityRecord[];
  links: CalendarLinkRecord[];
  legacyCompleted: LegacyCompletedRecord[];
  timeZone: string;
  weekStart?: string;
  weekEndExclusive?: string;
}) {
  const { sessions, activities, links, legacyCompleted, timeZone, weekStart, weekEndExclusive } = input;

  const activityById = new Map<string, ActivityItem>(
    activities
      .map((activity) => ({ ...activity, localDate: localIsoDate(activity.start_time_utc, timeZone) }))
      .filter((activity) => dateInRange(activity.localDate, weekStart, weekEndExclusive))
      .map((activity) => [
      activity.id,
      {
        id: activity.id,
        date: activity.localDate,
        sport: activity.sport_type,
        duration_min: Math.round(Number(activity.duration_sec ?? 0) / 60),
        distance_km: activity.distance_m ? Number(activity.distance_m) / 1000 : null,
        avg_hr: activity.avg_hr,
        avg_power: activity.avg_power,
        created_at: activity.start_time_utc
      }
    ])
  );

  const linkedBySession = new Map<string, ActivityItem[]>();
  const linkedActivityIds = new Set<string>();

  links.forEach((link) => {
    const activity = activityById.get(link.completed_activity_id);
    if (!activity || !link.planned_session_id) return;
    linkedActivityIds.add(activity.id);
    const list = linkedBySession.get(link.planned_session_id) ?? [];
    list.push(activity);
    linkedBySession.set(link.planned_session_id, list);
  });

  const unassignedByDate = new Map<string, number>();
  [...activityById.values()]
    .filter((item) => !linkedActivityIds.has(item.id))
    .forEach((item) => {
      unassignedByDate.set(item.date, (unassignedByDate.get(item.date) ?? 0) + 1);
    });

  const completionLedger = legacyCompleted.reduce<Record<string, number>>((acc, item) => {
    const key = `${item.date}:${item.sport}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const plannedItems: CalendarDisplayItem[] = sessions.map((session) => {
    const linked = linkedBySession.get(session.id) ?? [];
    const linkedStats = linked[0]
      ? {
          durationMin: linked.reduce((sum, item) => sum + item.duration_min, 0),
          distanceKm: linked.reduce((sum, item) => sum + (item.distance_km ?? 0), 0),
          avgHr: linked[0].avg_hr,
          avgPower: linked[0].avg_power
        }
      : null;

    return {
      id: session.id,
      date: session.date,
      sport: session.sport,
      type: session.type,
      duration: session.duration_minutes ?? 0,
      notes: session.notes,
      created_at: session.created_at,
      status: linked.length > 0 ? "completed" : fallbackStatus(session, completionLedger),
      linkedActivityCount: linked.length,
      linkedStats,
      unassignedSameDayCount: linked.length > 0 ? 0 : (unassignedByDate.get(session.date) ?? 0),
      is_key: Boolean(session.is_key),
      displayType: "planned_session"
    };
  });

  const unlinkedActivityItems: CalendarDisplayItem[] = [...activityById.values()]
    .filter((item) => !linkedActivityIds.has(item.id))
    .map((item) => ({
      id: `activity:${item.id}`,
      date: item.date,
      sport: item.sport,
      type: "Completed activity",
      duration: item.duration_min,
      notes: null,
      created_at: item.created_at,
      status: "completed",
      linkedActivityCount: 1,
      linkedStats: {
        durationMin: item.duration_min,
        distanceKm: item.distance_km ?? 0,
        avgHr: item.avg_hr,
        avgPower: item.avg_power
      },
      unassignedSameDayCount: 0,
      is_key: false,
      displayType: "completed_activity"
    }));

  return [...plannedItems, ...unlinkedActivityItems].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.displayType !== b.displayType) return a.displayType === "planned_session" ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  });
}
