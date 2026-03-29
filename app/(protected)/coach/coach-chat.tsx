"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CoachBriefingContext, CoachDiagnosisSession } from "./types";
import { getDiagnosisDataState } from "@/lib/ui/sparse-data";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  failed?: boolean;
  retryText?: string;
};

type CoachSummary = {
  plannedMinutes: number;
  completedMinutes: number;
  completionPct: number;
  dominantSport: string;
  insights: string[];
};

type Conversation = {
  id: string;
  title: string;
  updated_at: string;
};

type StreamCompletePayload = {
  conversationId: string;
  responseId?: string;
  structured: {
    headline: string;
    answer: string;
    insights: string[];
    actions: Array<{ type: string; label: string; payload?: Record<string, unknown> }>;
    warnings: string[];
  };
};

type IntentMatchStatus = "matched" | "partial" | "missed";
type SessionDiagnosis = CoachDiagnosisSession;

type TopCoachingInsight = {
  headline: string;
  rationale: string;
  primaryAction: { label: string; href: string };
  secondaryAction: { label: string; href: string };
  confidenceNote: string | null;
};

type DiagnosisTheme = "easy_drift" | "recovery_slip" | "threshold_inconsistent" | "endurance_strong" | "general";

type RankedSession = SessionDiagnosis & {
  rankingScore: number;
  themes: DiagnosisTheme[];
};

const defaultAssistantMessage: Message = {
  id: "coach-default",
  role: "assistant",
  content:
    "I can use execution scores and intent-match review to explain what happened in completed sessions, then help you decide exactly what to adjust next."
};

function createMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getWeekGroup(updatedAt: string): "this_week" | "last_week" | "older" {
  const date = new Date(updatedAt);
  const thisMonday = getMondayOf(new Date());
  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);

  if (date >= thisMonday) return "this_week";
  if (date >= lastMonday) return "last_week";
  return "older";
}

function groupConversations(conversations: Conversation[]): {
  thisWeek: Conversation[];
  lastWeek: Conversation[];
  older: Conversation[];
} {
  const thisWeek: Conversation[] = [];
  const lastWeek: Conversation[] = [];
  const older: Conversation[] = [];

  for (const conv of conversations) {
    const group = getWeekGroup(conv.updated_at);
    if (group === "this_week") thisWeek.push(conv);
    else if (group === "last_week") lastWeek.push(conv);
    else older.push(conv);
  }

  return { thisWeek, lastWeek, older };
}

