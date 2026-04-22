"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RegenerateReviewButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleRegenerate() {
    startTransition(async () => {
      setMessage(null);

      try {
        const response = await fetch(`/api/sessions/${sessionId}/review/regenerate`, {
          method: "POST",
          headers: { "content-type": "application/json" }
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string; narrativeSource?: "ai" | "fallback" | "legacy_unknown" };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not regenerate session review.");
        }

        setMessage(
          payload.narrativeSource === "ai"
            ? "Session review regenerated with AI."
            : payload.narrativeSource === "fallback"
              ? "Session review regenerated, but it still used fallback."
              : "Session review regenerated."
        );
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not regenerate session review.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleRegenerate}
        disabled={isPending}
        className="text-xs text-tertiary underline-offset-2 transition-ui hover:text-white hover:underline disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Regenerating..." : "Regenerate review"}
      </button>
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  );
}
