/**
 * Training score constants: ideal race distributions, score thresholds, and colour mapping.
 */

// Ideal swim/bike/run distributions by race type (as fractions of total training time)
export const RACE_TYPE_DISTRIBUTIONS: Record<string, { swim: number; bike: number; run: number }> = {
  sprint: { swim: 0.20, bike: 0.35, run: 0.35 },
  olympic: { swim: 0.20, bike: 0.35, run: 0.35 },
  "70.3": { swim: 0.15, bike: 0.40, run: 0.30 },
  ironman: { swim: 0.12, bike: 0.45, run: 0.28 },
  // General fitness default (no specific race)
  general: { swim: 0.25, bike: 0.35, run: 0.30 }
};

// Verdict status → score mapping
export const VERDICT_SCORE_MAP: Record<string, number> = {
  achieved: 100,
  partial: 60,
  off_target: 20,
  missed: 0
};

// Comparison trend → progression score mapping
export const TREND_SCORE_MAP: Record<string, Record<string, number>> = {
  improving: { high: 100, moderate: 85, low: 70 },
  stable: { high: 65, moderate: 55, low: 45 },
  declining: { high: 20, moderate: 30, low: 40 },
  insufficient_data: { high: 50, moderate: 50, low: 50 }
};

// Score display thresholds
export const SCORE_THRESHOLDS = {
  excellent: 75,       // >= 75 = cool green/teal
  solid: 50,           // 50-74 = neutral white
  needsAttention: 0    // < 50 = warm amber
} as const;

// Dimension weights (normal mode)
export const DIMENSION_WEIGHTS = {
  execution: 0.45,
  progression: 0.30,
  balance: 0.25
} as const;

// Dimension weights when progression is not yet active (< 2 weeks data)
export const DIMENSION_WEIGHTS_NO_PROGRESSION = {
  execution: 0.60,
  balance: 0.40
} as const;

// Rolling windows in days
export const EXECUTION_WINDOW_DAYS = 14;
export const PROGRESSION_WINDOW_DAYS = 28;
export const BALANCE_WINDOW_DAYS = 21;

// Minimum data requirements
export const MIN_WEEKS_FOR_PROGRESSION = 2;
export const MIN_VERDICTS_FOR_EXECUTION = 2;
