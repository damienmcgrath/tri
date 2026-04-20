import { computeBlockBoundaries } from "./facts";

describe("computeBlockBoundaries", () => {
  test("returns 28-day inclusive blocks", () => {
    const { blockStart, blockEnd, priorBlockStart, priorBlockEnd } =
      computeBlockBoundaries("2026-04-28");

    expect(blockEnd).toBe("2026-04-28");
    expect(blockStart).toBe("2026-04-01"); // 28 days inclusive = Apr 1..Apr 28
    expect(priorBlockEnd).toBe("2026-03-31");
    expect(priorBlockStart).toBe("2026-03-04"); // 28 days inclusive
  });

  test("current block and prior block do not overlap and are contiguous", () => {
    const { blockStart, priorBlockEnd } = computeBlockBoundaries("2026-04-28");
    const nextDay = new Date(`${priorBlockEnd}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    expect(nextDay.toISOString().slice(0, 10)).toBe(blockStart);
  });

  test("handles year boundaries", () => {
    const { blockStart, blockEnd } = computeBlockBoundaries("2026-01-15");
    expect(blockEnd).toBe("2026-01-15");
    expect(blockStart).toBe("2025-12-19");
  });
});
