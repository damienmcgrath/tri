// Re-export public API — consumers import from "@/lib/weekly-debrief" unchanged.

export {
  WEEKLY_DEBRIEF_GENERATION_VERSION,
  weeklyDebriefFeedbackInputSchema
} from "./types";

export type {
  WeeklyDebriefEvidenceItem,
  WeeklyDebriefEvidenceGroup,
  WeeklyDebriefFacts,
  WeeklyDebriefNarrative,
  WeeklyDebriefCoachShare,
  WeeklyDebriefArtifact,
  WeeklyDebriefReadiness,
  WeeklyDebriefSnapshot,
  WeeklyDebriefFeedbackInput
} from "./types";

export {
  computeWeeklyDebriefReadiness,
  classifyWeeklyDebriefWeekShape
} from "./deterministic";

export { buildWeeklyDebriefFacts } from "./facts";

export {
  computeWeeklyDebrief,
  persistWeeklyDebrief,
  getPersistedWeeklyDebrief,
  isWeeklyDebriefStale,
  getWeeklyDebriefSnapshot,
  refreshWeeklyDebrief,
  saveWeeklyDebriefFeedback,
  getAdjacentWeeklyDebriefs
} from "./persistence";
