import { createHash } from "crypto";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: true,
  trimValues: true
});

type Sport = "swim" | "bike" | "run" | "strength" | "other";

export type NormalizedCompletedSession = {
  garminId: string;
  date: string;
  sport: Sport;
  metrics: Record<string, number>;
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function toSport(rawSport: string | undefined): Sport {
  const sport = rawSport?.toLowerCase();

  if (sport?.includes("running") || sport === "run") {
    return "run";
  }

  if (sport?.includes("biking") || sport?.includes("cycling") || sport === "bike") {
    return "bike";
  }

  if (sport?.includes("swimming") || sport === "swim") {
    return "swim";
  }

  if (sport?.includes("strength")) {
    return "strength";
  }

  return "other";
}

function buildFallbackId(input: { activityId: string; sport: Sport; distanceM: number; durationS: number }) {
  return createHash("sha256")
    .update(`${input.activityId}:${input.sport}:${input.distanceM}:${input.durationS}`)
    .digest("hex");
}

export function parseTcxToSessions(xml: string): NormalizedCompletedSession[] {
  const doc = parser.parse(xml) as {
    TrainingCenterDatabase?: {
      Activities?: {
        Activity?:
          | {
              Sport?: string;
              Id?: string;
              Lap?:
                | {
                    TotalTimeSeconds?: number;
                    DistanceMeters?: number;
                    Calories?: number;
                    AverageHeartRateBpm?: { Value?: number };
                    MaximumHeartRateBpm?: { Value?: number };
                  }
                | Array<{
                    TotalTimeSeconds?: number;
                    DistanceMeters?: number;
                    Calories?: number;
                    AverageHeartRateBpm?: { Value?: number };
                    MaximumHeartRateBpm?: { Value?: number };
                  }>;
            }
          | Array<{
              Sport?: string;
              Id?: string;
              Lap?:
                | {
                    TotalTimeSeconds?: number;
                    DistanceMeters?: number;
                    Calories?: number;
                    AverageHeartRateBpm?: { Value?: number };
                    MaximumHeartRateBpm?: { Value?: number };
                  }
                | Array<{
                    TotalTimeSeconds?: number;
                    DistanceMeters?: number;
                    Calories?: number;
                    AverageHeartRateBpm?: { Value?: number };
                    MaximumHeartRateBpm?: { Value?: number };
                  }>;
            }>;
      };
    };
  };

  const activities = asArray(doc.TrainingCenterDatabase?.Activities?.Activity);

  return activities
    .map((activity) => {
      const laps = asArray(activity.Lap);
      const dateTime = activity.Id ? new Date(activity.Id) : null;

      if (!dateTime || Number.isNaN(dateTime.getTime())) {
        return null;
      }

      const durationS = laps.reduce((sum, lap) => sum + Number(lap.TotalTimeSeconds ?? 0), 0);
      const distanceM = laps.reduce((sum, lap) => sum + Number(lap.DistanceMeters ?? 0), 0);
      const calories = laps.reduce((sum, lap) => sum + Number(lap.Calories ?? 0), 0);
      const avgHrSamples = laps
        .map((lap) => Number(lap.AverageHeartRateBpm?.Value ?? 0))
        .filter((value) => value > 0);
      const maxHr = Math.max(0, ...laps.map((lap) => Number(lap.MaximumHeartRateBpm?.Value ?? 0)));
      const avgHr =
        avgHrSamples.length > 0
          ? Math.round(avgHrSamples.reduce((sum, value) => sum + value, 0) / avgHrSamples.length)
          : 0;

      const sport = toSport(activity.Sport);
      const activityId = activity.Id ?? dateTime.toISOString();

      const paceSPerKm = distanceM > 0 ? Math.round(durationS / (distanceM / 1000)) : 0;

      const metrics: Record<string, number> = {
        duration_s: Math.round(durationS),
        distance_m: Math.round(distanceM),
        calories: Math.round(calories)
      };

      if (avgHr > 0) {
        metrics.avg_hr = avgHr;
      }

      if (maxHr > 0) {
        metrics.max_hr = maxHr;
      }

      if (paceSPerKm > 0) {
        metrics.pace_s_per_km = paceSPerKm;
      }

      return {
        garminId: buildFallbackId({ activityId, sport, distanceM, durationS }),
        date: dateTime.toISOString().slice(0, 10),
        sport,
        metrics
      } satisfies NormalizedCompletedSession;
    })
    .filter((session): session is NormalizedCompletedSession => Boolean(session));
}
