"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markActivityExtraAction } from "@/app/(protected)/calendar/actions";

export function MarkAsExtraButton({ activityId }: { activityId: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(52,211,153,0.25)] bg-[rgba(52,211,153,0.12)] px-3 py-1.5 text-xs font-medium text-success">
        <span aria-hidden="true">✓</span> Marked as extra
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={async () => {
        setIsPending(true);
        try {
          await markActivityExtraAction({ activityId });
          setDone(true);
          router.refresh();
        } catch {
          setIsPending(false);
        }
      }}
      className="rounded-full border border-[rgba(255,255,255,0.16)] bg-transparent px-3 py-1.5 text-xs text-muted transition hover:border-[rgba(255,255,255,0.3)] hover:text-foreground disabled:opacity-50"
    >
      {isPending ? "Marking…" : "Mark as extra"}
    </button>
  );
}
