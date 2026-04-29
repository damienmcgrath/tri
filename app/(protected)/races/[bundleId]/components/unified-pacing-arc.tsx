/**
 * Unified pacing arc — single chart spanning the full race timeline.
 *
 * Renders pre-computed series from `race_reviews.pacing_arc_data`:
 *   - HR continuous across all legs (primary axis)
 *   - Power overlay on the bike segment only (secondary axis, watts)
 *   - Pace overlay on the run segment only (secondary axis, sec/km — inverted
 *     so faster pace renders higher)
 *   - Vertical guides at sport transitions
 *   - Threshold-HR reference line when known
 *   - Visible discontinuities at T1/T2 when bundle source is Strava-stitched
 *     (inferred transitions). Honesty over aesthetics.
 *
 * Implementation is plain SVG so we don't pull in a charting dependency for
 * one visualization. Lap-resolution points come from metrics_v2.laps; we
 * draw piecewise lines per leg.
 */

import type { PacingArcData } from "@/lib/race-review/pacing-arc";

type Props = {
  data: PacingArcData;
};

const VIEW_W = 800;
const VIEW_H = 240;
const PADDING = { top: 16, right: 56, bottom: 28, left: 48 };

export function UnifiedPacingArc({ data }: Props) {
  const innerW = VIEW_W - PADDING.left - PADDING.right;
  const innerH = VIEW_H - PADDING.top - PADDING.bottom;
  const totalSec = data.totalDurationSec || 1;

  const hrPoints = data.points.filter((p) => typeof p.hr === "number" && p.hr! > 0);
  const powerPoints = data.points.filter(
    (p) => p.role === "bike" && typeof p.power === "number" && p.power! > 0
  );
  const runPacePoints = data.points.filter(
    (p) => p.role === "run" && typeof p.paceSec === "number" && p.paceSec! > 0
  );

  const hrMin = minOf(hrPoints.map((p) => p.hr!), 100);
  const hrMax = maxOf(hrPoints.map((p) => p.hr!), 180);
  const hrRange = Math.max(10, hrMax - hrMin);

  const powerMin = minOf(powerPoints.map((p) => p.power!), 100);
  const powerMax = maxOf(powerPoints.map((p) => p.power!), 250);
  const powerRange = Math.max(20, powerMax - powerMin);

  // Run pace inverted — faster (lower seconds) renders higher.
  const paceMin = minOf(runPacePoints.map((p) => p.paceSec!), 240);
  const paceMax = maxOf(runPacePoints.map((p) => p.paceSec!), 360);
  const paceRange = Math.max(20, paceMax - paceMin);

  const xScale = (tSec: number) => PADDING.left + (tSec / totalSec) * innerW;
  const hrY = (bpm: number) => PADDING.top + innerH - ((bpm - hrMin) / hrRange) * innerH;
  const powerY = (w: number) => PADDING.top + innerH - ((w - powerMin) / powerRange) * innerH;
  const paceY = (sec: number) =>
    PADDING.top + innerH - ((paceMax - sec) / paceRange) * innerH;

  const hrPath = pathFromPoints(hrPoints.map((p) => [xScale(p.tSec), hrY(p.hr!)]));
  // Bike power as its own segment (already filtered to role=bike).
  const powerPath = pathFromPoints(powerPoints.map((p) => [xScale(p.tSec), powerY(p.power!)]));
  const pacePath = pathFromPoints(runPacePoints.map((p) => [xScale(p.tSec), paceY(p.paceSec!)]));

  const thresholdY = data.thresholdHrBpm ? hrY(data.thresholdHrBpm) : null;

  return (
    <article className="surface p-5">
      <header className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Pacing arc</p>
        <p className="text-[10px] text-tertiary">
          HR · Bike power · Run pace
          {data.inferredGaps ? " · stitched" : null}
        </p>
      </header>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="Unified pacing arc across the full race timeline"
        className="mt-3 w-full"
      >
        {/* Leg shading */}
        {data.legBoundaries.map((leg) => {
          const x1 = xScale(leg.startSec);
          const x2 = xScale(leg.endSec);
          return (
            <rect
              key={`leg-${leg.role}-${leg.startSec}`}
              x={x1}
              y={PADDING.top}
              width={Math.max(0, x2 - x1)}
              height={innerH}
              fill={LEG_FILL[leg.role] ?? "transparent"}
              opacity={0.04}
            />
          );
        })}

        {/* Transition bands */}
        {data.transitions.map((t) => {
          const x1 = xScale(t.startSec);
          const x2 = xScale(t.endSec);
          return (
            <g key={`t-${t.role}-${t.startSec}`}>
              <rect
                x={x1}
                y={PADDING.top}
                width={Math.max(0, x2 - x1)}
                height={innerH}
                fill="hsl(var(--border))"
                opacity={t.inferred ? 0.18 : 0.08}
              />
              <text
                x={(x1 + x2) / 2}
                y={PADDING.top + 12}
                textAnchor="middle"
                className="fill-tertiary"
                fontSize="9"
              >
                {t.role.toUpperCase()}
                {t.inferred ? " ·" : ""}
              </text>
            </g>
          );
        })}

        {/* Threshold HR reference line */}
        {thresholdY !== null ? (
          <g>
            <line
              x1={PADDING.left}
              x2={PADDING.left + innerW}
              y1={thresholdY}
              y2={thresholdY}
              stroke="var(--color-warning)"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <text
              x={PADDING.left + innerW + 4}
              y={thresholdY}
              alignmentBaseline="middle"
              className="fill-tertiary"
              fontSize="10"
            >
              FTHR {data.thresholdHrBpm}
            </text>
          </g>
        ) : null}

        {/* Vertical leg guides */}
        {data.legBoundaries.map((leg, idx) => {
          if (idx === 0) return null;
          const x = xScale(leg.startSec);
          return (
            <line
              key={`guide-${idx}`}
              x1={x}
              x2={x}
              y1={PADDING.top}
              y2={PADDING.top + innerH}
              stroke="hsl(var(--border))"
              strokeWidth={1}
            />
          );
        })}

        {/* HR line (primary) */}
        {hrPath ? (
          <path d={hrPath} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} />
        ) : null}

        {/* Bike power overlay */}
        {powerPath ? (
          <path d={powerPath} fill="none" stroke={LEG_STROKE.bike} strokeWidth={1.25} strokeOpacity={0.9} />
        ) : null}

        {/* Run pace overlay */}
        {pacePath ? (
          <path d={pacePath} fill="none" stroke={LEG_STROKE.run} strokeWidth={1.25} strokeOpacity={0.9} />
        ) : null}

        {/* X axis labels (start / mid / end) */}
        <text x={PADDING.left} y={VIEW_H - 8} fontSize="10" className="fill-tertiary">
          0:00
        </text>
        <text x={PADDING.left + innerW / 2} y={VIEW_H - 8} fontSize="10" textAnchor="middle" className="fill-tertiary">
          {formatDuration(totalSec / 2)}
        </text>
        <text x={PADDING.left + innerW} y={VIEW_H - 8} fontSize="10" textAnchor="end" className="fill-tertiary">
          {formatDuration(totalSec)}
        </text>

        {/* Y axis HR labels */}
        <text x={PADDING.left - 8} y={hrY(hrMax)} fontSize="10" textAnchor="end" alignmentBaseline="middle" className="fill-tertiary">
          {Math.round(hrMax)}
        </text>
        <text x={PADDING.left - 8} y={hrY(hrMin)} fontSize="10" textAnchor="end" alignmentBaseline="middle" className="fill-tertiary">
          {Math.round(hrMin)}
        </text>
      </svg>

      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-tertiary">
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4" style={{ backgroundColor: "rgba(255,255,255,0.85)" }} />
          HR
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4" style={{ backgroundColor: LEG_STROKE.bike }} />
          Bike power
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4" style={{ backgroundColor: LEG_STROKE.run }} />
          Run pace
        </li>
        {data.thresholdHrBpm ? (
          <li className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-[1px] w-4 border-t border-dashed"
              style={{ borderColor: "var(--color-warning)" }}
            />
            FTHR
          </li>
        ) : null}
        {data.inferredGaps ? (
          <li className="text-tertiary">Stitched bundle — transitions inferred from gaps.</li>
        ) : null}
      </ul>
    </article>
  );
}

const LEG_FILL: Record<string, string> = {
  swim: "rgba(56, 189, 248, 1)",
  bike: "rgba(251, 191, 36, 1)",
  run: "rgba(52, 211, 153, 1)"
};

const LEG_STROKE: Record<string, string> = {
  swim: "rgba(56, 189, 248, 0.95)",
  bike: "rgba(251, 191, 36, 0.95)",
  run: "rgba(52, 211, 153, 0.95)"
};

function pathFromPoints(points: Array<[number, number]>): string | null {
  if (points.length === 0) return null;
  const [first, ...rest] = points;
  const head = `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  const tail = rest.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return rest.length > 0 ? `${head} ${tail}` : head;
}

function minOf(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return Math.min(...values);
}

function maxOf(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return Math.max(...values);
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
