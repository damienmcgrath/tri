import type { SupabaseClient } from "@supabase/supabase-js";

export type MetricDelta = {
  metric: string;
  current: string;
  previous: string;
  delta: string;
  direction: "better" | "worse" | "neutral";
  previousDate: string;
};

export type SessionComparison = {
  previousSessionId: string;
  previousDate: string;
  metrics: MetricDelta[];
};

type SessionRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  duration_minutes: number | null;
  status: string | null;
};

type ActivityMetrics = {
  avgHr?: number | null;
  avgPower?: number | null;
  normalizedPower?: number | null;
  avgPaceSecPerKm?: number | null;
  avgPacePer100mSec?: number | null;
  avgSwolf?: number | null;
  durationSec?: number | null;
};

function parseActivityMetrics(metricsV2: Record<string, unknown> | null | undefined): ActivityMetrics {
  if (!metricsV2) return {};

  // metrics_v2 can be flat (legacy) or nested (Strava normalizer stores pace/power/heartRate/summary as sub-objects)
  const pace = metricsV2.pace as Record<string, unknown> | undefined;
  const power = metricsV2.power as Record<string, unknown> | undefined;
  const heartRate = metricsV2.heartRate as Record<string, unknown> | undefined;
  const summary = metricsV2.summary as Record<string, unknown> | undefined;
  const stroke = metricsV2.stroke as Record<string, unknown> | undefined;

  return {
    avgHr: (heartRate?.avgHr ?? metricsV2.avg_hr) as number | null,
    avgPower: (power?.avgPower ?? metricsV2.avg_power) as number | null,
    normalizedPower: (power?.normalizedPower ?? metricsV2.normalized_power) as number | null,
    avgPaceSecPerKm: (pace?.avgPaceSecPerKm ?? pace?.avgPaceSecPerKm ?? metricsV2.avg_pace_sec_per_km) as number | null,
    avgPacePer100mSec: (pace?.avgPacePer100mSec ?? metricsV2.avg_pace_per_100m_sec) as number | null,
    avgSwolf: (stroke?.avgSwolf ?? metricsV2.avg_swolf) as number | null,
    durationSec: (summary?.durationSec ?? metricsV2.duration_sec) as number | null
  };
}

function formatPace(secPerKm: number): string {
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}/km`;
}

function formatSwimPace(secPer100m: number): string {
  const mins = Math.floor(secPer100m / 60);
  const secs = Math.round(secPer100m % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}/100m`;
}

function buildRunMetrics(current: ActivityMetrics, previous: ActivityMetrics, previousDate: string): MetricDelta[] {
  const deltas: MetricDelta[] = [];

  if (current.avgHr != null && previous.avgHr != null) {
    const diff = current.avgHr - previous.avgHr;
    deltas.push({
      metric: "Avg HR",
      current: `${Math.round(current.avgHr)} bpm`,
      previous: `${Math.round(previous.avgHr)} bpm`,
      delta: `${diff > 0 ? "+" : ""}${Math.round(diff)} bpm`,
      direction: Math.abs(diff) < 3 ? "neutral" : diff < 0 ? "better" : "worse",
      previousDate
    });
  }

  if (current.avgPaceSecPerKm != null && previous.avgPaceSecPerKm != null) {
    const diff = current.avgPaceSecPerKm - previous.avgPaceSecPerKm;
    const absDiff = Math.abs(Math.round(diff));
    const sign = diff > 0 ? "+" : "-";
    deltas.push({
      metric: "Avg Pace",
      current: formatPace(current.avgPaceSecPerKm),
      previous: formatPace(previous.avgPaceSecPerKm),
      delta: `${sign}${Math.floor(absDiff / 60)}:${(absDiff % 60).toString().padStart(2, "0")}/km`,
      direction: Math.abs(diff) < 5 ? "neutral" : diff < 0 ? "better" : "worse",
      previousDate
    });
  }

  if (current.durationSec != null && previous.durationSec != null) {
    const diffSec = current.durationSec - previous.durationSec;
    const diffMin = Math.round(diffSec / 60);
    deltas.push({
      metric: "Duration",
      current: `${Math.round(current.durationSec / 60)} min`,
      previous: `${Math.round(previous.durationSec / 60)} min`,
      delta: `${diffMin > 0 ? "+" : ""}${diffMin} min`,
      direction: "neutral",
      previousDate
    });
  }

  return deltas;
}

