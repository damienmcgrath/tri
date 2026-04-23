"use client";

/**
 * Stacked bar chart showing actual vs target discipline distribution.
 * SVG-based, no external charting library.
 */

type Distribution = {
  swim: number;
  bike: number;
  run: number;
  strength?: number;
};

type Props = {
  actual: Distribution;
  target: Distribution;
  deltas: { swim: number; bike: number; run: number };
};

const SPORT_COLORS: Record<string, string> = {
  swim: "#3b82f6", // blue
  bike: "#6b7280", // grey-green
  run: "#f97316", // coral/orange
  strength: "#8b5cf6", // purple
};

const SPORT_LABELS: Record<string, string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function DeltaBadge({ delta }: { delta: number }) {
  const abs = Math.abs(delta);
  if (abs < 3) return null;

  const color =
    abs >= 10 ? "text-red-400" : abs >= 5 ? "text-amber-400" : "text-neutral-400";
  const sign = delta > 0 ? "+" : "\u2212";

  return (
    <span className={`ml-1 text-ui-label ${color}`}>
      {sign}{abs}pp
    </span>
  );
}

export function DisciplineDistributionChart({ actual, target, deltas }: Props) {
  const sports = ["swim", "bike", "run"] as const;
  const barHeight = 20;
  const gap = 8;
  const labelWidth = 44;
  const chartWidth = 260;

  return (
    <div className="surface p-4">
      <p className="label mb-3">Discipline Balance</p>

      <svg
        width="100%"
        viewBox={`0 0 ${labelWidth + chartWidth + 50} ${(barHeight * 2 + gap) * 3 + 8}`}
        className="max-w-sm"
      >
        {sports.map((sport, i) => {
          const y = i * (barHeight * 2 + gap + 4);
          const actualW = (actual[sport] ?? 0) * chartWidth;
          const targetW = (target[sport] ?? 0) * chartWidth;

          return (
            <g key={sport}>
              {/* Sport label */}
              <text x={0} y={y + barHeight / 2 + 4} className="fill-current text-ui-label" dominantBaseline="middle">
                {SPORT_LABELS[sport]}
              </text>

              {/* Actual bar */}
              <rect
                x={labelWidth}
                y={y}
                width={Math.max(1, actualW)}
                height={barHeight}
                rx={3}
                fill={SPORT_COLORS[sport]}
                opacity={0.7}
              />
              <text
                x={labelWidth + Math.max(1, actualW) + 4}
                y={y + barHeight / 2}
                className="fill-current text-ui-label text-muted"
                dominantBaseline="middle"
              >
                {pct(actual[sport] ?? 0)}
              </text>

              {/* Target bar (outline) */}
              <rect
                x={labelWidth}
                y={y + barHeight + 2}
                width={Math.max(1, targetW)}
                height={4}
                rx={2}
                fill={SPORT_COLORS[sport]}
                opacity={0.25}
              />

              {/* Delta annotation */}
              <text
                x={labelWidth + chartWidth + 4}
                y={y + barHeight / 2}
                className={`text-ui-label ${Math.abs(deltas[sport]) >= 10 ? "fill-red-400" : Math.abs(deltas[sport]) >= 5 ? "fill-amber-400" : "fill-neutral-500"}`}
                dominantBaseline="middle"
              >
                {deltas[sport] > 0 ? "+" : ""}{deltas[sport]}pp
              </text>
            </g>
          );
        })}
      </svg>

      {/* Inline legend */}
      <div className="mt-2 flex gap-4 text-ui-label text-muted">
        {sports.map((sport) => (
          <span key={sport} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SPORT_COLORS[sport] }} />
            {SPORT_LABELS[sport]} {pct(actual[sport] ?? 0)}
            <DeltaBadge delta={deltas[sport]} />
          </span>
        ))}
      </div>
    </div>
  );
}
