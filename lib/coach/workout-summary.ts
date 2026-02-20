export type Sport = "swim" | "bike" | "run" | "strength" | "other";

export type PlannedSessionLite = {
  sport: Sport;
  duration: number;
};

export type CompletedSessionLite = {
  sport: Sport;
  metrics: {
    duration_s?: number;
    distance_m?: number;
  };
};

export type WorkoutSummary = {
  plannedMinutes: number;
  completedMinutes: number;
  completionPct: number;
  dominantSport: Sport | "none";
  insights: string[];
};

function getDominantSportFromDuration(sportMinutes: Record<Sport, number>): Sport | "none" {
  const entries = Object.entries(sportMinutes) as Array<[Sport, number]>;
  const sorted = entries.sort((a, b) => b[1] - a[1]);

  if (sorted[0]?.[1] > 0) {
    return sorted[0][0];
  }

  return "none";
}

export function buildWorkoutSummary(
  plannedSessions: PlannedSessionLite[],
  completedSessions: CompletedSessionLite[]
): WorkoutSummary {
  const plannedMinutes = plannedSessions.reduce((sum, session) => sum + session.duration, 0);

  const completedMinutes = completedSessions.reduce(
    (sum, session) => sum + Math.round((session.metrics.duration_s ?? 0) / 60),
    0
  );

  const completionPct = plannedMinutes === 0 ? 0 : Math.round((completedMinutes / plannedMinutes) * 100);

  const sportMinutes: Record<Sport, number> = {
    swim: 0,
    bike: 0,
    run: 0,
    strength: 0,
    other: 0
  };

  for (const session of completedSessions) {
    sportMinutes[session.sport] += Math.round((session.metrics.duration_s ?? 0) / 60);
  }

  const dominantSport = getDominantSportFromDuration(sportMinutes);

  const insights: string[] = [];

  if (plannedMinutes === 0) {
    insights.push("No planned sessions were found for this period yet.");
  } else if (completionPct >= 90) {
    insights.push("Excellent consistency — you completed almost all planned training time.");
  } else if (completionPct >= 70) {
    insights.push("Good momentum — small adjustments could bring you close to full completion.");
  } else {
    insights.push("You’re below target this period — consider reducing complexity and protecting key sessions.");
  }

  if (dominantSport !== "none") {
    insights.push(`Most of your completed time was in ${dominantSport}.`);
  }

  return {
    plannedMinutes,
    completedMinutes,
    completionPct,
    dominantSport,
    insights
  };
}
