"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Outcome =
  | { kind: "idle" }
  | { kind: "info"; text: string }
  | { kind: "needs_subjective" }
  | { kind: "error"; text: string };

export function RegenerateRaceReviewButton({ bundleId, label }: { bundleId: string; label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  function handleRegenerate() {
    startTransition(async () => {
      setOutcome({ kind: "idle" });

      try {
        const response = await fetch(`/api/race-reviews/${bundleId}/regenerate`, {
          method: "POST",
          headers: { "content-type": "application/json" }
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string; source?: "ai" | "fallback" };

        // Phase 1B gate: AI generation requires subjective inputs. Surface a
        // friendly CTA to the notes page instead of the raw skip reason.
        if (response.status === 409 && payload.error?.includes("subjective_required")) {
          setOutcome({ kind: "needs_subjective" });
          return;
        }

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not regenerate race review.");
        }

        setOutcome({
          kind: "info",
          text:
            payload.source === "ai"
              ? "Race review regenerated with AI."
              : "Race review regenerated with deterministic fallback."
        });
        router.refresh();
      } catch (error) {
        setOutcome({ kind: "error", text: error instanceof Error ? error.message : "Could not regenerate race review." });
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
      {outcome.kind === "needs_subjective" ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          Add your race notes first.
          <Link
            href={`/races/${bundleId}/notes`}
            className="text-tertiary underline-offset-2 hover:text-white hover:underline"
          >
            Add notes →
          </Link>
        </span>
      ) : outcome.kind === "info" ? (
        <p className="text-xs text-muted">{outcome.text}</p>
      ) : outcome.kind === "error" ? (
        <p className="text-xs text-muted">{outcome.text}</p>
      ) : null}
    </div>
  );
}
