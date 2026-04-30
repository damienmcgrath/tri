import { inferDefaultDiscipline, weekdayIndexFromIso } from "./discipline-defaults";

describe("weekdayIndexFromIso", () => {
  it("returns 0 for Monday", () => {
    // 2026-04-27 is a Monday in UTC.
    expect(weekdayIndexFromIso("2026-04-27")).toBe(0);
  });
  it("returns 6 for Sunday", () => {
    expect(weekdayIndexFromIso("2026-05-03")).toBe(6);
  });
});

describe("inferDefaultDiscipline", () => {
  it("uses the most common discipline observed for that weekday", () => {
    // Tuesdays in this fixture have 2 bike + 1 run.
    const result = inferDefaultDiscipline({
      cellDate: "2026-05-05", // Tuesday
      weekSessions: [
        { date: "2026-04-28", sport: "bike" }, // Tue
        { date: "2026-04-28", sport: "run" }, // Tue (different week, but tuesday)
        { date: "2026-05-05", sport: "bike" }, // Tue
        { date: "2026-04-29", sport: "swim" } // Wed (ignored)
      ],
      lastEditedDiscipline: "swim"
    });
    expect(result).toBe("bike");
  });

  it("falls back to lastEditedDiscipline when the weekday has no history", () => {
    const result = inferDefaultDiscipline({
      cellDate: "2026-05-05", // Tuesday
      weekSessions: [
        { date: "2026-04-29", sport: "swim" }, // Wed
        { date: "2026-05-02", sport: "run" } // Sat
      ],
      lastEditedDiscipline: "bike"
    });
    expect(result).toBe("bike");
  });

  it("falls back to run when there is no history and no last-edited", () => {
    const result = inferDefaultDiscipline({
      cellDate: "2026-05-05",
      weekSessions: [],
      lastEditedDiscipline: null
    });
    expect(result).toBe("run");
  });

  it("ignores sessions with missing date or sport", () => {
    const result = inferDefaultDiscipline({
      cellDate: "2026-05-05", // Tue
      weekSessions: [
        { date: null, sport: "bike" },
        { date: "2026-05-05", sport: null },
        { date: "2026-05-05", sport: "run" }
      ],
      lastEditedDiscipline: null
    });
    expect(result).toBe("run");
  });

  it("breaks ties using canonical discipline order", () => {
    const result = inferDefaultDiscipline({
      cellDate: "2026-05-05",
      weekSessions: [
        { date: "2026-05-05", sport: "run" },
        { date: "2026-05-05", sport: "bike" }
      ],
      lastEditedDiscipline: null
    });
    // bike comes before run in the canonical order.
    expect(result).toBe("bike");
  });
});
