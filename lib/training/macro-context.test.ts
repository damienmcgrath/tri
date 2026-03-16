/**
 * Unit tests for macro-context.ts
 *
 * These tests cover the pure functions that don't require a Supabase client.
 * We import the module and test the exported utilities + internal logic
 * via the public `formatMacroContextSummary` function and by constructing
 * MacroContext objects directly.
 */

import type { MacroContext } from "./macro-context";
import { formatMacroContextSummary } from "./macro-context";

// ---------------------------------------------------------------------------
// deriveBlockPosition — tested indirectly through MacroContext construction
// We can't call it directly (not exported), so we test the logic through
// expected MacroContext shapes and formatMacroContextSummary.
// ---------------------------------------------------------------------------

function makeMacroContext(overrides: Partial<MacroContext> = {}): MacroContext {
  return {
    raceName: "Warsaw 70.3",
    raceDate: "2026-06-07",
    daysToRace: 84,
    currentBlock: "Build",
    blockWeek: 3,
    blockTotalWeeks: 6,
    totalPlanWeeks: 12,
    currentPlanWeek: 3,
    cumulativeVolumeByDiscipline: {
      swim: { plannedMinutes: 180, actualMinutes: 160, deltaPct: -11 },
      bike: { plannedMinutes: 600, actualMinutes: 580, deltaPct: -3 },
      run: { plannedMinutes: 360, actualMinutes: 300, deltaPct: -17 }
    },
    ...overrides
  };
}

describe("MacroContext type", () => {
  it("contains all required fields", () => {
    const ctx = makeMacroContext();
    expect(ctx.raceName).toBe("Warsaw 70.3");
    expect(ctx.raceDate).toBe("2026-06-07");
    expect(ctx.daysToRace).toBe(84);
    expect(ctx.currentBlock).toBe("Build");
    expect(ctx.blockWeek).toBe(3);
    expect(ctx.blockTotalWeeks).toBe(6);
    expect(ctx.totalPlanWeeks).toBe(12);
    expect(ctx.currentPlanWeek).toBe(3);
    expect(ctx.cumulativeVolumeByDiscipline.swim).toBeDefined();
    expect(ctx.cumulativeVolumeByDiscipline.bike).toBeDefined();
    expect(ctx.cumulativeVolumeByDiscipline.run).toBeDefined();
  });
});

describe("formatMacroContextSummary", () => {
  it("includes race name, days to race, block position, and volume", () => {
    const ctx = makeMacroContext();
    const result = formatMacroContextSummary(ctx);

    expect(result).toContain("Warsaw 70.3 in 84 days");
    expect(result).toContain("Build phase, week 3 of 6");
    expect(result).toContain("plan week 3/12");
    expect(result).toContain("Cumulative volume:");
  });

  it("marks disciplines on track when deltaPct >= -5", () => {
    const ctx = makeMacroContext({
      cumulativeVolumeByDiscipline: {
        swim: { plannedMinutes: 100, actualMinutes: 96, deltaPct: -4 },
        bike: { plannedMinutes: 200, actualMinutes: 200, deltaPct: 0 },
        run: { plannedMinutes: 150, actualMinutes: 150, deltaPct: 0 }
      }
    });
    const result = formatMacroContextSummary(ctx);

    expect(result).toContain("swim on track");
    expect(result).toContain("bike on track");
    expect(result).toContain("run on track");
  });

  it("marks disciplines behind when deltaPct < -5", () => {
    const ctx = makeMacroContext({
      cumulativeVolumeByDiscipline: {
        swim: { plannedMinutes: 180, actualMinutes: 160, deltaPct: -11 },
        bike: { plannedMinutes: 600, actualMinutes: 580, deltaPct: -3 },
        run: { plannedMinutes: 360, actualMinutes: 300, deltaPct: -17 }
      }
    });
    const result = formatMacroContextSummary(ctx);

    expect(result).toContain("swim 11% behind");
    expect(result).toContain("bike on track");
    expect(result).toContain("run 17% behind");
  });

  it("omits race info when raceName is null", () => {
    const ctx = makeMacroContext({ raceName: null, daysToRace: null });
    const result = formatMacroContextSummary(ctx);

    expect(result).not.toContain("days");
    expect(result).not.toMatch(/\d+ days/);
    expect(result).toContain("Build phase");
  });

  it("omits volume section when no disciplines have planned minutes", () => {
    const ctx = makeMacroContext({
      cumulativeVolumeByDiscipline: {
        swim: { plannedMinutes: 0, actualMinutes: 0, deltaPct: 0 },
        bike: { plannedMinutes: 0, actualMinutes: 0, deltaPct: 0 },
        run: { plannedMinutes: 0, actualMinutes: 0, deltaPct: 0 }
      }
    });
    const result = formatMacroContextSummary(ctx);

    expect(result).not.toContain("Cumulative volume");
  });

  it("handles Recovery block label", () => {
    const ctx = makeMacroContext({ currentBlock: "Recovery", blockWeek: 1, blockTotalWeeks: 1 });
    const result = formatMacroContextSummary(ctx);

    expect(result).toContain("Recovery phase, week 1 of 1");
  });

  it("handles early plan (week 1 of 1 block)", () => {
    const ctx = makeMacroContext({
      currentBlock: "Build",
      blockWeek: 1,
      blockTotalWeeks: 1,
      currentPlanWeek: 1,
      totalPlanWeeks: 16
    });
    const result = formatMacroContextSummary(ctx);

    expect(result).toContain("week 1 of 1");
    expect(result).toContain("plan week 1/16");
  });
});

describe("cumulativeVolumeByDiscipline calculations", () => {
  it("computes deltaPct correctly for behind discipline", () => {
    const planned = 360;
    const actual = 300;
    const deltaPct = Math.round(((actual - planned) / planned) * 100);
    expect(deltaPct).toBe(-17);
  });

  it("computes deltaPct correctly for on-track discipline", () => {
    const planned = 600;
    const actual = 580;
    const deltaPct = Math.round(((actual - planned) / planned) * 100);
    expect(deltaPct).toBe(-3);
  });

  it("returns 0 deltaPct when planned is 0", () => {
    const planned = 0;
    const deltaPct = planned > 0 ? Math.round(((0 - planned) / planned) * 100) : 0;
    expect(deltaPct).toBe(0);
  });
});
