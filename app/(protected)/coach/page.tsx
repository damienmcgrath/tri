import { CoachChat } from "./coach-chat";
import { createClient } from "@/lib/supabase/server";
import type { CoachDiagnosisSession } from "./types";

type SessionRow = {
  id: string;
  date: string;
  sport: string;
  type: string;
  session_name?: string | null;
  intent_category?: string | null;
  status?: "planned" | "completed" | "skipped" | null;
  execution_result?: Record<string, unknown> | null;
};

function toMatchStatus(value: unknown): CoachDiagnosisSession["status"] {
  if (value === "matched_intent" || value === "matched") return "matched";
  if (value === "missed_intent" || value === "missed") return "missed";
  return "partial";
}

function mapDiagnosedSession(row: SessionRow): CoachDiagnosisSession | null {
  if (!row.execution_result || typeof row.execution_result !== "object") {
    return null;
  }

  const result = row.execution_result;
  const status = toMatchStatus(result.status);
  const sessionName = (row.session_name ?? row.type ?? `${row.sport} session`).trim();
  const plannedIntent = (row.intent_category ?? row.type ?? `${row.sport} training`).trim();
  const executionSummary =
    (typeof result.executionScoreSummary === "string" && result.executionScoreSummary) ||
    (typeof result.executionSummary === "string" && result.executionSummary) ||
    (typeof result.summary === "string" && result.summary) ||
    "Execution details will sharpen with additional completed sessions.";
  const whyItMatters =
    (typeof result.whyItMatters === "string" && result.whyItMatters) ||
    (typeof result.why_it_matters === "string" && result.why_it_matters) ||
    (status === "missed"
      ? "Missing session intent repeatedly can reduce adaptation quality and increase fatigue carryover."
      : "Small execution drift can compound across the week if left uncorrected.");
  const nextAction =
    (typeof result.recommendedNextAction === "string" && result.recommendedNextAction) ||
    (typeof result.recommended_next_action === "string" && result.recommended_next_action) ||
    (status === "missed"
      ? "Repeat the session with a tighter cap on early intensity and preserve form first."
      : "Apply one execution correction on the next similar workout before progressing load.");

  const evidence = Array.isArray(result.evidence)
    ? result.evidence.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 3)
    : [];

  const executionScoreRaw = typeof result.executionScore === "number" ? result.executionScore : result.execution_score;
  const executionScore = typeof executionScoreRaw === "number" ? Math.max(0, Math.min(100, Math.round(executionScoreRaw))) : null;
  const executionScoreBandRaw = typeof result.executionScoreBand === "string" ? result.executionScoreBand : result.execution_score_band;
  const executionScoreBand =
    executionScoreBandRaw === "On target" || executionScoreBandRaw === "Partial match" || executionScoreBandRaw === "Missed intent"
      ? executionScoreBandRaw
      : executionScore === null
        ? null
        : executionScore >= 85
          ? "On target"
          : executionScore >= 65
            ? "Partial match"
            : "Missed intent";
  const executionScoreProvisionalRaw =
    typeof result.executionScoreProvisional === "boolean" ? result.executionScoreProvisional : result.execution_score_provisional;
  const executionScoreProvisional = typeof executionScoreProvisionalRaw === "boolean" ? executionScoreProvisionalRaw : false;

  const confidenceRaw = typeof result.diagnosisConfidence === "string" ? result.diagnosisConfidence : result.diagnosis_confidence;
  const confidenceNote = typeof confidenceRaw === "string" ? `Diagnosis confidence: ${confidenceRaw}` : undefined;

  const importance = status === "missed" ? 3 : status === "partial" ? 2 : 1;

  return {
    id: row.id,
    sessionName,
    plannedIntent,
    executionSummary,
    status,
    executionScore,
    executionScoreBand,
    executionScoreProvisional,
    whyItMatters,
    nextAction,
    confidenceNote,
    evidence,
    importance
  };
}

async function getDiagnosisSessions() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return [] as CoachDiagnosisSession[];
  }

  const { data, error } = await supabase
    .from("sessions")
    .select("id,date,sport,type,session_name,intent_category,status,execution_result")
    .eq("status", "completed")
    .not("execution_result", "is", null)
    .order("date", { ascending: false })
    .limit(12);

  if (error) {
    return [] as CoachDiagnosisSession[];
  }

  return ((data ?? []) as SessionRow[])
    .map(mapDiagnosedSession)
    .filter((item): item is CoachDiagnosisSession => Boolean(item))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 6);
}

export default async function CoachPage() {
  const diagnosisSessions = await getDiagnosisSessions();

  return (
    <section className="space-y-4">
      <article className="surface p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Coach</p>
        <h1 className="mt-1 text-lg font-semibold">Session execution coaching</h1>
        <p className="mt-1 text-sm text-muted">See which completed sessions matched intent, what missed, and what to change next.</p>
      </article>
      <CoachChat diagnosisSessions={diagnosisSessions} />
    </section>
  );
}