function buildBikeMetrics(current: ActivityMetrics, previous: ActivityMetrics, previousDate: string): MetricDelta[] {
  const deltas: MetricDelta[] = [];

  if (current.avgPower != null && previous.avgPower != null) {
    const diff = current.avgPower - previous.avgPower;
    deltas.push({
      metric: "Avg Power",
      current: `${Math.round(current.avgPower)} W`,
      previous: `${Math.round(previous.avgPower)} W`,
      delta: `${diff > 0 ? "+" : ""}${Math.round(diff)} W`,
      direction: Math.abs(diff) < 5 ? "neutral" : diff > 0 ? "better" : "worse",
      previousDate
    });
  }

  if (current.normalizedPower != null && previous.normalizedPower != null) {
    const diff = current.normalizedPower - previous.normalizedPower;
    deltas.push({
      metric: "Normalized Power",
      current: `${Math.round(current.normalizedPower)} W`,
      previous: `${Math.round(previous.normalizedPower)} W`,
      delta: `${diff > 0 ? "+" : ""}${Math.round(diff)} W`,
      direction: Math.abs(diff) < 5 ? "neutral" : diff > 0 ? "better" : "worse",
      previousDate
    });
  }

  if (current.avgHr != null && previous.avgHr != null) {
    const diff = current.avgHr - previous.avgHr;
    deltas.push({
      metric: "Avg HR",
      current: `${Math.round(current.avgHr)} bpm`,
      previous: `${Math.round(previous.avgHr)} bpm`,
      delta: `${diff > 0 ? "+" : ""}${Math.round(diff)} bpm`,
      direction: Math.abs(diff) < 3 ? "neutral" : diff < 0 ? "better" : "worse",
      previousDate
    });
  }

  return deltas;
}

function buildStrengthMetrics(current: ActivityMetrics, previous: ActivityMetrics, previousDate: string): MetricDelta[] {
  const deltas: MetricDelta[] = [];

  if (current.durationSec != null && previous.durationSec != null) {
    const diffSec = current.durationSec - previous.durationSec;
    const diffMin = Math.round(diffSec / 60);
    deltas.push({
      metric: "Duration",
      current: `${Math.round(current.durationSec / 60)} min`,
      previous: `${Math.round(previous.durationSec / 60)} min`,
      delta: `${diffMin > 0 ? "+" : ""}${diffMin} min`,
      direction: "neutral",
      previousDate
    });
  }

  if (current.avgHr != null && previous.avgHr != null) {
    const diff = current.avgHr - previous.avgHr;
    deltas.push({
      metric: "Avg HR",
      current: `${Math.round(current.avgHr)} bpm`,
      previous: `${Math.round(previous.avgHr)} bpm`,
      delta: `${diff > 0 ? "+" : ""}${Math.round(diff)} bpm`,
      direction: Math.abs(diff) < 3 ? "neutral" : diff < 0 ? "better" : "worse",
      previousDate
    });
  }

  return deltas;
}

function buildSwimMetrics(current: ActivityMetrics, previous: ActivityMetrics, previousDate: string): MetricDelta[] {
  const deltas: MetricDelta[] = [];

  if (current.avgPacePer100mSec != null && previous.avgPacePer100mSec != null) {
    const diff = current.avgPacePer100mSec - previous.avgPacePer100mSec;
    deltas.push({
      metric: "Avg Pace",
      current: formatSwimPace(current.avgPacePer100mSec),
      previous: formatSwimPace(previous.avgPacePer100mSec),
      delta: `${diff > 0 ? "+" : ""}${Math.round(diff)}s/100m`,
      direction: Math.abs(diff) < 2 ? "neutral" : diff < 0 ? "better" : "worse",
      previousDate
    });
  }

  if (current.avgSwolf != null && previous.avgSwolf != null) {
    const diff = current.avgSwolf - previous.avgSwolf;
    deltas.push({
      metric: "Avg SWOLF",
      current: `${Math.round(current.avgSwolf)}`,
      previous: `${Math.round(previous.avgSwolf)}`,
      delta: `${diff > 0 ? "+" : ""}${Math.round(diff)}`,
      direction: Math.abs(diff) < 2 ? "neutral" : diff < 0 ? "better" : "worse",
      previousDate
    });
  }

  return deltas;
}

