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
      remainingMinutes: 180
    });
  });

  it("adds extra completed work into counts and minutes", () => {
    expect(computeWeekSessionCounts(sessions, { completedCount: 2 })).toEqual({
      completedCount: 3,
      skippedCount: 1,
      plannedRemainingCount: 2,
      plannedTotalCount: 6
    });

    expect(computeWeekMinuteTotals(sessions, { completedMinutes: 50 })).toEqual({
      plannedMinutes: 225,
      completedMinutes: 95,
      remainingMinutes: 130
    });
  });

  it("returns key sessions remaining in chronological order", () => {
    expect(getKeySessionsRemaining(sessions, "2026-02-24").map((s) => s.id)).toEqual(["2", "4"]);
  });
});
