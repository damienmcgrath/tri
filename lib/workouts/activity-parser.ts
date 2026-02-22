import { createHash } from "crypto";
import FitParser from "fit-file-parser";
import { XMLParser } from "fast-xml-parser";

export type ParsedActivity = {
  sportType: string;
  startTimeUtc: string;
  endTimeUtc: string;
  durationSec: number;
  distanceM: number;
  avgHr: number | null;
  avgPower: number | null;
  calories: number | null;
  parseSummary?: Record<string, unknown>;
};

const tcxParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseTagValue: true, trimValues: true });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeSport(raw?: string) {
  const sport = (raw ?? "").toLowerCase();
  if (sport.includes("run")) return "run";
  if (sport.includes("bike") || sport.includes("cycl")) return "bike";
  if (sport.includes("swim")) return "swim";
  if (sport.includes("strength")) return "strength";
  return "other";
}

export function sha256Hex(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

export async function parseFitFile(buffer: Buffer): Promise<ParsedActivity> {
  const parser = new FitParser({ force: true, speedUnit: "m/s", lengthUnit: "m", temperatureUnit: "celsius" });

  const fit = await new Promise<any>((resolve, reject) => {
    parser.parse(buffer as any, (error: unknown, data: unknown) => {
      if (error) reject(error);
      else resolve(data);
    });
  });

  const session = fit?.sessions?.[0];
  if (!session?.start_time) {
    throw new Error("FIT file missing session start time.");
  }

  const start = new Date(session.start_time);
  const durationSec = Math.round(Number(session.total_elapsed_time ?? session.total_timer_time ?? 0));
  const end = new Date(start.getTime() + durationSec * 1000);

  return {
    sportType: normalizeSport(session.sport),
    startTimeUtc: start.toISOString(),
    endTimeUtc: end.toISOString(),
    durationSec,
    distanceM: Number(session.total_distance ?? 0),
    avgHr: session.avg_heart_rate ? Number(session.avg_heart_rate) : null,
    avgPower: session.avg_power ? Number(session.avg_power) : null,
    calories: session.total_calories ? Number(session.total_calories) : null,
    parseSummary: { records: Array.isArray(fit?.records) ? fit.records.length : 0 }
  };
}

export function parseTcxFile(xml: string): ParsedActivity {
  const doc = tcxParser.parse(xml) as any;
  const activity = asArray(doc?.TrainingCenterDatabase?.Activities?.Activity)[0];
  if (!activity) throw new Error("No activity found in TCX file.");

  const laps = asArray(activity.Lap);
  const start = new Date(activity.Id);
  if (Number.isNaN(start.getTime())) throw new Error("TCX activity start time is invalid.");

  const durationSec = Math.round(laps.reduce((sum, lap) => sum + Number(lap.TotalTimeSeconds ?? 0), 0));
  const distanceM = laps.reduce((sum, lap) => sum + Number(lap.DistanceMeters ?? 0), 0);
  const calories = Math.round(laps.reduce((sum, lap) => sum + Number(lap.Calories ?? 0), 0));
  const avgHrValues = laps.map((lap) => Number(lap.AverageHeartRateBpm?.Value ?? 0)).filter((value) => value > 0);
  const avgHr = avgHrValues.length ? Math.round(avgHrValues.reduce((a, b) => a + b, 0) / avgHrValues.length) : null;

  return {
    sportType: normalizeSport(activity.Sport),
    startTimeUtc: start.toISOString(),
    endTimeUtc: new Date(start.getTime() + durationSec * 1000).toISOString(),
    durationSec,
    distanceM,
    avgHr,
    avgPower: null,
    calories,
    parseSummary: { lapCount: laps.length }
  };
}
