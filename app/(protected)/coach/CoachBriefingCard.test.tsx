import { render, screen } from "@testing-library/react";
import { CoachBriefingCard } from "./CoachBriefingCard";

describe("CoachBriefingCard", () => {
  test("keeps the reviewed-week summary visible so extra sessions and context cues are not lost", () => {
    render(
      <CoachBriefingCard
        brief={{
          weekHeadline: "Execution is on track overall, with a few sessions needing attention",
          weekSummary: "2 extra sessions also logged this week. Travel window noted.",
          keyPositive: null,
          keyRisk: "A late fade in the long run is the main risk signal right now.",
          nextWeekDecision: "Progress only if the next key session lands cleanly.",
          trend: {
            reviewedCount: 3,
            onTargetCount: 1,
            partialCount: 1,
            missedCount: 1,
            provisionalCount: 0
          },
          sessionsNeedingAttention: [],
          confidenceNote: null
        }}
        athleteContext={null}
        briefingContext={{
          uploadedSessionCount: 5,
          linkedSessionCount: 3,
          reviewedSessionCount: 3,
          pendingReviewCount: 0,
          extraActivityCount: 2
        }}
      />
    );

    expect(screen.getByText("2 extra sessions also logged this week. Travel window noted.")).toBeInTheDocument();
  });
});
