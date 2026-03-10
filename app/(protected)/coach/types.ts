export type CoachDiagnosisSession = {
  id: string;
  sessionName: string;
  plannedIntent: string;
  executionSummary: string;
  status: "matched" | "partial" | "missed";
  whyItMatters: string;
  nextAction: string;
  confidenceNote?: string;
  evidence: string[];
  importance: number;
};
