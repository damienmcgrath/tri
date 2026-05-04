import type { IntentBucket, IntentMatchStatus, IssueKey } from "./session-diagnosis";

export function getSummary(status: IntentMatchStatus, issues: IssueKey[], bucket: IntentBucket): string {
  if (status === "matched_intent") {
    return "Execution stayed aligned with the planned intent.";
  }

  const issueText: Record<IssueKey, string> = {
    too_hard: "effort ran too hard for the planned day",
    too_variable: "effort fluctuated more than intended",
    high_hr: "heart rate sat above the intended aerobic range",
    late_drift: "effort drifted upward in the second half",
    under_target: "quality work sat below target",
    over_target: "quality work overshot the target",
    incomplete_reps: "planned reps were not fully completed",
    shortened: "session finished shorter than planned",
    inconsistent_execution: "interval execution was inconsistent",
    started_too_hard: "the session started too aggressively",
    faded_late: "late-session fade suggests pacing or fueling issues",
    sparse_data: "available data is too limited for a strict diagnosis"
  };

  const topIssue = issueText[issues[0] ?? "sparse_data"];

  if (bucket === "recovery") {
    return `Recovery intent was not fully met: ${topIssue}.`;
  }

  return status === "missed_intent"
    ? `Session missed intent: ${topIssue}.`
    : `Session partially matched intent: ${topIssue}.`;
}

export function getWhyItMatters(status: IntentMatchStatus, issues: IssueKey[], bucket: IntentBucket): string {
  if (status === "matched_intent") {
    if (bucket === "recovery") {
      return "Well-controlled recovery sessions help the next quality work land without unnecessary fatigue carryover.";
    }

    if (bucket === "threshold_quality") {
      return "Hitting the planned quality stimulus is what makes these sessions worth carrying through the week.";
    }

    return "Matching the planned session intent preserves the adaptation you wanted from the day and supports the rest of the week.";
  }

  if (issues.includes("faded_late") || issues.includes("started_too_hard")) {
    return "Pacing errors in longer sessions can compromise durability and race-day execution.";
  }

  if (issues.includes("too_hard") || issues.includes("high_hr")) {
    return "Repeatedly overcooking easy days can blunt adaptation and increase fatigue carryover.";
  }

  if (issues.includes("under_target") || issues.includes("incomplete_reps")) {
    return "Missing quality targets reduces the specific stimulus this workout was meant to deliver.";
  }

  if (issues.includes("sparse_data")) {
    return "Low data quality means this diagnosis should be treated as directional, not definitive.";
  }

  return "Execution drift from intent can lower the training value of the session.";
}

export function getNextAction(status: IntentMatchStatus, issues: IssueKey[], bucket: IntentBucket): string {
  if (status === "matched_intent") {
    if (bucket === "recovery") {
      return "Good control. Keep the same easy-day discipline on the next recovery session.";
    }

    if (bucket === "threshold_quality") {
      return "Good control. Keep the same pacing and execution structure on the next quality session.";
    }

    return "Good control. Keep the same execution approach next time.";
  }

  if (issues.includes("too_hard") || issues.includes("high_hr")) {
    return "On the next similar session, cap intensity early and keep the first third deliberately easy.";
  }

  if (issues.includes("under_target")) {
    return "Repeat this quality set with slightly longer recoveries so you can hit target output consistently.";
  }

  if (issues.includes("over_target")) {
    return "Start the first rep 2-3% easier and build only if control stays solid through the final reps.";
  }

  if (issues.includes("incomplete_reps") || issues.includes("shortened")) {
    return "Keep the next session structure intact, even if you reduce intensity modestly to complete all work.";
  }

  if (issues.includes("faded_late") || issues.includes("started_too_hard")) {
    return "Open long sessions more conservatively and plan fueling earlier to protect late-session quality.";
  }

  if (bucket === "swim_strength") {
    return "Prioritize full session completion and smooth execution before adding extra intensity.";
  }

  return "Use this result as feedback and aim for tighter control against the planned intent next time.";
}
