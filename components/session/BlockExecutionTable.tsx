// Spec: tri.ai Findings Pipeline Spec §3.6 (Phase 2).
// Renders detected blocks vs. their intended segments on Session Review.

import type { DetectedBlock } from "@/lib/blocks/types";
import type { IntendedBlockType, ResolvedIntent } from "@/lib/intent/types";

export interface BlockExecutionTableProps {
  blocks: DetectedBlock[];
  intent: ResolvedIntent;
  highlightStrongest?: boolean;
  ftp?: number;
}

const EM_DASH = "—";

const TYPE_LABEL: Record<IntendedBlockType, string> = {
  warmup: "Warm-up",
  work: "Work",
  easy: "Easy",
  cooldown: "Cool-down",
  tail: "Tail"
};

function formatDuration(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec < 0) return EM_DASH;
  const total = Math.round(durationSec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatWatts(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${Math.round(value)} W`;
}

function formatIF(np: number | undefined, ftp: number | undefined): string {
  if (ftp === undefined || !Number.isFinite(ftp) || ftp <= 0) return EM_DASH;
  if (np === undefined || !Number.isFinite(np)) return EM_DASH;
  return (np / ftp).toFixed(2);
}

function formatHR(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${Math.round(value)}`;
}

function formatCadence(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${Math.round(value)}`;
}

function segmentLabel(block: DetectedBlock): string {
  const typeLabel = TYPE_LABEL[block.intended.type] ?? block.intended.type;
  const base = `Block ${block.intended.index} ${EM_DASH} ${typeLabel}`;
  const description = block.intended.description?.trim();
  return description ? `${base} ${EM_DASH} ${description}` : base;
}

function findStrongestWorkIndex(blocks: DetectedBlock[]): number {
  let strongestIdx = -1;
  let strongestNp = -Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.intended.type !== "work") continue;
    const np = block.metrics.np;
    if (np === undefined || !Number.isFinite(np)) continue;
    if (np > strongestNp) {
      strongestNp = np;
      strongestIdx = i;
    }
  }
  return strongestIdx;
}

export function BlockExecutionTable({
  blocks,
  intent: _intent,
  highlightStrongest = false,
  ftp
}: BlockExecutionTableProps) {
  if (blocks.length === 0) {
    return (
      <div
        data-testid="block-execution-empty"
        className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-5 py-6 text-sm text-muted"
      >
        No blocks detected for this session.
      </div>
    );
  }

  const strongestIdx = highlightStrongest ? findStrongestWorkIndex(blocks) : -1;
  const numericCell = "px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap";

  return (
    <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[rgba(255,255,255,0.03)] text-left">
            <th scope="col" className="px-3 py-2 text-xs font-normal text-tertiary">Segment</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-normal text-tertiary">Duration</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-normal text-tertiary">NP</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-normal text-tertiary">IF</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-normal text-tertiary">HR avg</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-normal text-tertiary">Cadence avg</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--border))]">
          {blocks.map((block, idx) => {
            const isStrongest = idx === strongestIdx;
            const rowClass = isStrongest
              ? "bg-[var(--color-accent-muted)] border-l-2 border-[var(--color-accent)]"
              : "";
            const labelClass = isStrongest ? "text-accent font-medium" : "text-muted";
            const numericClass = isStrongest ? `${numericCell} text-white` : `${numericCell} text-tertiary`;
            return (
              <tr
                key={`${block.intended.index}-${block.start_sec}`}
                data-testid={`block-row-${block.intended.index}`}
                data-strongest={isStrongest ? "true" : undefined}
                className={rowClass}
              >
                <td className={`px-3 py-2 ${labelClass}`}>{segmentLabel(block)}</td>
                <td className={numericClass}>{formatDuration(block.metrics.duration_sec)}</td>
                <td className={numericClass}>{formatWatts(block.metrics.np)}</td>
                <td className={numericClass}>{formatIF(block.metrics.np, ftp)}</td>
                <td className={numericClass}>{formatHR(block.metrics.hr_avg)}</td>
                <td className={numericClass}>{formatCadence(block.metrics.cadence_avg)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
