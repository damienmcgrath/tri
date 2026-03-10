import { buildCalendarDisplayItems } from "./day-items";

describe("buildCalendarDisplayItems", () => {
  it("marks a planned session completed when a linked activity exists", () => {
    const items = buildCalendarDisplayItems({
      sessions: [
        {
          id: "s1",
          date: "2026-03-02",
          sport: "run",
          type: "Tempo",
          duration_minutes: 45,
          notes: null,
          created_at: "2026-02-28T00:00:00.000Z"
        }
      ],
      activities: [
        {
          id: "a1",
          upload_id: null,
          sport_type: "run",
          start_time_utc: "2026-03-02T12:00:00.000Z",
          duration_sec: 2700,
          distance_m: 10000,
          avg_hr: 150,
          avg_power: null
        }
      ],
      links: [{ planned_session_id: "s1", completed_activity_id: "a1" }],
      legacyCompleted: [],
      timeZone: "UTC",
      weekStart: "2026-03-02",
      weekEndExclusive: "2026-03-09"
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "s1",
      status: "completed",
      displayType: "planned_session",
      linkedActivityCount: 1
    });
  });

  it("includes unlinked completed activity with completed_activity discriminator", () => {
    const items = buildCalendarDisplayItems({
      sessions: [],
      activities: [
        {
          id: "a2",
          upload_id: null,
          sport_type: "bike",
          start_time_utc: "2026-03-03T08:00:00.000Z",
          duration_sec: 3600,
          distance_m: 30000,
          avg_hr: 140,
          avg_power: 220
        }
      ],
      links: [{ planned_session_id: null, completed_activity_id: "a2" }],
      legacyCompleted: [],
      timeZone: "UTC",
      weekStart: "2026-03-02",
      weekEndExclusive: "2026-03-09"
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "activity:a2",
      date: "2026-03-03",
      status: "unmatched_upload",
      displayType: "completed_activity"
    });
  });

  it("returns mixed day view with timezone-aware unlinked activity grouping", () => {
    const items = buildCalendarDisplayItems({
      sessions: [
        {
          id: "s3",
          date: "2026-03-02",
          sport: "swim",
          type: "Endurance",
          duration_minutes: 50,
          notes: null,
          created_at: "2026-03-01T10:00:00.000Z"
        }
      ],
      activities: [
        {
          id: "a3",
          upload_id: null,
          sport_type: "run",
          start_time_utc: "2026-03-03T04:30:00.000Z",
          duration_sec: 1800,
          distance_m: 5000,
          avg_hr: null,
          avg_power: null
        }
      ],
      links: [],
      legacyCompleted: [],
      timeZone: "America/Los_Angeles",
      weekStart: "2026-03-02",
      weekEndExclusive: "2026-03-09"
    });

    expect(items.map((item) => ({ id: item.id, date: item.date, displayType: item.displayType }))).toEqual([
      { id: "s3", date: "2026-03-02", displayType: "planned_session" },
      { id: "activity:a3", date: "2026-03-02", displayType: "completed_activity" }
    ]);
  });
});