export async function getSessionComparison(
  supabase: SupabaseClient,
  sessionId: string,
  athleteId: string,
  comparisonSessionId?: string
): Promise<SessionComparison | null> {
  // Load the target session
  const { data: targetSession } = await supabase
    .from("sessions")
    .select("id,date,sport,type,duration_minutes,status")
    .eq("id", sessionId)
    .eq("user_id", athleteId)
    .maybeSingle();

  if (!targetSession) return null;
  const session = targetSession as SessionRow;

  if (session.status !== "completed") return null;

  let previousSession: SessionRow | null = null;

  // If a specific comparison session was requested, use it directly
  if (comparisonSessionId) {
    const { data: specifiedSession } = await supabase
      .from("sessions")
      .select("id,date,sport,type,duration_minutes,status")
      .eq("id", comparisonSessionId)
      .eq("user_id", athleteId)
      .maybeSingle();
    previousSession = specifiedSession as SessionRow | null;
  }

  // Otherwise, find candidate previous sessions by type+sport match
  if (!previousSession) {
    const durationMin = session.duration_minutes ? session.duration_minutes * 0.8 : 0;
    const durationMax = session.duration_minutes ? session.duration_minutes * 1.2 : 99999;

    let { data: candidates } = await supabase
      .from("sessions")
      .select("id,date,sport,type,duration_minutes,status")
      .eq("user_id", athleteId)
      .eq("sport", session.sport)
      .eq("type", session.type)
      .eq("status", "completed")
      .lt("date", session.date)
      .order("date", { ascending: false })
      .limit(5);

    // Fallback: match by sport + similar duration if no type match
    if (!candidates || candidates.length === 0) {
      const { data: fallback } = await supabase
        .from("sessions")
        .select("id,date,sport,type,duration_minutes,status")
        .eq("user_id", athleteId)
        .eq("sport", session.sport)
        .eq("status", "completed")
        .lt("date", session.date)
        .gte("duration_minutes", Math.floor(durationMin))
        .lte("duration_minutes", Math.ceil(durationMax))
        .order("date", { ascending: false })
        .limit(5);
      candidates = fallback;
    }

    if (candidates && candidates.length > 0) {
      previousSession = (candidates as SessionRow[])[0];
    }
  }

  if (!previousSession) return null;

  // Load linked activity metrics for both sessions
  async function getActivityMetrics(sid: string): Promise<ActivityMetrics> {
    const { data: link } = await supabase
      .from("session_activity_links")
      .select("completed_activity_id")
      .eq("planned_session_id", sid)
      .eq("user_id", athleteId)
      .limit(1)
      .maybeSingle();

    if (!link?.completed_activity_id) return {};

    const { data: activity } = await supabase
      .from("completed_activities")
      .select("avg_hr,avg_power,avg_pace_per_100m_sec,duration_sec,distance_m,metrics_v2")
      .eq("id", link.completed_activity_id)
      .maybeSingle();

    if (!activity) return {};

    const base = parseActivityMetrics(activity.metrics_v2 as Record<string, unknown> | null);
    return {
      ...base,
      avgHr: base.avgHr ?? (activity.avg_hr as number | null),
      avgPower: base.avgPower ?? (activity.avg_power as number | null),
      avgPacePer100mSec: base.avgPacePer100mSec ?? (activity.avg_pace_per_100m_sec as number | null),
      durationSec: base.durationSec ?? (activity.duration_sec as number | null)
    };
  }

  const [currentMetrics, previousMetrics] = await Promise.all([
    getActivityMetrics(session.id),
    getActivityMetrics(previousSession.id)
  ]);

  let metricDeltas: MetricDelta[] = [];
  const sport = session.sport.toLowerCase();

  if (sport === "run") {
    metricDeltas = buildRunMetrics(currentMetrics, previousMetrics, previousSession.date);
  } else if (sport === "bike" || sport === "cycling") {
    metricDeltas = buildBikeMetrics(currentMetrics, previousMetrics, previousSession.date);
  } else if (sport === "swim") {
    metricDeltas = buildSwimMetrics(currentMetrics, previousMetrics, previousSession.date);
  } else if (sport === "strength") {
    metricDeltas = buildStrengthMetrics(currentMetrics, previousMetrics, previousSession.date);
  }

  if (metricDeltas.length === 0) return null;

  return {
    previousSessionId: previousSession.id,
    previousDate: previousSession.date,
    metrics: metricDeltas
  };
}
