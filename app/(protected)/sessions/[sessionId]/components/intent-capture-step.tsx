"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { IntentCaptureForm } from "@/components/session/IntentCaptureForm";

interface IntentCaptureStepProps {
  sessionId: string;
}

export function IntentCaptureStep({ sessionId }: IntentCaptureStepProps) {
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (hidden) return null;

  async function handleSubmit(text: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Could not save intent.");
      }
      setHidden(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save intent.");
      setLoading(false);
    }
  }

  function handleSkip() {
    setHidden(true);
  }

  return (
    <div className="flex flex-col gap-2">
      <IntentCaptureForm onSubmit={handleSubmit} onSkip={handleSkip} loading={loading} />
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-[hsl(var(--danger)/0.3)] bg-[hsl(var(--danger)/0.08)] px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
