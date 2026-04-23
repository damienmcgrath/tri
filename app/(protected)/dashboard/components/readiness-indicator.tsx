import type { ReadinessState } from "@/lib/training/fitness-model";

type Props = {
  readiness: ReadinessState;
  tsb: number;
  tsbTrend?: "rising" | "stable" | "declining" | null;
  /** Short contextual clause appended to the cue (e.g. "pace and power both trending down"). */
  signalContext?: string | null;
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

function trendLabel(trend: Props["tsbTrend"]): string | null {
  if (trend === "rising") return "TSB rising";
  if (trend === "declining") return "TSB declining";
  return null;
}

export function ReadinessIndicator({ readiness, tsb, tsbTrend, signalContext }: Props) {
  const config = READINESS_CONFIG[readiness];
  const trendTag = trendLabel(tsbTrend);
  const cueParts = [config.cue];
  if (signalContext) cueParts.push(signalContext);
  const cue = cueParts.join(" — ");

  return (
    <article
      className="rounded-xl border p-4"
      style={{ borderColor: config.borderColor, backgroundColor: config.bgColor }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: config.color }}
          />
          <span className="text-ui-label font-medium uppercase tracking-[0.12em]" style={{ color: config.color }}>
            {config.label}
          </span>
          <span className="text-ui-label font-mono text-tertiary">
            TSB {tsb > 0 ? "+" : ""}{Math.round(tsb)}
          </span>
          {trendTag ? (
            <span className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-2 py-0.5 text-ui-label text-tertiary">
              {trendTag}
            </span>
          ) : null}
        </div>
        <span className="text-kicker text-tertiary">Readiness</span>
      </div>
      <p className="mt-2 text-body text-[rgba(255,255,255,0.78)]">{cue}</p>
    </article>
  );
}
