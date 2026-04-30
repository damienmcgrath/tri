"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import type { CoachCitation } from "@/lib/coach/types";

/**
 * Legacy citation shape used by some existing call sites. Kept for
 * back-compat alongside the Phase 2 race-coach citations.
 */
type LegacyCitation = {
  type: "session" | "activity" | "debrief" | "verdict";
  id: string;
  label: string;
};

const LEGACY_TYPE_ROUTES: Record<string, string> = {
  session: "/sessions",
  activity: "/activities",
  debrief: "/debrief",
  verdict: "/sessions"
};

const TYPE_BADGE: Record<CoachCitation["type"] | LegacyCitation["type"], string> = {
  session: "S",
  activity: "A",
  debrief: "D",
  verdict: "V",
  segment: "Sg",
  reference_frame: "R",
  lesson: "L",
  pre_race: "Pr",
  subjective: "Sj",
  prior_race: "Pr",
  best_comparable_training: "Bt"
};

type Props =
  | { citation: LegacyCitation; onCitationClick?: undefined; raceBundleId?: undefined }
  | {
      citation: CoachCitation;
      /**
       * When provided, chip calls this on click. Return true if you handled
       * the click (chip will preventDefault); return false / void to let
       * the Link navigate normally. Modifier-clicks always navigate.
       */
      onCitationClick?: (citation: CoachCitation) => boolean | void;
      /** Used to build anchor hrefs back to the race page. */
      raceBundleId?: string;
    };

function isLegacyCitation(c: LegacyCitation | CoachCitation): c is LegacyCitation {
  return c.type === "session" || c.type === "activity" || c.type === "debrief" || c.type === "verdict";
}

function buildHref(citation: CoachCitation, raceBundleId?: string): string | null {
  switch (citation.type) {
    case "segment":
      return raceBundleId ? `/races/${raceBundleId}#segment-${citation.refId}` : null;
    case "reference_frame":
      return raceBundleId ? `/races/${raceBundleId}#segment-${citation.refId.split(":")[0]}` : null;
    case "lesson":
      return raceBundleId ? `/races/${raceBundleId}#lessons` : null;
    case "pre_race":
      return raceBundleId ? `/races/${raceBundleId}#pre-race-state` : null;
    case "subjective":
      return raceBundleId ? `/races/${raceBundleId}#race-notes` : null;
    case "prior_race":
      return `/races/${citation.refId}`;
    case "best_comparable_training":
      return `/sessions/${citation.refId}`;
    default:
      return null;
  }
}

export function CitationChip(props: Props) {
  const { citation } = props;

  if (isLegacyCitation(citation)) {
    const baseRoute = LEGACY_TYPE_ROUTES[citation.type] ?? "/sessions";
    const href = `${baseRoute}/${citation.id}`;
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-400 transition hover:bg-cyan-500/20"
      >
        <span className="opacity-60">{TYPE_BADGE[citation.type]}</span>
        <span className="max-w-[160px] truncate">{citation.label}</span>
      </Link>
    );
  }

  const c = citation;
  const onCitationClick = "onCitationClick" in props ? props.onCitationClick : undefined;
  const raceBundleId = "raceBundleId" in props ? props.raceBundleId : undefined;
  const href = buildHref(c, raceBundleId);

  if (onCitationClick) {
    const handleClick = (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
      if ("metaKey" in event && (event.metaKey || event.ctrlKey || event.shiftKey)) return;
      const handled = onCitationClick(c);
      if (handled === true) {
        event.preventDefault();
      }
    };

    if (href) {
      return (
        <Link
          href={href}
          onClick={handleClick}
          className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-400 transition hover:bg-cyan-500/20"
        >
          <span className="opacity-60">{TYPE_BADGE[c.type]}</span>
          <span className="max-w-[180px] truncate">{c.label}</span>
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-400 transition hover:bg-cyan-500/20"
      >
        <span className="opacity-60">{TYPE_BADGE[c.type]}</span>
        <span className="max-w-[180px] truncate">{c.label}</span>
      </button>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-400 transition hover:bg-cyan-500/20"
      >
        <span className="opacity-60">{TYPE_BADGE[c.type]}</span>
        <span className="max-w-[180px] truncate">{c.label}</span>
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-400">
      <span className="opacity-60">{TYPE_BADGE[c.type]}</span>
      <span className="max-w-[180px] truncate">{c.label}</span>
    </span>
  );
}

type ChipsProps =
  | { citations: LegacyCitation[]; onCitationClick?: undefined; raceBundleId?: undefined }
  | {
      citations: CoachCitation[];
      onCitationClick?: (citation: CoachCitation) => boolean | void;
      raceBundleId?: string;
    };

export function CitationChips(props: ChipsProps) {
  const { citations } = props;
  if (!citations || citations.length === 0) return null;

  if (citations.length > 0 && isLegacyCitation(citations[0] as LegacyCitation | CoachCitation)) {
    return (
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {(citations as LegacyCitation[]).map((c, i) => (
          <CitationChip key={`${c.type}-${c.id}-${i}`} citation={c} />
        ))}
      </div>
    );
  }

  const onCitationClick = "onCitationClick" in props ? props.onCitationClick : undefined;
  const raceBundleId = "raceBundleId" in props ? props.raceBundleId : undefined;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {(citations as CoachCitation[]).map((c, i) => (
        <CitationChip
          key={`${c.type}-${c.refId}-${i}`}
          citation={c}
          onCitationClick={onCitationClick}
          raceBundleId={raceBundleId}
        />
      ))}
    </div>
  );
}
