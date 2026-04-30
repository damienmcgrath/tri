"use client";

import { useMemo, useState } from "react";
import { CoachChat } from "@/app/(protected)/coach/coach-chat";
import type { CoachBriefingContext } from "@/app/(protected)/coach/types";
import type { CoachCitation } from "@/lib/coach/types";
import type { RaceBundleSummary } from "@/lib/race/bundle-helpers";
import { SegmentDiagnosticPanel } from "../components/segment-diagnostic-panel";

type Props = {
  bundleId: string;
  summary: RaceBundleSummary;
  seededPrompts: string[];
  initialPrompt?: string;
  openingMessage: string;
};

const EMPTY_BRIEFING: CoachBriefingContext = {
  uploadedSessionCount: 0,
  linkedSessionCount: 0,
  reviewedSessionCount: 0,
  pendingReviewCount: 0,
  extraActivityCount: 0
};

const PANEL_TYPES: ReadonlySet<CoachCitation["type"]> = new Set([
  "segment",
  "reference_frame",
  "pre_race",
  "subjective",
  "lesson"
]);

export function RaceCoachChat({ bundleId, summary, seededPrompts, initialPrompt, openingMessage }: Props) {
  const [activeCitation, setActiveCitation] = useState<CoachCitation | null>(null);
  const memoSummary = useMemo(() => summary, [summary]);

  return (
    <>
      <CoachChat
        diagnosisSessions={[]}
        briefingContext={EMPTY_BRIEFING}
        initialPrompt={initialPrompt}
        showBriefingPanel={false}
        raceBundleId={bundleId}
        seededPrompts={seededPrompts}
        openingOverride={openingMessage}
        onCitationClick={(c) => {
          if (PANEL_TYPES.has(c.type)) {
            setActiveCitation(c);
            return true; // claim the click; chip will preventDefault
          }
          // prior_race / best_comparable_training → let the Link navigate.
        }}
      />
      <SegmentDiagnosticPanel
        citation={activeCitation}
        summary={memoSummary}
        onClose={() => setActiveCitation(null)}
      />
    </>
  );
}
