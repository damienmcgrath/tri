"use client";

import Link from "next/link";

type Citation = {
  type: "session" | "activity" | "debrief" | "verdict";
  id: string;
  label: string;
};

type Props = {
  citation: Citation;
};

const TYPE_ROUTES: Record<string, string> = {
  session: "/sessions",
  activity: "/activities",
  debrief: "/debrief",
  verdict: "/sessions",
};

export function CitationChip({ citation }: Props) {
  const baseRoute = TYPE_ROUTES[citation.type] ?? "/sessions";
  const href = `${baseRoute}/${citation.id}`;

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-400 transition hover:bg-cyan-500/20"
    >
      <span className="opacity-60">{citation.type === "session" ? "S" : citation.type === "activity" ? "A" : "D"}</span>
      <span className="max-w-[120px] truncate">{citation.label}</span>
    </Link>
  );
}

/**
 * Render multiple citations inline within a message.
 */
export function CitationChips({ citations }: { citations: Citation[] }) {
  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {citations.map((c, i) => (
        <CitationChip key={`${c.type}-${c.id}-${i}`} citation={c} />
      ))}
    </div>
  );
}
