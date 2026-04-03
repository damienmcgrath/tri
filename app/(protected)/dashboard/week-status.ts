export type StatusChip = {
  label: string;
  className: string;
};

export type ExecutionRisk = "easy_control" | "recovery_control" | "bike_consistency" | "strong_execution";

export function getStatusChip(completionPct: number, expectedByTodayPct: number): StatusChip {
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
