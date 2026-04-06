"use client";

import { lazy, Suspense } from "react";
import { CoachPanelProvider } from "./coach-panel-context";

const CoachPanel = lazy(() => import("./coach-panel").then((m) => ({ default: m.CoachPanel })));
const CoachFAB = lazy(() => import("./coach-panel").then((m) => ({ default: m.CoachFAB })));

export function CoachPanelWrapper({ children }: { children: React.ReactNode }) {
  return (
    <CoachPanelProvider>
      {children}
      <Suspense fallback={null}>
        <CoachFAB />
        <CoachPanel />
      </Suspense>
    </CoachPanelProvider>
  );
}
