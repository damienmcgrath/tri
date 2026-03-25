import { sortAthleteFtpHistory } from "./athlete-ftp";

describe("sortAthleteFtpHistory", () => {
  test("keeps the newest recorded FTP first even when a backdated entry is added later", () => {
    const ordered = sortAthleteFtpHistory([
      {
        id: "current",
        value: 265,
        source: "manual",
        notes: null,
        recorded_at: "2026-03-20",
        created_at: "2026-03-20T08:00:00.000Z"
      },
      {
        id: "backfill",
        value: 250,
        source: "manual",
        notes: null,
        recorded_at: "2026-03-01",
        created_at: "2026-03-25T09:00:00.000Z"
      }
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual(["current", "backfill"]);
  });

  test("breaks same-day ties by creation time so the latest update becomes current", () => {
    const ordered = sortAthleteFtpHistory([
      {
        id: "morning",
        value: 260,
        source: "manual",
        notes: null,
        recorded_at: "2026-03-25",
        created_at: "2026-03-25T08:00:00.000Z"
      },
      {
        id: "evening",
        value: 268,
        source: "manual",
        notes: null,
        recorded_at: "2026-03-25",
        created_at: "2026-03-25T18:00:00.000Z"
      }
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual(["evening", "morning"]);
  });
});