function formatRecencyLabel(updatedAt?: string): string {
  if (!updatedAt) {
    return "Ready to start";
  }

  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Updated just now";
  }

  if (diffMinutes < 60) {
    return `Updated ${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function deriveTopInsight(sessions: SessionDiagnosis[], briefingContext: CoachBriefingContext): TopCoachingInsight {
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

function inferThemes(session: SessionDiagnosis): DiagnosisTheme[] {
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

function rankFlaggedSessions(sessions: SessionDiagnosis[]): RankedSession[] {
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

function statusChip(status: IntentMatchStatus): { label: string; className: string } {
  if (status === "matched") {
    return { label: "Matched intent", className: "signal-ready" };
  }
  if (status === "partial") {
    return { label: "Partially matched", className: "signal-load" };
  }
  return { label: "Missed intent", className: "signal-risk" };
}

function scoreHeadline(session: Pick<SessionDiagnosis, "executionScore" | "executionScoreBand" | "executionScoreProvisional">) {
  if (!session.executionScoreBand) {
    return session.executionScoreProvisional ? "Provisional review" : "Awaiting score";
  }
  if (session.executionScoreProvisional || session.executionScore === null) {
    return `Provisional · ${session.executionScoreBand}`;
  }
  return `${session.executionScore} · ${session.executionScoreBand}`;
}

function executionScoreBandTone(band: SessionDiagnosis["executionScoreBand"]): string {
  if (band === "On target") {
    return "border-[hsl(var(--success)/0.3)] bg-[hsl(var(--success)/0.08)] text-[hsl(var(--success))]";
  }
  if (band === "Partial match") {
    return "border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.08)] text-[hsl(var(--warning))]";
  }
  return "border-[hsl(var(--danger)/0.3)] bg-[hsl(var(--danger)/0.08)] text-[hsl(var(--danger))]";
}

export function CoachChat({
  diagnosisSessions,
  briefingContext,
  initialPrompt,
  showBriefingPanel = true
}: {
  diagnosisSessions: SessionDiagnosis[];
  briefingContext: CoachBriefingContext;
  initialPrompt?: string;
  showBriefingPanel?: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([defaultAssistantMessage]);
  const [summary, setSummary] = useState<CoachSummary | null>(null);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [hasRequestedReviewBackfill, setHasRequestedReviewBackfill] = useState(false);
  const [showOlderConversations, setShowOlderConversations] = useState(false);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const activeRequestRef = useRef<AbortController | null>(null);

  const sessionDiagnoses = useMemo(() => diagnosisSessions, [diagnosisSessions]);
  const flaggedSessions = useMemo(() => rankFlaggedSessions(sessionDiagnoses), [sessionDiagnoses]);
  const matchedSessions = useMemo(() => sessionDiagnoses.filter((session) => session.status === "matched"), [sessionDiagnoses]);
  const topInsight = useMemo(() => deriveTopInsight(sessionDiagnoses, briefingContext), [sessionDiagnoses, briefingContext]);
  const dataState = useMemo(() => getDiagnosisDataState(sessionDiagnoses.length), [sessionDiagnoses.length]);
  const latestScoredSession = useMemo(
    () => sessionDiagnoses.find((session) => session.executionScoreBand || session.executionScore !== null) ?? null,
    [sessionDiagnoses]
  );
  const scoreTrendSummary = useMemo(() => {
    if (sessionDiagnoses.length === 0) return "No reviewed sessions yet.";
    const onTarget = sessionDiagnoses.filter((session) => session.executionScoreBand === "On target").length;
    const partial = sessionDiagnoses.filter((session) => session.executionScoreBand === "Partial match").length;
    const missed = sessionDiagnoses.filter((session) => session.executionScoreBand === "Missed intent").length;
    const provisional = sessionDiagnoses.filter((session) => session.executionScoreProvisional).length;
    const pieces = [
      onTarget > 0 ? `${onTarget} on target` : null,
      partial > 0 ? `${partial} partial` : null,
      missed > 0 ? `${missed} missed` : null
    ].filter((value): value is string => Boolean(value));
    const trend = pieces.length > 0 ? pieces.join(", ") : "scores still building";
    return provisional > 0 ? `Execution trend: ${trend}. ${provisional} provisional.` : `Execution trend: ${trend}.`;
  }, [sessionDiagnoses]);
  const emptyAttentionText = useMemo(() => {
    if (briefingContext.pendingReviewCount > 0) {
      return `${briefingContext.pendingReviewCount} linked session${briefingContext.pendingReviewCount > 1 ? "s are" : " is"} waiting for review analysis. Coach can already see the uploads; it is waiting for scored session reviews.`;
    }

    if (briefingContext.linkedSessionCount > 0) {
      return `${briefingContext.linkedSessionCount} linked session${briefingContext.linkedSessionCount > 1 ? "s are" : " is"} connected, but no session reviews are ready yet.`;
    }

    if (briefingContext.uploadedSessionCount > 0) {
      return `${briefingContext.uploadedSessionCount} uploaded activit${briefingContext.uploadedSessionCount === 1 ? "y is" : "ies are"} available. Link them to planned sessions to unlock review guidance.`;
    }

    return dataState.unlockText;
  }, [briefingContext, dataState.unlockText]);

  const strongestTheme = flaggedSessions[0]?.themes[0] ?? null;

  const nextActions = useMemo(() => {
    if (sessionDiagnoses.length < 2) {
      return [
        "Protect 2–3 key sessions this week and keep the rest deliberately easy.",
        "Use Calendar to move sessions instead of stacking missed work.",
        "Ask for a conservative adjustment if recovery feels off."
      ];
    }

    const actions = new Set<string>();

    if (strongestTheme === "easy_drift") {
      actions.add("Keep easy days truly easy for the next 2 sessions.");
    }
    if (strongestTheme === "recovery_slip") {
      actions.add("Protect recovery before the weekend long ride.");
    }
    if (strongestTheme === "threshold_inconsistent") {
      actions.add("Reduce the next quality session by ~10% and prioritise control.");
    }

    flaggedSessions.forEach((session) => actions.add(session.nextAction));

    if (flaggedSessions.length === 0) {
      actions.add("Repeat current aerobic intent before progressing load.");
    }

    if ((summary?.completionPct ?? 100) < 75) {
      actions.add("Keep volume steady until session execution quality stabilises.");
    }

    return [...actions].slice(0, 4);
  }, [summary?.completionPct, sessionDiagnoses, flaggedSessions, strongestTheme]);

  const quickPrompts = useMemo(() => {
    // No diagnosis data — generic but useful starters
    if (sessionDiagnoses.length < 2) {
      return [
        "Which session should I protect this week?",
        "How should I adjust this week?",
        "What should stay easy vs key?"
      ];
    }

    const prompts: string[] = [];

    // Context-aware lead question based on week state
    const skippedCount = sessionDiagnoses.filter((s) => s.status === "missed").length;
    const completionPct = summary?.completionPct ?? 100;

    if (skippedCount > 0) {
      prompts.push(`How should I make up for the ${skippedCount} missed session${skippedCount > 1 ? "s" : ""}?`);
    } else if (completionPct >= 90) {
      prompts.push("Am I ready to increase volume next week?");
    }

    // Theme-specific question
    const themeQuestion =
      strongestTheme === "easy_drift" ? "How do I keep Z2 truly easy?" :
      strongestTheme === "recovery_slip" ? "How do I protect recovery this week?" :
      strongestTheme === "threshold_inconsistent" ? "Was this fatigue or pacing?" :
      latestScoredSession ? `Why was ${latestScoredSession.sessionName ?? "this session"} flagged?` :
      null;

    if (themeQuestion && !prompts.includes(themeQuestion)) {
      prompts.push(themeQuestion);
    }

    // Key session awareness
    const upcomingKey = briefingContext.upcomingKeySessionNames?.[0];
    if (upcomingKey && prompts.length < 3) {
      prompts.push(`What should I focus on for ${upcomingKey}?`);
    }

    // Fill remaining with universal follow-ups
    const fallbacks = ["What would move this to On target?", "What matters most now?"];
    for (const fb of fallbacks) {
      if (prompts.length >= 3) break;
      prompts.push(fb);
    }

    return prompts.slice(0, 3);
  }, [sessionDiagnoses, strongestTheme, summary?.completionPct, latestScoredSession, briefingContext.upcomingKeySessionNames]);

  const dataRecency = useMemo(() => {
    const activeConversation = conversations.find((conversation) => conversation.id === conversationId);
    return formatRecencyLabel(activeConversation?.updated_at ?? conversations[0]?.updated_at);
  }, [conversationId, conversations]);
  const activeConversation = useMemo(() => conversations.find((conversation) => conversation.id === conversationId) ?? null, [conversations, conversationId]);
  const condensedRationale = useMemo(() => {
    const compact = topInsight.rationale.replace(/\s+/g, " ").trim();
    if (compact.length <= 170) {
      return compact;
    }
    return `${compact.slice(0, 167).trimEnd()}…`;
  }, [topInsight.rationale]);

  async function loadConversations() {
    try {
      const response = await fetch("/api/coach/chat", { method: "GET" });
      const data = (await response.json()) as { conversations?: Conversation[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load conversations.");
      }

      setConversations(data.conversations ?? []);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Failed to load conversations.");
    }
  }

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    if (hasRequestedReviewBackfill || briefingContext.pendingReviewCount <= 0) {
      return;
    }

    let cancelled = false;

    async function requestReviewBackfill() {
      setHasRequestedReviewBackfill(true);

      try {
        const response = await fetch("/api/coach/review-backfill", { method: "POST" });
        const data = (await response.json()) as { updated?: number; error?: string };

        if (!response.ok || cancelled) {
          return;
        }

        if ((data.updated ?? 0) > 0) {
          router.refresh();
        }
      } catch {
        // Keep Coach usable even if background backfill fails.
      }
    }

    void requestReviewBackfill();

    return () => {
      cancelled = true;
    };
  }, [briefingContext.pendingReviewCount, hasRequestedReviewBackfill, router]);

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim().length > 0) {
      setInput(initialPrompt.trim());
    }
  }, [initialPrompt]);

  useEffect(() => {
    const viewport = messagesViewportRef.current;

    if (!viewport || !shouldAutoScrollRef.current) {
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight, behavior: isLoading ? "auto" : "smooth" });
  }, [messages, isLoading]);

  async function handleConversationClick(nextConversationId: string) {
    setError(null);

    try {
      const response = await fetch(`/api/coach/chat?conversationId=${nextConversationId}`, { method: "GET" });
      const data = (await response.json()) as { messages?: Message[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load conversation.");
      }

      setConversationId(nextConversationId);
      setMessages(data.messages?.length ? data.messages : [defaultAssistantMessage]);
    } catch (conversationError) {
      setError(conversationError instanceof Error ? conversationError.message : "Failed to load conversation.");
    }
  }

  function handleNewChat() {
    activeRequestRef.current?.abort();
    setConversationId(null);
    setMessages([defaultAssistantMessage]);
    setSummary(null);
    setError(null);
    setPendingMessageId(null);
  }

  function handleStopStreaming() {
    if (!activeRequestRef.current || !pendingMessageId) {
      return;
    }

    activeRequestRef.current.abort();
    setMessages((prev) =>
      prev.map((message) =>
        message.id === pendingMessageId
          ? {
              ...message,
              pending: false,
              failed: true,
              retryText: message.retryText,
              content: message.content.trim().length > 0 ? message.content : "Response stopped."
            }
          : message
      )
    );
    setPendingMessageId(null);
  }

  function conversationTitle(conversation: Conversation, index: number) {
    const trimmed = conversation.title.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return `Conversation ${conversations.length - index}`;
  }

  async function handleRenameConversation(conversation: Conversation, index: number) {
    const nextTitle = window.prompt("Rename conversation", conversationTitle(conversation, index));

    if (!nextTitle || nextTitle.trim().length === 0) {
      return;
    }

    try {
      const response = await fetch("/api/coach/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, title: nextTitle.trim() })
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not rename conversation.");
      }

      await loadConversations();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename conversation.");
    }
  }

  async function handleDeleteConversation(conversationIdToDelete: string) {
    const confirmed = window.confirm("Delete this conversation? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/coach/chat?conversationId=${conversationIdToDelete}`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete conversation.");
      }

      if (conversationIdToDelete === conversationId) {
        handleNewChat();
      }

      await loadConversations();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete conversation.");
    }
  }

  async function streamAssistantReply(trimmed: string) {
    setError(null);
    setIsLoading(true);
    const userMessageId = createMessageId();
    const assistantMessageId = createMessageId();
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setPendingMessageId(assistantMessageId);
    setMessages((prev) => [...prev, { id: userMessageId, role: "user", content: trimmed }, { id: assistantMessageId, role: "assistant", content: "", pending: true, retryText: trimmed }]);

    try {
      const response = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({ error: "Could not get a coaching response." }))) as { error?: string };
        throw new Error(data.error ?? "Could not get a coaching response.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const updateAssistant = (delta: string) => {
        setMessages((prev) => {
          return prev.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: `${message.content}${delta}`, pending: true, failed: false }
              : message
          );
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const eventLine = frame.split("\n").find((line) => line.startsWith("event:"));
          const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
          if (!eventLine || !dataLine) {
            continue;
          }

          const eventName = eventLine.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;

          if (eventName === "message_start" && typeof data.conversationId === "string") {
            setConversationId(data.conversationId);
            continue;
          }

          if (eventName === "message_delta" && typeof data.chunk === "string") {
            updateAssistant(data.chunk);
            continue;
          }

          if (eventName === "error") {
            throw new Error(typeof data.error === "string" ? data.error : "Could not get a coaching response.");
          }

          if (eventName === "message_complete") {
            const completion = data as unknown as StreamCompletePayload;
            if (completion.conversationId) {
              setConversationId(completion.conversationId);
            }
            if (completion.structured) {
              setSummary(null);
              setMessages((prev) => {
                return prev.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: completion.structured.answer ?? message.content,
                        pending: false,
                        failed: false
                      }
                    : message
                );
              });
            }
          }
        }
      }

      await loadConversations();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Something went wrong.";
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === assistantMessageId
            ? {
                ...entry,
                pending: false,
                failed: true,
                retryText: trimmed,
                content: entry.content.trim().length > 0 ? entry.content : `Could not get a coaching response. ${message}`
              }
            : entry
        )
      );
    } finally {
      setPendingMessageId(null);
      activeRequestRef.current = null;
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = input.trim();

    if (trimmed.length < 3 || isLoading) {
      return;
    }

    setInput("");
    await streamAssistantReply(trimmed);
  }

  function handleRetry(message: Message) {
    const retryText = message.retryText?.trim();
    if (!retryText || isLoading) {
      return;
    }

    void streamAssistantReply(retryText);
  }

  return (
    <div className="space-y-5">
      {showBriefingPanel ? (
        <section className="surface p-5">
          <div className="border-b border-[hsl(var(--border))] pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[hsl(var(--ai-accent-core))]">Coach briefing</p>
            <h2 className="mt-2 text-2xl font-semibold text-primary">{topInsight.headline}</h2>
            <p className="mt-1.5 max-w-3xl text-sm text-muted">{condensedRationale}</p>
          </div>
          <div className="mt-3 grid gap-3.5 lg:grid-cols-[1.25fr_0.75fr]">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">What to do next</p>
              <ul className="mt-1.5 space-y-1">
                {nextActions.slice(0, 2).map((action) => (
                  <li key={action} className="text-sm text-[hsl(var(--text-secondary))]">• {action}</li>
                ))}
              </ul>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Link
                  href={topInsight.primaryAction.href}
                  className={topInsight.primaryAction.label === "Ask why" ? "btn-secondary" : "btn-primary"}
                >
                  {topInsight.primaryAction.label}
                </Link>
                <a
                  href={topInsight.secondaryAction.href}
                  className="inline-flex items-center rounded-full border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-[hsl(var(--text-secondary))] transition hover:border-[hsl(var(--ai-accent-core)/0.3)] hover:text-primary"
                >
                  {topInsight.secondaryAction.label}
                </a>
              </div>
              <p className="mt-2 text-xs text-tertiary">{scoreTrendSummary}</p>
              <p className="mt-2 text-[11px] text-tertiary">
                {briefingContext.uploadedSessionCount} uploaded · {briefingContext.linkedSessionCount} linked · {briefingContext.reviewedSessionCount} reviewed
                {briefingContext.pendingReviewCount > 0 ? ` · ${briefingContext.pendingReviewCount} pending review` : ""}
              </p>
            </div>
            <div id="sessions-needing-attention" className="rounded-xl bg-[hsl(var(--surface-subtle))] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Sessions needing attention</p>
                <span className="text-xs text-tertiary">{flaggedSessions.length}</span>
              </div>
              {flaggedSessions.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted">{emptyAttentionText}</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {flaggedSessions.slice(0, 2).map((session) => (
                    <li key={session.id} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/sessions/${session.id}`} className="truncate text-[hsl(var(--text-secondary))] underline-offset-2 hover:text-primary hover:underline">
                          {session.sessionName}
                        </Link>
                        <span className={`signal-chip ${statusChip(session.status).className}`}>{statusChip(session.status).label}</span>
                      </div>
                      {session.executionScoreBand ? (
                        <div className="mt-1">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${executionScoreBandTone(session.executionScoreBand)}`}>
                            {scoreHeadline(session)}
                          </span>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {latestScoredSession ? (
                <p className="mt-1.5 text-xs text-tertiary">
                  Latest reviewed session:{" "}
                  <Link href={`/sessions/${latestScoredSession.id}`} className="underline-offset-2 hover:text-primary hover:underline">
                    {latestScoredSession.sessionName}
                  </Link>
                  {" · "}
                  {scoreHeadline(latestScoredSession)}
                </p>
              ) : null}
              {matchedSessions.length > 0 ? <p className="mt-1.5 text-xs text-tertiary">{matchedSessions.length} sessions on target.</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      <section id="coaching-chat" className="surface overflow-hidden">
        <div className="grid h-[68vh] min-h-[560px] max-h-[780px] lg:grid-cols-[248px_1fr]">
          <aside className="flex min-h-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-2.5">
            <button type="button" onClick={handleNewChat} className="rounded-md border border-[rgba(190,255,0,0.35)] bg-transparent px-3 py-1.5 text-sm text-[var(--color-accent)]">
              New conversation
            </button>
            <div className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {(() => {
                const groups = groupConversations(conversations);
                const allIndex = conversations.slice();

                function renderConversation(conversation: Conversation) {
                  const isActive = conversation.id === conversationId;
                  const idx = allIndex.indexOf(conversation);
                  return (
                    <div key={conversation.id} className={`rounded-md border px-2 py-1.5 ${isActive ? "border-transparent bg-[rgba(255,255,255,0.06)]" : "border-transparent hover:border-[hsl(var(--border))]"}`}>
                      <div className="flex items-start justify-between gap-1">
                        <button type="button" onClick={() => void handleConversationClick(conversation.id)} className="min-w-0 flex-1 text-left leading-tight">
                          <p className={`truncate pr-1 text-[13px] font-medium ${isActive ? "text-primary" : "text-[rgba(255,255,255,0.55)]"}`}>
                            {conversationTitle(conversation, idx)}
                          </p>
                          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.25)]">{formatRecencyLabel(conversation.updated_at)}</p>
                        </button>
                        <details className="relative">
                          <summary className="cursor-pointer list-none px-1 text-sm text-tertiary hover:text-primary">⋯</summary>
                          <div className="absolute right-0 z-10 mt-1 w-28 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-1 text-xs shadow-md">
                            <button type="button" onClick={() => void handleRenameConversation(conversation, idx)} className="block w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--surface-2))]">Rename</button>
                            <button type="button" onClick={() => void handleDeleteConversation(conversation.id)} className="block w-full rounded px-2 py-1 text-left text-rose-300 hover:bg-[hsl(var(--surface-2))]">Delete</button>
                          </div>
                        </details>
                      </div>
                    </div>
                  );
                }

                return (
                  <>
                    {groups.thisWeek.length > 0 ? (
                      <div>
                        <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.28)]">This week</p>
                        <div className="space-y-1">{groups.thisWeek.slice(0, 5).map(renderConversation)}</div>
                      </div>
                    ) : null}
                    {groups.lastWeek.length > 0 ? (
                      <div>
                        <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.28)]">Last week</p>
                        <div className="space-y-1">{groups.lastWeek.slice(0, 3).map(renderConversation)}</div>
                      </div>
                    ) : null}
                    {groups.older.length > 0 ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowOlderConversations((prev) => !prev)}
                          className="mb-1 flex w-full items-center justify-between px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.28)] hover:text-[rgba(255,255,255,0.45)]"
                        >
                          <span>Older</span>
                          <span className="rounded-full border border-[rgba(255,255,255,0.12)] px-1.5 py-0.5 text-[9px]">{groups.older.length}</span>
                        </button>
                        {showOlderConversations ? (
                          <div className="space-y-1">{groups.older.map(renderConversation)}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col">
            <div className="border-b border-[hsl(var(--border))] bg-gradient-to-r from-[hsl(var(--surface-1))] to-[hsl(var(--surface-2))] px-3.5 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="label">Active conversation</p>
                  <h3 className="mt-0.5 text-base font-semibold">{activeConversation ? activeConversation.title || "Untitled conversation" : "New conversation"}</h3>
                  <p className="mt-0.5 text-sm text-muted">{dataRecency}</p>
                </div>
              </div>
            </div>
            <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3.5 py-2">
              <p className="text-xs text-[hsl(var(--text-secondary))]">
                {sessionDiagnoses.length > 0
                  ? `${sessionDiagnoses.length} reviewed this week${flaggedSessions.length > 0 ? ` · ${flaggedSessions.length} needing attention` : ""}. Focus: ${nextActions[0] ?? "Stabilise execution quality."}`
                  : briefingContext.pendingReviewCount > 0
                    ? `${briefingContext.pendingReviewCount} linked session${briefingContext.pendingReviewCount > 1 ? "s" : ""} waiting for review. Use chat for missed-workout decisions, week adjustments, or upload interpretation in the meantime.`
                    : "Reviews are still building. Use chat for missed-workout decisions, week adjustments, or upload interpretation in the meantime."}
              </p>
            </div>

            <div
              ref={messagesViewportRef}
              onScroll={(event) => {
                const el = event.currentTarget;
                const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
                shouldAutoScrollRef.current = distanceToBottom < 40;
              }}
              className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3"
            >
              {messages.map((message, index) => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                      message.role === "user"
                        ? "bg-[hsl(var(--ai-accent-core))] text-[#0A0A0B]"
                        : message.failed
                          ? "border border-[hsl(var(--danger)/0.4)] bg-[hsl(var(--danger)/0.08)] text-[hsl(var(--text-secondary))]"
                          : "border border-[rgba(255,255,255,0.06)] bg-[#1F1F25] px-4 py-3.5 text-[rgba(255,255,255,0.8)]"
                    }`}
                  >
                    {message.pending && message.content.trim().length === 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-tertiary">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--text-secondary)/0.55)]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--text-secondary)/0.55)] [animation-delay:120ms]" />
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--text-secondary)/0.55)] [animation-delay:240ms]" />
                        <span className="ml-1">Coach is thinking</span>
                      </span>
                    ) : (
                      <>
                        {message.content}
                        {message.pending ? <span className="ml-1 animate-pulse text-tertiary">▍</span> : null}
                      </>
                    )}
                    {message.failed && message.role === "assistant" && message.retryText ? (
                      <div className="mt-2">
                        <button type="button" onClick={() => handleRetry(message)} className="text-xs font-medium text-[hsl(var(--ai-accent-core))] hover:underline">
                          Retry
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-2.5 py-2.5">
              <label htmlFor="coach-input" className="sr-only">
                Ask your triathlon coach
              </label>
              <div className="mb-1.5 flex flex-wrap gap-1">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setInput(prompt)}
                    className="rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.06)] px-3 py-1 text-[12px] font-medium text-[rgba(255,255,255,0.55)] transition hover:border-[rgba(255,255,255,0.16)] hover:text-[rgba(255,255,255,0.75)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  id="coach-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask how to execute better and what to adjust next..."
                  className="w-full rounded-md border border-[rgba(255,255,255,0.08)] bg-[#18181C] px-3 py-2 text-[rgba(255,255,255,0.8)] placeholder:text-[rgba(255,255,255,0.25)] focus:border-[rgba(190,255,0,0.30)]"
                  disabled={isLoading}
                />
                <button type="submit" disabled={isLoading} className="btn-primary disabled:opacity-70">
                  Send
                </button>
                {isLoading ? (
                  <button type="button" onClick={handleStopStreaming} className="inline-flex items-center rounded-full border border-[hsl(var(--border))] px-3 text-sm text-[hsl(var(--text-secondary))] hover:text-primary">
                    Stop
                  </button>
                ) : null}
              </div>
              {error ? <p className="mt-2 text-sm text-rose-400">{error}</p> : null}
            </form>
          </div>
        </div>
      </section>
    </div>
  );
}
