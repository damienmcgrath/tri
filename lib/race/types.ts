export type RaceSegmentRole = "swim" | "t1" | "bike" | "t2" | "run";

export type RaceSegmentSummary = {
  activityId: string;
  role: RaceSegmentRole;
  sport: string;
  startTimeUtc: string;
  durationSec: number;
  distanceM: number | null;
  avgHr: number | null;
  avgPower: number | null;
};
