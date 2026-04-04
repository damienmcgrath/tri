import Link from "next/link";
import type { MorningBrief } from "@/lib/training/morning-brief";

type Props = {
  brief: MorningBrief;
};

export function MorningBriefCard({ brief }: Props) {
  return (
    <article className="surface p-5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tertiary">
        Morning brief
      </p>

      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white">
        {brief.briefText}
      </p>

      {brief.pendingActions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {brief.pendingActions.map((action, i) => {
            const isAdaptation = /adaptation/i.test(action);
            const isDebrief = /debrief/i.test(action);
            const href = isAdaptation ? "/calendar" : isDebrief ? "/debrief" : "/dashboard";
            return (
              <Link
                key={i}
                href={href}
                className="rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.7)] transition hover:bg-[rgba(255,255,255,0.08)]"
              >
                {action}
              </Link>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
