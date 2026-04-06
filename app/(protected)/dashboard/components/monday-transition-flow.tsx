import Link from "next/link";
import type { WeekTransitionBriefing } from "@/lib/training/week-transition";
import type { MorningBrief } from "@/lib/training/morning-brief";

type Props = {
  briefing: WeekTransitionBriefing;
  morningBrief: MorningBrief | null;
  debriefSummary: string | null;
  pendingRationaleCount: number;
  weekStart: string;
};

export function MondayTransitionFlow({ briefing, morningBrief, debriefSummary, pendingRationaleCount, weekStart }: Props) {
  return (
    <article className="surface space-y-0 overflow-hidden">
      {/* Section 1: Last Week */}
      <div className="border-b border-[rgba(255,255,255,0.06)] p-4 md:p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">Last week</p>
        <p className="mt-2 text-sm leading-relaxed text-white">{briefing.lastWeekTakeaway}</p>
        {debriefSummary ? (
          <p className="mt-1.5 text-sm leading-relaxed text-[rgba(255,255,255,0.65)]">{debriefSummary}</p>
        ) : null}
        <Link href={`/debrief?weekStart=${weekStart}`} className="mt-2 inline-block text-[11px] text-cyan-400 hover:text-cyan-300">
          Open full debrief →
        </Link>
      </div>

      {/* Section 2: This Week */}
      <div className="border-b border-[rgba(255,255,255,0.06)] p-4 md:p-5">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">This week</p>
        <p className="mt-2 text-sm leading-relaxed text-white">{briefing.thisWeekFocus}</p>
        {briefing.adaptationContext ? (
          <p className="mt-1.5 rounded-lg border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.06)] px-3 py-2 text-xs text-[hsl(var(--warning))]">
            {briefing.adaptationContext}
          </p>
        ) : null}
        <Link href="/calendar" className="mt-2 inline-block text-[11px] text-cyan-400 hover:text-cyan-300">
          View this week&apos;s calendar →
        </Link>
      </div>

      {/* Section 3: Today */}
      {morningBrief?.sessionPreview ? (
        <div className="border-b border-[rgba(255,255,255,0.06)] p-4 md:p-5">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">Today</p>
          <p className="mt-2 text-sm leading-relaxed text-white">{morningBrief.sessionPreview}</p>
        </div>
      ) : null}

      {/* Section 4: Pending Actions */}
      {pendingRationaleCount > 0 || briefing.coachingPrompt ? (
        <div className="p-4 md:p-5">
          {pendingRationaleCount > 0 ? (
            <p className="text-sm text-[rgba(255,255,255,0.7)]">
              You have {pendingRationaleCount} adaptation{pendingRationaleCount === 1 ? "" : "s"} to review.{" "}
              <Link href="/calendar" className="text-cyan-400 hover:text-cyan-300">View on Calendar →</Link>
            </p>
          ) : null}
          {briefing.coachingPrompt ? (
            <Link
              href={`/coach?prompt=${encodeURIComponent(briefing.coachingPrompt)}`}
              className="mt-2 inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300"
            >
              Reply to coach →
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
