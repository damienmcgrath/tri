"use client";

import { useState } from "react";
import Link from "next/link";

type Props = {
  sessionId: string;
  sessionName: string;
  sport: string;
  durationMinutes: number;
};

export function RecentUploadCard({ sessionId, sessionName, sport, durationMinutes }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const durationLabel = durationMinutes >= 60
    ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
    : `${durationMinutes}m`;

  return (
    <article className="rounded-xl border border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent)/0.06)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-kicker text-[hsl(var(--accent))]">New activity</p>
          <p className="mt-1 text-body text-white">
            You completed <span className="font-medium">{sessionName}</span> ({durationLabel}) — how did it feel?
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 text-tertiary hover:text-white"
          aria-label="Dismiss"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div className="mt-3">
        <Link
          href={`/sessions/${sessionId}?postUpload=true`}
          className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-body"
        >
          Review session
        </Link>
      </div>
    </article>
  );
}
