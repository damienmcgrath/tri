"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EXTRA_INTENT_OPTIONS } from "@/lib/workouts/infer-extra-intent";

type Props = {
  sessionId: string;
  currentIntent: string | null;
  sport: string;
};

export function ReclassifyIntentSelector({ sessionId, currentIntent, sport }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sportLower = sport.toLowerCase();
  const options = EXTRA_INTENT_OPTIONS.filter(
    (opt) => opt.sports === null || opt.sports.includes(sportLower)
  );

  function handleSelect(intentValue: string) {
    setIsOpen(false);
    setMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/review/regenerate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ intentOverride: intentValue }),
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string; narrativeSource?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not reclassify session.");
        }

        setMessage("Reclassified — verdict updated.");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not reclassify session.");
      }
    });
  }

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-[11px] text-tertiary hover:border-[rgba(255,255,255,0.25)] hover:text-white disabled:opacity-40"
      >
        {isPending ? (
          <>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-[rgba(255,255,255,0.2)] border-t-white" />
            Reclassifying...
          </>
        ) : (
          <>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 4H4V11" /><path d="M4 4L14 14" />
            </svg>
            Reclassify
          </>
        )}
      </button>

      {isOpen && !isPending ? (
        <>
          {/* Backdrop to close on outside click */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] py-1 shadow-lg">
            {options.map((opt) => {
              const isCurrent = opt.value === currentIntent;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  disabled={isCurrent}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                    isCurrent
                      ? "text-tertiary opacity-50"
                      : "text-muted hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                  }`}
                >
                  {opt.label}
                  {isCurrent ? (
                    <span className="ml-auto text-[10px] text-tertiary">(current)</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {message ? <span className="text-[11px] text-muted">{message}</span> : null}
    </div>
  );
}
