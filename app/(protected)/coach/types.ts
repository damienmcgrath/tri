export type CoachDiagnosisSession = {
  id: string;
  sessionName: string;
  plannedIntent: string;
  executionSummary: string;
  status: "matched" | "partial" | "missed";
  executionScore: number | null;
  executionScoreBand: "On target" | "Solid" | "Partial match" | "Missed intent" | null;
  executionScoreProvisional: boolean;
  whyItMatters: string;
  nextAction: string;
  confidenceNote?: string;
  evidence: string[];
  importance: number;
};

export type CoachBriefingContext = {
  uploadedSessionCount: number;
  linkedSessionCount: number;
  reviewedSessionCount: number;
  pendingReviewCount: number;
  extraActivityCount: number;
  upcomingKeySessionNames?: string[];
};
