import type { ReadinessState } from "@/lib/training/fitness-model";

type Props = {
  readiness: ReadinessState;
  tsb: number;
};

const READINESS_CONFIG: Record<ReadinessState, { label: string; color: string; bgColor: string; borderColor: string; cue: string }> = {
  fresh: {
    label: "Fresh",
    color: "rgb(52, 211, 153)",
    bgColor: "rgba(52, 211, 153, 0.08)",
    borderColor: "rgba(52, 211, 153, 0.25)",
    cue: "Push today's key session with confidence",
  },
  absorbing: {
    label: "Absorbing",
    color: "rgb(251, 191, 36)",
    bgColor: "rgba(251, 191, 36, 0.08)",
    borderColor: "rgba(251, 191, 36, 0.25)",
    cue: "Training is loading well — stay the course",
  },
  fatigued: {
    label: "Fatigued",
    color: "rgb(251, 146, 60)",
    bgColor: "rgba(251, 146, 60, 0.08)",
    borderColor: "rgba(251, 146, 60, 0.25)",
    cue: "Protect your easy sessions this week",
  },
  overreaching: {
    label: "Overreaching",
    color: "rgb(248, 113, 113)",
    bgColor: "rgba(248, 113, 113, 0.08)",
    borderColor: "rgba(248, 113, 113, 0.25)",
    cue: "Consider extra recovery — your body is deep in a load cycle",
  },
};

export function ReadinessIndicator({ readiness, tsb }: Props) {
  const config = READINESS_CONFIG[readiness];

  return (
    <article
      className="rounded-xl border p-3"
      style={{ borderColor: config.borderColor, backgroundColor: config.bgColor }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <span className="text-xs font-medium uppercase tracking-[0.1em]" style={{ color: config.color }}>
          {config.label}
        </span>
        <span className="text-[11px] text-tertiary">
          TSB {tsb > 0 ? "+" : ""}{Math.round(tsb)}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-[rgba(255,255,255,0.7)]">{config.cue}</p>
    </article>
  );
}
