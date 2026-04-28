"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RegenerateRaceReviewButton({ bundleId, label }: { bundleId: string; label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleRegenerate() {
    startTransition(async () => {
      setMessage(null);

      try {
        const response = await fetch(`/api/race-reviews/${bundleId}/regenerate`, {
          method: "POST",
          headers: { "content-type": "application/json" }
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string; source?: "ai" | "fallback" };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not regenerate race review.");
        }

        setMessage(
          payload.source === "ai"
            ? "Race review regenerated with AI."
            : "Race review regenerated with deterministic fallback."
        );
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not regenerate race review.");
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
        {isPending ? "Regenerating..." : label ?? "Regenerate review"}
      </button>
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  );
}
