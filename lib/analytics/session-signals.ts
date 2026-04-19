/**
 * Pure derivations from a session's existing metrics. No DB access here.
 * These expand the signal the AI reviewer gets without needing new schema.
 */

export type AerobicDecoupling = {
  /** Percentage change in HR-per-output ratio from first half to second half. Positive = cardiac drift. */
  percent: number;
  /** Qualitative interpretation used to scaffold coaching language. */
  severity: "stable" | "mild_drift" | "significant_drift" | "poor_durability";
  /** "pace" (run) or "power" (bike). Decoupling is computed relative to this output. */
  basis: "pace" | "power";
  /** Raw halves so the model can cite them alongside the derived %. */
  firstHalf: { hr: number; output: number };
  secondHalf: { hr: number; output: number };
};

export type HrZoneDistribution = {
  zones: Array<{ zone: number; pct: number; seconds: number }>;
  /** Compact human-readable string: "Z1: 5% | Z2: 48% | Z3: 32% | Z4: 12% | Z5: 3%". */
  summary: string;
  totalSeconds: number;
};

export type WeatherSignal = {
  avgTemperatureC: number | null;
  minTemperatureC: number | null;
  maxTemperatureC: number | null;
  /** Flags conditions that materially affect interpretation. */
  notable: string[];
};

const DECOUPLING_EPSILON = 0.0001;

function severityForDecoupling(percent: number): AerobicDecoupling["severity"] {
  const abs = Math.abs(percent);
  if (abs < 3) return "stable";
  if (abs < 5) return "mild_drift";
  if (abs < 10) return "significant_drift";
  return "poor_durability";
}

/**
 * Aerobic decoupling: how much cardiac cost rose for the same (or lower) output.
 *
 * For bike (power-based):
 *   decoupling% = ((lastHr / lastPower) / (firstHr / firstPower) - 1) * 100
 *
 * For run (pace-based, where speed = 1/pace → HR/speed = HR*pace):
 *   decoupling% = ((lastHr * lastPace) / (firstHr * firstPace) - 1) * 100
 *
 * Returns null if we don't have enough evidence (missing halves, zero output, etc.).
 * We intentionally skip swim — pool-pace halves are too noisy from push-offs.
 */
export function computeAerobicDecoupling(args: {
  sport: string;
  firstHalfAvgHr: number | null | undefined;
  lastHalfAvgHr: number | null | undefined;
  firstHalfAvgPower?: number | null | undefined;
  lastHalfAvgPower?: number | null | undefined;
  firstHalfPaceSPerKm?: number | null | undefined;
  lastHalfPaceSPerKm?: number | null | undefined;
}): AerobicDecoupling | null {
  const { sport, firstHalfAvgHr: fHr, lastHalfAvgHr: lHr } = args;
  if (!fHr || !lHr || fHr < DECOUPLING_EPSILON) return null;

  if (sport === "bike") {
    const fP = args.firstHalfAvgPower;
    const lP = args.lastHalfAvgPower;
    if (!fP || !lP || fP < DECOUPLING_EPSILON) return null;
    const firstRatio = fHr / fP;
    const lastRatio = lHr / lP;
    const percent = (lastRatio / firstRatio - 1) * 100;
    return {
      percent: Math.round(percent * 10) / 10,
      severity: severityForDecoupling(percent),
      basis: "power",
      firstHalf: { hr: fHr, output: fP },
      secondHalf: { hr: lHr, output: lP }
    };
  }

  if (sport === "run") {
    const fPace = args.firstHalfPaceSPerKm;
    const lPace = args.lastHalfPaceSPerKm;
    if (!fPace || !lPace || fPace < DECOUPLING_EPSILON) return null;
    // HR/speed = HR * pace (since speed = 1/pace). Higher = worse.
    const firstRatio = fHr * fPace;
    const lastRatio = lHr * lPace;
    const percent = (lastRatio / firstRatio - 1) * 100;
    return {
      percent: Math.round(percent * 10) / 10,
      severity: severityForDecoupling(percent),
      basis: "pace",
      firstHalf: { hr: fHr, output: fPace },
      secondHalf: { hr: lHr, output: lPace }
    };
  }

  return null;
}

/**
 * Convert raw zone time (in seconds per zone, index 0 = Z1) into a readable
 * distribution. Returns null if the input is empty or the total is zero.
 */
export function summarizeZoneDistribution(
  zoneTimesSec: Array<number | null | undefined> | null | undefined,
  label: "HR" | "pace" | "power" = "HR"
): HrZoneDistribution | null {
  if (!zoneTimesSec || zoneTimesSec.length === 0) return null;
  const normalized = zoneTimesSec.map((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0));
  const total = normalized.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return null;
  const zones = normalized.map((seconds, i) => ({
    zone: i + 1,
    seconds,
    pct: Math.round((seconds / total) * 100)
  }));
  const summary = zones
    .filter((z) => z.pct > 0)
    .map((z) => `${label === "HR" ? "Z" : label === "pace" ? "P" : "Z"}${z.zone}: ${z.pct}%`)
    .join(" | ");
  return { zones, summary, totalSeconds: total };
}

/**
 * Extract weather signal from a completed_activity's metrics_v2.environment blob.
 * Flags notable conditions so the AI can explain performance anomalies that a
 * metric-only read would miss (hot day → slower pace at same HR is expected).
 */
export function extractWeatherSignal(environment: unknown): WeatherSignal | null {
  if (!environment || typeof environment !== "object") return null;
  const env = environment as Record<string, unknown>;

  const toNumber = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const avg = toNumber(env.avgTemperature) ?? toNumber(env.temperature);
  const min = toNumber(env.minTemperature);
  const max = toNumber(env.maxTemperature);

  if (avg === null && min === null && max === null) return null;

  const notable: string[] = [];
  const temp = avg ?? max ?? min;
  if (temp !== null) {
    if (temp >= 28) notable.push("hot conditions (≥28°C)");
    else if (temp >= 24) notable.push("warm conditions (24-27°C)");
    else if (temp <= 2) notable.push("cold conditions (≤2°C)");
    else if (temp <= 8) notable.push("cool conditions (3-8°C)");
  }
  if (max !== null && min !== null && max - min >= 8) {
    notable.push(`large temp range (${Math.round(min)}-${Math.round(max)}°C)`);
  }

  return {
    avgTemperatureC: avg,
    minTemperatureC: min,
    maxTemperatureC: max,
    notable
  };
}
