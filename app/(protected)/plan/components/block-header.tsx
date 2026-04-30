"use client";

export type BlockHeaderBlock = {
  id: string;
  name: string;
  block_type: string;
  sort_order: number;
};

type Props = {
  block: BlockHeaderBlock;
  blocks: BlockHeaderBlock[];
  blockIndex: number;
  currentWeekIndexInBlock: number | null;
  totalWeeksInBlock: number;
  onSelectBlock: (blockId: string) => void;
};

export function BlockHeader({
  block,
  blocks,
  blockIndex,
  currentWeekIndexInBlock,
  totalWeeksInBlock,
  onSelectBlock
}: Props) {
  const sorted = [...blocks].sort((a, b) => a.sort_order - b.sort_order);
  const currentIdx = sorted.findIndex((b) => b.id === block.id);
  const prev = currentIdx > 0 ? sorted[currentIdx - 1] : null;
  const next = currentIdx >= 0 && currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null;

  const weekLabel =
    totalWeeksInBlock > 0 && currentWeekIndexInBlock != null
      ? `Wk ${currentWeekIndexInBlock} of ${totalWeeksInBlock}`
      : `${totalWeeksInBlock} wk`;

  return (
    <header className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.08)] px-4 py-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Previous block"
          onClick={() => prev && onSelectBlock(prev.id)}
          disabled={!prev}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-sm text-[rgba(255,255,255,0.7)] transition disabled:opacity-30"
        >
          ‹
        </button>
        <h1 className="text-sm font-medium text-white">
          <span className="text-tertiary">Block {blockIndex} —</span>{" "}
          <span className="font-semibold">{block.name}</span>
          <span className="text-tertiary"> · {block.block_type}</span>
          <span className="text-tertiary"> · {weekLabel}</span>
        </h1>
        <button
          type="button"
          aria-label="Next block"
          onClick={() => next && onSelectBlock(next.id)}
          disabled={!next}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-sm text-[rgba(255,255,255,0.7)] transition disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </header>
  );
}
