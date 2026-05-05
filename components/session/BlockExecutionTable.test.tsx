import { render, screen, within } from "@testing-library/react";
import { BlockExecutionTable } from "./BlockExecutionTable";
import type { DetectedBlock } from "@/lib/blocks/types";
import type { ResolvedIntent } from "@/lib/intent/types";

function makeIntent(): ResolvedIntent {
  return {
    source: "plan",
    type: "threshold",
    structure: "intervals",
    resolved_at: "2026-01-01T00:00:00Z"
  };
}

function makeBlock(overrides: Partial<DetectedBlock> & { index: number; type: DetectedBlock["intended"]["type"] }): DetectedBlock {
  const { index, type, ...rest } = overrides;
  return {
    intended: {
      index,
      type,
      duration_min: 10,
      ...(rest.intended ?? {})
    },
    start_sec: 0,
    end_sec: 600,
    metrics: {
      duration_sec: 600,
      np: 200,
      hr_avg: 150,
      cadence_avg: 90,
      ...(rest.metrics ?? {})
    },
    alignment_confidence: 0.9,
    ...rest
  } as DetectedBlock;
}

describe("BlockExecutionTable", () => {
  test("renders rows in the order the blocks are provided", () => {
    const blocks: DetectedBlock[] = [
      makeBlock({ index: 1, type: "warmup", metrics: { duration_sec: 600, np: 120, hr_avg: 130, cadence_avg: 85 } }),
      makeBlock({ index: 2, type: "work", metrics: { duration_sec: 1200, np: 260, hr_avg: 165, cadence_avg: 92 } }),
      makeBlock({ index: 3, type: "cooldown", metrics: { duration_sec: 300, np: 110, hr_avg: 125, cadence_avg: 80 } })
    ];

    render(<BlockExecutionTable blocks={blocks} intent={makeIntent()} />);

    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText(/Block 1.*Warm-up/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Block 2.*Work/)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/Block 3.*Cool-down/)).toBeInTheDocument();
  });

  test("formats duration as mm:ss", () => {
    const blocks: DetectedBlock[] = [
      makeBlock({ index: 1, type: "warmup", metrics: { duration_sec: 65, np: 120, hr_avg: 130, cadence_avg: 85 } }),
      makeBlock({ index: 2, type: "work", metrics: { duration_sec: 605, np: 260, hr_avg: 165, cadence_avg: 92 } }),
      makeBlock({ index: 3, type: "cooldown", metrics: { duration_sec: 9, np: 100, hr_avg: 120, cadence_avg: 78 } })
    ];

    render(<BlockExecutionTable blocks={blocks} intent={makeIntent()} />);

    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getByText("10:05")).toBeInTheDocument();
    expect(screen.getByText("0:09")).toBeInTheDocument();
  });

  test("renders IF as em-dash when ftp is not provided", () => {
    const blocks: DetectedBlock[] = [
      makeBlock({ index: 1, type: "work", metrics: { duration_sec: 600, np: 250, hr_avg: 160, cadence_avg: 90 } })
    ];

    render(<BlockExecutionTable blocks={blocks} intent={makeIntent()} />);

    const row = screen.getByTestId("block-row-1");
    const cells = within(row).getAllByRole("cell");
    // Columns: Segment, Duration, NP, IF, HR, Cadence — IF is index 3
    expect(cells[3]).toHaveTextContent("—");
  });

  test("computes IF as np / ftp when ftp is provided", () => {
    const blocks: DetectedBlock[] = [
      makeBlock({ index: 1, type: "work", metrics: { duration_sec: 600, np: 250, hr_avg: 160, cadence_avg: 90 } }),
      makeBlock({ index: 2, type: "work", metrics: { duration_sec: 600, np: 200, hr_avg: 155, cadence_avg: 88 } })
    ];

    render(<BlockExecutionTable blocks={blocks} intent={makeIntent()} ftp={250} />);

    const row1 = screen.getByTestId("block-row-1");
    const row2 = screen.getByTestId("block-row-2");
    expect(within(row1).getAllByRole("cell")[3]).toHaveTextContent("1.00");
    expect(within(row2).getAllByRole("cell")[3]).toHaveTextContent("0.80");
  });

  test("highlights the strongest work block when highlightStrongest is true", () => {
    const blocks: DetectedBlock[] = [
      makeBlock({ index: 1, type: "warmup", metrics: { duration_sec: 600, np: 400, hr_avg: 130, cadence_avg: 85 } }), // higher NP but warmup — must not win
      makeBlock({ index: 2, type: "work", metrics: { duration_sec: 600, np: 240, hr_avg: 160, cadence_avg: 90 } }),
      makeBlock({ index: 3, type: "work", metrics: { duration_sec: 600, np: 280, hr_avg: 168, cadence_avg: 92 } }), // strongest
      makeBlock({ index: 4, type: "work", metrics: { duration_sec: 600, np: 250, hr_avg: 162, cadence_avg: 91 } }),
      makeBlock({ index: 5, type: "cooldown", metrics: { duration_sec: 300, np: 110, hr_avg: 120, cadence_avg: 78 } })
    ];

    render(<BlockExecutionTable blocks={blocks} intent={makeIntent()} highlightStrongest />);

    expect(screen.getByTestId("block-row-3")).toHaveAttribute("data-strongest", "true");
    expect(screen.getByTestId("block-row-1")).not.toHaveAttribute("data-strongest");
    expect(screen.getByTestId("block-row-2")).not.toHaveAttribute("data-strongest");
    expect(screen.getByTestId("block-row-4")).not.toHaveAttribute("data-strongest");
    expect(screen.getByTestId("block-row-5")).not.toHaveAttribute("data-strongest");
  });

  test("does not highlight any row when highlightStrongest is false", () => {
    const blocks: DetectedBlock[] = [
      makeBlock({ index: 1, type: "work", metrics: { duration_sec: 600, np: 280, hr_avg: 168, cadence_avg: 92 } }),
      makeBlock({ index: 2, type: "work", metrics: { duration_sec: 600, np: 240, hr_avg: 160, cadence_avg: 90 } })
    ];

    render(<BlockExecutionTable blocks={blocks} intent={makeIntent()} />);

    expect(screen.getByTestId("block-row-1")).not.toHaveAttribute("data-strongest");
    expect(screen.getByTestId("block-row-2")).not.toHaveAttribute("data-strongest");
  });

  test("renders an empty state when blocks is empty", () => {
    render(<BlockExecutionTable blocks={[]} intent={makeIntent()} />);

    expect(screen.getByTestId("block-execution-empty")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("renders em-dash for missing metric values", () => {
    const blocks: DetectedBlock[] = [
      makeBlock({
        index: 1,
        type: "work",
        metrics: { duration_sec: 600, np: undefined, hr_avg: undefined, cadence_avg: undefined }
      })
    ];

    render(<BlockExecutionTable blocks={blocks} intent={makeIntent()} ftp={250} />);

    const row = screen.getByTestId("block-row-1");
    const cells = within(row).getAllByRole("cell");
    // Segment, Duration, NP, IF, HR, Cadence
    expect(cells[2]).toHaveTextContent("—"); // NP
    expect(cells[3]).toHaveTextContent("—"); // IF (np missing)
    expect(cells[4]).toHaveTextContent("—"); // HR
    expect(cells[5]).toHaveTextContent("—"); // Cadence
  });

  test("includes intended description in the segment label when present", () => {
    const blocks: DetectedBlock[] = [
      {
        intended: {
          index: 2,
          type: "work",
          duration_min: 10,
          description: "5×3min @ FTP"
        },
        start_sec: 600,
        end_sec: 1200,
        metrics: { duration_sec: 600, np: 250, hr_avg: 165, cadence_avg: 92 },
        alignment_confidence: 0.9
      }
    ];

    render(<BlockExecutionTable blocks={blocks} intent={makeIntent()} />);

    expect(screen.getByText(/Block 2.*Work.*5×3min @ FTP/)).toBeInTheDocument();
  });
});
