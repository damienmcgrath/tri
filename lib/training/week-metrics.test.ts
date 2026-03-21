import { computeWeekMinuteTotals, computeWeekSessionCounts, getKeySessionsRemaining } from "./week-metrics";

describe("week metrics", () => {
  const sessions = [
    { id: "1", date: "2026-02-23", sport: "run", durationMinutes: 45, status: "completed" as const, isKey: true },
    { id: "2", date: "2026-02-24", sport: "bike", durationMinutes: 60, status: "planned" as const, isKey: true },
    { id: "3", date: "2026-02-25", sport: "swim", durationMinutes: 30, status: "skipped" as const, isKey: false },
    { id: "4", date: "2026-02-26", sport: "bike", durationMinutes: 90, status: "planned" as const, isKey: true }
  ];

  it("computes planned total vs planned remaining counts", () => {
    expect(computeWeekSessionCounts(sessions)).toEqual({
      completedCount: 1,
      skippedCount: 1,
      plannedRemainingCount: 2,
      plannedTotalCount: 4
    });
  });

  it("computes minute totals consistently", () => {
    expect(computeWeekMinuteTotals(sessions)).toEqual({
      plannedMinutes: 225,
      completedMinutes: 45,
      plannedCompletedMinutes: 45,
      extraCompletedMinutes: 0,
      remainingMinutes: 180
    });
  });

  it("adds extra completed work into weekly totals", () => {
    const extras = [
      { id: "extra-1", date: "2026-02-24", sport: "run", durationMinutes: 30 },
      { id: "extra-2", date: "2026-02-25", sport: "bike", durationMinutes: 20 }
    ];

    expect(computeWeekSessionCounts(sessions, extras)).toEqual({
      completedCount: 3,
      skippedCount: 1,
      plannedRemainingCount: 2,
      plannedTotalCount: 4
    });

    expect(computeWeekMinuteTotals(sessions, extras)).toEqual({
      plannedMinutes: 225,
      completedMinutes: 95,
      plannedCompletedMinutes: 45,
      extraCompletedMinutes: 50,
      remainingMinutes: 180
    });
  });

  it("does not reduce remaining minutes by extra session work", () => {
    const allCompletedSessions = [
      { id: "1", date: "2026-02-23", sport: "run", durationMinutes: 45, status: "completed" as const, isKey: false },
      { id: "2", date: "2026-02-24", sport: "bike", durationMinutes: 60, status: "planned" as const, isKey: false }
    ];
    const extras = [
      { id: "extra-1", date: "2026-02-23", sport: "run", durationMinutes: 100 }
    ];

    const result = computeWeekMinuteTotals(allCompletedSessions, extras);
    expect(result.remainingMinutes).toBe(60);
    expect(result.plannedCompletedMinutes).toBe(45);
    expect(result.extraCompletedMinutes).toBe(100);
    expect(result.completedMinutes).toBe(145);
  });

  it("returns key sessions remaining in chronological order", () => {
    expect(getKeySessionsRemaining(sessions, "2026-02-24").map((s) => s.id)).toEqual(["2", "4"]);
  });
});
