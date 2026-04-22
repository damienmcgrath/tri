import { render, screen } from "@testing-library/react";
import { WeeklyDebriefCard } from "./weekly-debrief-card";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() })
}));

describe("WeeklyDebriefCard", () => {
  test("renders a not-enough-signal state", () => {
    render(
      <WeeklyDebriefCard
        snapshot={{
          readiness: {
            isReady: false,
            reason: "Not enough signal yet.",
            unlockedBy: "insufficient_signal",
            resolvedKeySessions: 1,
            totalKeySessions: 2,
            resolvedMinutes: 180,
            plannedMinutes: 360
          },
          artifact: null,
          stale: false,
          sourceUpdatedAt: "2026-03-13T09:00:00.000Z",
          weekStart: "2026-03-09",
          weekEnd: "2026-03-15"
        }}
      />
    );

    expect(screen.getByLabelText("Weekly debrief status")).toBeInTheDocument();
    expect(
      screen.getByText(/unlocks after 1 more key session · 3hr of 6hr/)
    ).toBeInTheDocument();
  });

  test("renders saved stale debrief state with refresh affordance", () => {
    render(
      <WeeklyDebriefCard
        snapshot={{
          readiness: {
            isReady: true,
            reason: "Ready",
            unlockedBy: "effective_completion",
            resolvedKeySessions: 2,
            totalKeySessions: 2,
            resolvedMinutes: 340,
            plannedMinutes: 400
          },
          artifact: {
            weekStart: "2026-03-09",
            weekEnd: "2026-03-15",
            status: "stale",
            sourceUpdatedAt: "2026-03-15T10:00:00.000Z",
            generatedAt: "2026-03-15T09:00:00.000Z",
            generationVersion: 1,
            facts: {
              weekLabel: "Week of 2026-03-09",
              weekRange: "Mar 9 – Mar 15",
              title: "Solid execution with one late-week miss",
              statusLine: "All key sessions landed with one skip elsewhere",
              primaryTakeawayTitle: "The main work held",
              primaryTakeawayDetail: "The priority sessions landed, and most of the disruption stayed outside the work the week depended on.",
              plannedSessions: 7,
              completedPlannedSessions: 5,
              completedSessions: 6,
              addedSessions: 1,
              skippedSessions: 1,
              remainingSessions: 0,
              keySessionsCompleted: 2,
              keySessionsMissed: 0,
              keySessionsTotal: 2,
              plannedMinutes: 400,
              completedPlannedMinutes: 290,
              completedMinutes: 320,
              skippedMinutes: 20,
              extraMinutes: 0,
              completionPct: 85,
              dominantSport: "Run",
              keySessionStatus: "The priority sessions of the week were completed.",
              metrics: [],
              factualBullets: ["6 of 7 sessions were completed.", "All key sessions landed.", "Run carried the most work."],
              confidenceNote: null,
              narrativeSource: "ai",
              artifactStateLabel: "final",
              artifactStateNote: null,
              provisionalReviewCount: 0,
              weekShape: "normal",
              reflectionsSparse: false,
              feelsSnapshot: null
            },
            narrative: {
              executiveSummary: "Strong week.",
              highlights: ["one", "two", "three"],
              observations: ["one"],
              carryForward: ["one", "two"],
              nonObviousInsight: "No cross-session pattern surfaced this week.",
              teach: null
            },
            coachShare: {
              headline: "Solid execution with one late-week miss",
              summary: "Strong week.",
              wins: ["one"],
              concerns: ["one"],
              carryForward: ["one", "two"]
            },
            evidence: [],
            evidenceGroups: [],
            feedback: {
              helpful: null,
              accurate: null,
              note: null,
              updatedAt: null
            }
          },
          stale: true,
          sourceUpdatedAt: "2026-03-15T10:00:00.000Z",
          weekStart: "2026-03-09",
          weekEnd: "2026-03-15"
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Solid execution with one late-week miss" })).toBeInTheDocument();
    expect(screen.getByText("Needs refresh")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});
