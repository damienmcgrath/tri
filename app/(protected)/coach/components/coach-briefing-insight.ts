import type { CoachBriefingContext, CoachDiagnosisSession } from "../types";
import type { Message } from "./coach-message";

export type IntentMatchStatus = "matched" | "partial" | "missed";
export type SessionDiagnosis = CoachDiagnosisSession;

export type TopCoachingInsight = {
  headline: string;
  rationale: string;
  primaryAction: { label: string; href: string };
  secondaryAction: { label: string; href: string };
  confidenceNote: string | null;
};

export type DiagnosisTheme =
  | "easy_drift"
  | "recovery_slip"
  | "threshold_inconsistent"
  | "endurance_strong"
  | "general";

export type RankedSession = SessionDiagnosis & {
  rankingScore: number;
  themes: DiagnosisTheme[];
};

export function buildOpeningMessage(
  briefing: CoachBriefingContext,
  diagnoses: SessionDiagnosis[]
): Message {
  const reviewed = briefing.reviewedSessionCount;
  const onTarget = diagnoses.filter((d) => d.executionScoreBand === "On target").length;
  const partial = diagnoses.filter((d) => d.executionScoreBand === "Partial match").length;
  const missed = diagnoses.filter((d) => d.executionScoreBand === "Missed intent").length;
  const latest = diagnoses[0];
  const latestName = latest?.sessionName ?? null;
  const nextKey = briefing.upcomingKeySessionNames?.[0] ?? null;

  let content: string;
  if (reviewed === 0 && briefing.uploadedSessionCount === 0) {
    content = nextKey
      ? `No sessions reviewed yet — once you upload activity data I can dig into execution. Want to talk through ${nextKey} in the meantime?`
      : "No sessions reviewed yet. Upload an activity or link one to a planned session and I'll break down the execution.";
  } else if (missed >= 2) {
    content = `${missed} sessions came in below target recently${latestName ? `, most recently ${latestName}` : ""}. Want to look at what's driving that before we plan the next one?`;
  } else if (partial >= 1 && missed === 0) {
    content = `Mostly on track — ${onTarget} on target, ${partial} partial${latestName ? ` (latest: ${latestName})` : ""}. Anything about the partial sessions that felt off to you?`;
  } else if (onTarget >= 3 && missed === 0) {
    content = `You're stacking clean sessions — ${onTarget} on target and nothing missed. Before we talk about next week, is there anything that felt off?`;
  } else if (latestName) {
    content = `I've got ${reviewed} reviewed session${reviewed === 1 ? "" : "s"} in the picture, most recently ${latestName}. What do you want to dig into?`;
  } else {
    content = "I can use execution scores and intent-match review to explain what happened in completed sessions, then help you decide exactly what to adjust next.";
  }

  return { id: "coach-default", role: "assistant", content };
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function deriveTopInsight(sessions: SessionDiagnosis[], briefingContext: CoachBriefingContext): TopCoachingInsight {
  const hasEnoughDiagnosis = sessions.length >= 2;
  if (!hasEnoughDiagnosis) {
    const latestScored = [...sessions].find((session) => session.executionScoreBand);
    if (briefingContext.reviewedSessionCount > 0 || briefingContext.pendingReviewCount > 0 || briefingContext.linkedSessionCount > 0) {
      return {
        headline:
          briefingContext.reviewedSessionCount > 0
            ? `${briefingContext.reviewedSessionCount} session review${briefingContext.reviewedSessionCount > 1 ? "s" : ""} ready`
            : `${briefingContext.linkedSessionCount} linked session${briefingContext.linkedSessionCount > 1 ? "s" : ""} waiting for review`,
        rationale:
          briefingContext.reviewedSessionCount > 0
            ? `Coach already has ${briefingContext.reviewedSessionCount} reviewed session${briefingContext.reviewedSessionCount > 1 ? "s" : ""} to work from${briefingContext.pendingReviewCount > 0 ? `, with ${briefingContext.pendingReviewCount} more linked and still processing` : ""}. Use this as an execution snapshot while the review set grows.`
            : `You have ${briefingContext.uploadedSessionCount} uploaded activit${briefingContext.uploadedSessionCount === 1 ? "y" : "ies"} and ${briefingContext.linkedSessionCount} linked session${briefingContext.linkedSessionCount > 1 ? "s" : ""}. Coach briefing should focus on what is already connected, not ask you to start from scratch.`,
        primaryAction: { label: "Ask why", href: "#coaching-chat" },
        secondaryAction: { label: "Review weekly plan", href: "/plan" },
        confidenceNote: briefingContext.pendingReviewCount > 0 ? `${briefingContext.pendingReviewCount} pending review` : "Early review set"
      };
    }

    return {
      headline: latestScored ? `Latest review: ${scoreHeadline(latestScored)}` : "Start with 1–2 completed sessions to unlock intent-match coaching",
      rationale:
        latestScored
          ? `${latestScored.sessionName} is already giving an execution-quality signal. One more reviewed session will make weekly coaching much more specific.`
          : "You can already ask about missed-session recovery, schedule adjustments, and conservative load planning. As soon as more workouts are completed, session-quality diagnosis becomes specific.",
      primaryAction: { label: "Ask why", href: "#coaching-chat" },
      secondaryAction: { label: "Review weekly plan", href: "/plan" },
      confidenceNote: "Provisional insight"
    };
  }

  const rankedSessions = rankFlaggedSessions(sessions);
  const strongestFlag = rankedSessions[0];
  const onTargetCount = sessions.filter((session) => session.executionScoreBand === "On target").length;
  const partialCountAll = sessions.filter((session) => session.executionScoreBand === "Partial match").length;
  const missedCountAll = sessions.filter((session) => session.executionScoreBand === "Missed intent").length;
  const provisionalCount = sessions.filter((session) => session.executionScoreProvisional).length;

  if (!strongestFlag) {
    const strongEnduranceSignal = sessions.some((session) => inferThemes(session).includes("endurance_strong"));

    return {
      headline: strongEnduranceSignal ? "Endurance execution is strong — stay the course" : "Execution quality is strong — stay the course",
      rationale:
        "Recent completed sessions are aligning with intended purpose. Maintain current structure and only progress if recovery remains stable.",
      primaryAction: { label: "Review recommendation", href: "/plan" },
      secondaryAction: { label: "What matters most now?", href: "#coaching-chat" },
      confidenceNote: null
    };
  }

  const missedCount = rankedSessions.filter((session) => session.status === "missed").length;
  const partialCount = rankedSessions.filter((session) => session.status === "partial").length;

  if (strongestFlag.themes.includes("easy_drift")) {
    return {
      headline: `Easy sessions are drifting too hard${strongestFlag.executionScoreBand ? ` · ${scoreHeadline(strongestFlag)}` : ""}`,
      rationale:
        "Diagnosis is repeatedly detecting intensity drift away from easy intent. Protecting low-intensity execution now improves recovery and quality-session readiness.",
      primaryAction: { label: "See what to change", href: "#sessions-needing-attention" },
      secondaryAction: { label: "How to keep Z2 easy", href: "#coaching-chat" },
      confidenceNote: "Diagnosis confidence: useful"
    };
  }

  if (strongestFlag.themes.includes("recovery_slip")) {
    return {
      headline: `Recovery quality is slipping${strongestFlag.executionScoreBand ? ` · ${scoreHeadline(strongestFlag)}` : ""}`,
      rationale: strongestFlag.whyItMatters,
      primaryAction: { label: "Protect recovery", href: "/plan" },
      secondaryAction: { label: "Review flagged sessions", href: "#sessions-needing-attention" },
      confidenceNote: strongestFlag.confidenceNote ?? null
    };
  }

  if (strongestFlag.themes.includes("threshold_inconsistent")) {
    return {
      headline: `Threshold execution is inconsistent${strongestFlag.executionScoreBand ? ` · ${scoreHeadline(strongestFlag)}` : ""}`,
      rationale:
        "Quality-session diagnosis shows uneven control versus planned intent. Tightening pacing before adding load will improve adaptation quality.",
      primaryAction: { label: "Adjust this week", href: "/plan" },
      secondaryAction: { label: "Ask why", href: "#coaching-chat" },
      confidenceNote: strongestFlag.confidenceNote ?? null
    };
  }

  if (strongestFlag.status === "missed") {
    return {
      headline:
        missedCountAll > 1
          ? `Execution is off-target in ${pluralize(missedCountAll, "session")} this week`
          : `${strongestFlag.sessionName} needs attention this week`,
      rationale:
        missedCountAll > 1
          ? `${pluralize(onTargetCount, "review")} are on target, but ${pluralize(missedCountAll, "session")} missed intent. Start by addressing ${strongestFlag.sessionName}, then keep the rest of the week steady.`
          : `${pluralize(onTargetCount, "review")} are on target, but ${strongestFlag.sessionName} missed intent${provisionalCount > 0 ? ` and most scores are still provisional` : ""}.`,
      primaryAction: { label: "Adjust this week", href: "/plan" },
      secondaryAction: { label: "Review flagged sessions", href: "#sessions-needing-attention" },
      confidenceNote: "Diagnosis confidence: useful"
    };
  }

  if (missedCount >= 1 || partialCount >= 1) {
    return {
      headline:
        onTargetCount > 0
          ? `Execution is mostly on target, with ${pluralize(partialCountAll + missedCountAll, "session")} needing attention`
          : "Execution quality is mixed — tighten session control this week",
      rationale:
        strongestFlag
          ? `${pluralize(onTargetCount, "review")} are on target, but ${strongestFlag.sessionName} came up short${provisionalCount > 0 ? `. Most reviews are still early reads, so keep the signal in mind without over-correcting the week.` : "."}`
          : "You have enough completion to progress, but easy/recovery intent is not consistently protected. Small execution changes now can improve adaptation quality this week.",
      primaryAction: { label: "See what to change", href: "#sessions-needing-attention" },
      secondaryAction: { label: "Ask why", href: "#coaching-chat" },
      confidenceNote: null
    };
  }

  return {
    headline: "Execution quality is strong — stay the course",
    rationale:
      "Recent completed sessions are aligning with intended purpose. Maintain current structure and only progress if recovery remains stable.",
    primaryAction: { label: "Review recommendation", href: "/plan" },
    secondaryAction: { label: "What matters most now?", href: "#coaching-chat" },
    confidenceNote: null
  };
}

export function inferThemes(session: SessionDiagnosis): DiagnosisTheme[] {
  const searchable = [session.plannedIntent, session.executionSummary, session.nextAction, session.whyItMatters, ...session.evidence]
    .join(" ")
    .toLowerCase();
  const themes = new Set<DiagnosisTheme>();

  if (/(easy|z1|z2|recovery ride|recovery run|too hard|high intensity)/.test(searchable)) {
    themes.add("easy_drift");
  }

  if (/(recover|fatigue|fresh|sleep|rest|carryover)/.test(searchable)) {
    themes.add("recovery_slip");
  }

  if (/(threshold|tempo|interval|vo2|quality)/.test(searchable)) {
    themes.add("threshold_inconsistent");
  }

  if (session.status === "matched" && /(endurance|long|aerobic|z2)/.test(searchable)) {
    themes.add("endurance_strong");
  }

  if (themes.size === 0) {
    themes.add("general");
  }

  return [...themes];
}

export function rankFlaggedSessions(sessions: SessionDiagnosis[]): RankedSession[] {
  return sessions
    .filter((session) => session.status !== "matched")
    .map((session) => {
      const themes = inferThemes(session);
      const statusWeight = session.status === "missed" ? 40 : 20;
      const scorePenalty = session.executionScore === null ? 0 : Math.max(0, 30 - Math.round(session.executionScore / 3));
      const bandWeight = session.executionScoreBand === "Missed intent" ? 20 : session.executionScoreBand === "Partial match" ? 10 : 0;
      const evidenceWeight = Math.min(session.evidence.length * 3, 9);
      const rankingScore = statusWeight + scorePenalty + bandWeight + evidenceWeight + session.importance;

      return { ...session, rankingScore, themes };
    })
    .sort((a, b) => b.rankingScore - a.rankingScore)
    .slice(0, 3);
}

export function statusChip(status: IntentMatchStatus): { label: string; className: string } {
  if (status === "matched") {
    return { label: "Matched intent", className: "signal-ready" };
  }
  if (status === "partial") {
    return { label: "Partially matched", className: "signal-load" };
  }
  return { label: "Missed intent", className: "signal-risk" };
}

export function scoreHeadline(session: Pick<SessionDiagnosis, "executionScore" | "executionScoreBand" | "executionScoreProvisional">) {
  if (!session.executionScoreBand) {
    return session.executionScoreProvisional ? "Provisional review" : "Awaiting score";
  }
  if (session.executionScoreProvisional || session.executionScore === null) {
    return `Provisional · ${session.executionScoreBand}`;
  }
  return `${session.executionScore} · ${session.executionScoreBand}`;
}

export function executionScoreBandTone(band: SessionDiagnosis["executionScoreBand"]): string {
  if (band === "On target") {
    return "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]";
  }
  if (band === "Partial match") {
    return "border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] text-[hsl(var(--warning))]";
  }
  return "border-[hsl(var(--danger)/0.3)] bg-[hsl(var(--danger)/0.08)] text-[hsl(var(--danger))]";
}
