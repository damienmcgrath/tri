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

  it("keeps suggested links visible as unmatched uploads until they are confirmed", () => {
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
          id: "a-suggested",
          upload_id: "upload-1",
          sport_type: "run",
          start_time_utc: "2026-03-02T12:00:00.000Z",
          duration_sec: 2700,
          distance_m: 10000,
          avg_hr: 150,
          avg_power: null
        }
      ],
      links: [{ planned_session_id: "s1", completed_activity_id: "a-suggested", confirmation_status: "suggested" }],
      legacyCompleted: [],
      timeZone: "UTC",
      weekStart: "2026-03-02",
      weekEndExclusive: "2026-03-09"
    });

    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id === "s1")).toMatchObject({
      id: "s1",
      status: "planned",
      linkedActivityCount: 0
    });
    expect(items.find((item) => item.id === "activity:a-suggested")).toMatchObject({
      id: "activity:a-suggested",
      status: "unmatched_upload",
      displayType: "completed_activity"
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
      isUnplanned: false,
      displayType: "completed_activity"
    });
  });

  it("preserves stored extra activities so they no longer surface as unmatched uploads", () => {
    const items = buildCalendarDisplayItems({
      sessions: [],
      activities: [
        {
          id: "a-extra",
          upload_id: "upload-extra",
          sport_type: "run",
          start_time_utc: "2026-03-04T08:00:00.000Z",
          duration_sec: 2400,
          distance_m: 6000,
          avg_hr: 148,
          avg_power: null,
          schedule_status: "unscheduled",
          is_unplanned: true
        }
      ],
      links: [],
      legacyCompleted: [],
      timeZone: "UTC",
      weekStart: "2026-03-02",
      weekEndExclusive: "2026-03-09"
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "activity:a-extra",
      isUnplanned: true,
      displayType: "completed_activity"
    });
  });

  it("treats matched upload status without a confirmed link as extra", () => {
    const items = buildCalendarDisplayItems({
      sessions: [],
      activities: [
        {
          id: "a-upload-matched",
          upload_id: "upload-matched",
          upload_status: "matched",
          sport_type: "run",
          start_time_utc: "2026-03-04T08:00:00.000Z",
          duration_sec: 2400,
          distance_m: 6000,
          avg_hr: 148,
          avg_power: null
        }
      ],
      links: [],
      legacyCompleted: [],
      timeZone: "UTC",
      weekStart: "2026-03-02",
      weekEndExclusive: "2026-03-09"
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "activity:a-upload-matched",
      isUnplanned: true,
      displayType: "completed_activity"
    });
  });

  it("treats rejected links as extra even when is_unplanned is unavailable", () => {
    const items = buildCalendarDisplayItems({
      sessions: [
        {
          id: "s-rejected",
          date: "2026-03-04",
          sport: "run",
          type: "Easy",
          duration_minutes: 40,
          notes: null,
          created_at: "2026-03-01T00:00:00.000Z"
        }
      ],
      activities: [
        {
          id: "a-noted-extra",
          upload_id: "upload-noted-extra",
          sport_type: "run",
          start_time_utc: "2026-03-04T08:00:00.000Z",
          duration_sec: 2400,
          distance_m: 6000,
          avg_hr: 148,
          avg_power: null
        }
      ],
      links: [{ planned_session_id: "s-rejected", completed_activity_id: "a-noted-extra", confirmation_status: "rejected" }],
      legacyCompleted: [],
      timeZone: "UTC",
      weekStart: "2026-03-02",
      weekEndExclusive: "2026-03-09"
    });

    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id === "s-rejected")).toMatchObject({
      id: "s-rejected",
      status: "planned",
      linkedActivityCount: 0
    });
    expect(items.find((item) => item.id === "activity:a-noted-extra")).toMatchObject({
      id: "activity:a-noted-extra",
      isUnplanned: true,
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
