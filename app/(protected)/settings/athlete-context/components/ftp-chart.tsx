"use client";

import type { AthleteFtpHistoryEntry } from "@/lib/athlete-ftp";

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  // iso may be "YYYY-MM-DD" or a full ISO timestamp
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatDateLong(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  ramp_test: "Ramp test",
  estimated: "Estimated",
};

// ── chart constants ───────────────────────────────────────────────────────────

const ACCENT = "rgb(190,255,0)";
const LABEL_COLOR = "rgba(255,255,255,0.68)";
const GRID_COLOR = "rgba(255,255,255,0.08)";
const POINT_RADIUS = 4;
const HOVER_RADIUS = 6;

const MARGIN = { top: 16, right: 16, bottom: 36, left: 44 };
const VIEW_W = 520;
const VIEW_H = 180;
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom;

// ── trend indicator ───────────────────────────────────────────────────────────

function TrendIndicator({ entries }: { entries: AthleteFtpHistoryEntry[] }) {
  if (entries.length < 2) return null;

  // entries are sorted DESC; oldest is last
  const newest = entries[0].value;
  const oldest = entries[entries.length - 1].value;
  const delta = newest - oldest;
  const oldestDate = formatDateLong(entries[entries.length - 1].recorded_at);

  let arrow: string;
  let label: string;
  let color: string;

  if (Math.abs(delta) < 1) {
    arrow = "→";
    label = `Stable since ${oldestDate}`;
    color = LABEL_COLOR;
  } else if (delta > 0) {
    arrow = "↑";
    label = `+${delta}W since ${oldestDate}`;
    color = ACCENT;
  } else {
    arrow = "↓";
    label = `${delta}W since ${oldestDate}`;
    color = "rgb(255,80,80)";
  }

  return (
    <p className="mt-2 text-xs tabular-nums" style={{ color }}>
      {arrow} {label}
    </p>
  );
}

// ── main chart component ──────────────────────────────────────────────────────

type Props = {
  entries: AthleteFtpHistoryEntry[];
};

export function FtpChart({ entries }: Props) {
  if (entries.length === 0) return null;

  // entries are sorted DESC — reverse for chronological order on the X axis
  const chronological = [...entries].reverse();

  // Y axis: pad the range a bit so the line isn't flush with the edges
  const values = chronological.map((e) => e.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = rawMin === rawMax ? 20 : Math.max(10, Math.round((rawMax - rawMin) * 0.2));
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;
  const yRange = yMax - yMin;

  // Compute nice gridline values (3-4 lines)
  const yTicks = computeYTicks(yMin, yMax, 4);

  function toX(i: number): number {
    if (chronological.length === 1) return MARGIN.left + PLOT_W / 2;
    return MARGIN.left + (i / (chronological.length - 1)) * PLOT_W;
  }

  function toY(v: number): number {
    return MARGIN.top + PLOT_H - ((v - yMin) / yRange) * PLOT_H;
  }

  // Build SVG polyline points string
  const polylinePoints = chronological
    .map((e, i) => `${toX(i)},${toY(e.value)}`)
    .join(" ");

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full overflow-visible"
        style={{ maxHeight: 200 }}
        aria-label="FTP history chart"
      >
        {/* ── gridlines + Y axis labels ─────────────────────────────────── */}
        {yTicks.map((tick) => {
          const y = toY(tick);
          return (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                y1={y}
                x2={MARGIN.left + PLOT_W}
                y2={y}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill={LABEL_COLOR}
                fontFamily="var(--font-geist-mono, monospace)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* ── X axis date labels ────────────────────────────────────────── */}
        {chronological.map((entry, i) => {
          // Only show first, last, and evenly spaced labels to avoid crowding
          const shouldShow =
            chronological.length <= 4 ||
            i === 0 ||
            i === chronological.length - 1 ||
            i % Math.ceil((chronological.length - 1) / 3) === 0;
          if (!shouldShow) return null;
          return (
            <text
              key={entry.id || i}
              x={toX(i)}
              y={MARGIN.top + PLOT_H + 18}
              textAnchor="middle"
              fontSize={10}
              fill={LABEL_COLOR}
              fontFamily="var(--font-geist-mono, monospace)"
            >
              {formatDate(entry.recorded_at)}
            </text>
          );
        })}

        {/* ── gradient fill under the line ─────────────────────────────── */}
        <defs>
          <linearGradient id="ftp-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
          {/* Clip to plot area */}
          <clipPath id="ftp-clip">
            <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_W} height={PLOT_H} />
          </clipPath>
        </defs>

        {chronological.length >= 2 && (
          <polygon
            points={`
              ${chronological.map((e, i) => `${toX(i)},${toY(e.value)}`).join(" ")}
              ${toX(chronological.length - 1)},${MARGIN.top + PLOT_H}
              ${toX(0)},${MARGIN.top + PLOT_H}
            `}
            fill="url(#ftp-fill)"
            clipPath="url(#ftp-clip)"
          />
        )}

        {/* ── line ─────────────────────────────────────────────────────── */}
        {chronological.length >= 2 && (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke={ACCENT}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            clipPath="url(#ftp-clip)"
          />
        )}

        {/* ── data points (with native SVG title tooltips) ─────────────── */}
        {chronological.map((entry, i) => (
          <g key={entry.id || i} style={{ cursor: "default" }}>
            {/* Larger invisible hit area */}
            <circle
              cx={toX(i)}
              cy={toY(entry.value)}
              r={HOVER_RADIUS + 4}
              fill="transparent"
            />
            {/* Visible point */}
            <circle
              cx={toX(i)}
              cy={toY(entry.value)}
              r={POINT_RADIUS}
              fill={ACCENT}
              stroke="rgb(10,10,10)"
              strokeWidth={1.5}
            />
            <title>
              {entry.value}W · {formatDateLong(entry.recorded_at)} · {SOURCE_LABELS[entry.source] ?? entry.source}
              {entry.notes ? ` · ${entry.notes}` : ""}
            </title>
          </g>
        ))}
      </svg>

      <TrendIndicator entries={entries} />
    </div>
  );
}

// ── utility: compute readable Y tick values ───────────────────────────────────

function computeYTicks(min: number, max: number, targetCount: number): number[] {
  const range = max - min;
  if (range === 0) return [min];

  // Choose a nice step size
  const roughStep = range / (targetCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  let niceStep: number;
  if (normalized <= 1) niceStep = magnitude;
  else if (normalized <= 2) niceStep = 2 * magnitude;
  else if (normalized <= 5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const start = Math.ceil(min / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = start; v <= max; v += niceStep) {
    ticks.push(Math.round(v));
  }
  return ticks;
}
