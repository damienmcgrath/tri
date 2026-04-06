"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type CoachPanelState = {
  isOpen: boolean;
  initialPrompt: string | null;
  open: (prompt?: string) => void;
  close: () => void;
};

const CoachPanelContext = createContext<CoachPanelState>({
  isOpen: false,
  initialPrompt: null,
  open: () => {},
  close: () => {},
});

export function useCoachPanel() {
  return useContext(CoachPanelContext);
}

export function CoachPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);

  const open = useCallback((prompt?: string) => {
    setInitialPrompt(prompt ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setInitialPrompt(null);
  }, []);

  return (
    <CoachPanelContext.Provider value={{ isOpen, initialPrompt, open, close }}>
      {children}
    </CoachPanelContext.Provider>
  );
}
