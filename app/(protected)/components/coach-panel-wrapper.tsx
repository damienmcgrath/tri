"use client";

import { lazy, Suspense } from "react";
import { CoachFAB } from "./coach-fab";
import { CoachPanelProvider } from "./coach-panel-context";

const CoachPanel = lazy(() => import("./coach-panel").then((m) => ({ default: m.CoachPanel })));

export function CoachPanelWrapper({ children }: { children: React.ReactNode }) {
  return (
    <CoachPanelProvider>
      {children}
      <CoachFAB />
      <Suspense fallback={null}>
        <CoachPanel />
      </Suspense>
    </CoachPanelProvider>
  );
}
