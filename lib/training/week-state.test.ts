import { buildWeekStateSummary } from "./week-state";

describe("buildWeekStateSummary", () => {
  it("keeps an in-progress week on track when protected work is still on schedule", () => {
    const summary = buildWeekStateSummary({
      todayIso: "2026-03-10",
      sessions: [
        {
          id: "mon-bike",
          date: "2026-03-09",
          title: "Bike endurance",
          sport: "bike",
          durationMinutes: 60,
          storedStatus: "completed",
          isProtected: true,
          isKey: true
        },
        {
          id: "wed-run",
          date: "2026-03-10",
          title: "Easy run",
          sport: "run",
          durationMinutes: 30,
          storedStatus: "planned",
          isFlexible: true
        },
        {
          id: "thu-bike",
          date: "2026-03-11",
          title: "Power bike",
          sport: "bike",
          durationMinutes: 45,
          storedStatus: "planned",
          isProtected: true,
          isKey: true
        },
        {
          id: "sat-long",
          date: "2026-03-14",
          title: "Long bike",
          sport: "bike",
          durationMinutes: 90,
          storedStatus: "planned",
          isProtected: true,
          isKey: true
        }
      ]
    });

    expect(summary.weekRisk).toBe("on_track");
    expect(summary.weekRiskLabel).toBe("On track");
    expect(summary.adaptation).toBeNull();
    expect(summary.counts).toMatchObject({
      completed: 1,
      remaining: 3,
      missed: 0,
      extra: 0,
      skipped: 0
    });
    expect(summary.topIntervention.statusLine).toBe("On track");
  });

  it("raises at-risk adaptation when a protected session is missed", () => {
    const summary = buildWeekStateSummary({
      todayIso: "2026-03-12",
      sessions: [
        {
          id: "wed-power",
          date: "2026-03-11",
          title: "Power bike",
          sport: "bike",
          durationMinutes: 60,
          storedStatus: "planned",
          isProtected: true,
          isKey: true
        },
        {
          id: "sat-long",
          date: "2026-03-14",
          title: "Long bike",
          sport: "bike",
          durationMinutes: 120,
          storedStatus: "planned",
          isProtected: true,
          isKey: true
        }
      ]
    });

    expect(summary.weekRisk).toBe("at_risk");
    expect(summary.adaptation).not.toBeNull();
    expect(summary.adaptation).toMatchObject({
      operation: "move_session",
      primaryLabel: "Review options"
    });
    expect(summary.adaptation?.whatChanged).toMatch(/Power bike missed/i);
    expect(summary.issues[0]).toMatchObject({
      sessionId: "wed-power",
      issueType: "Session missed"
    });
  });

  it("suggests dropping a missed flexible session when a protected session is still ahead", () => {
    const summary = buildWeekStateSummary({
      todayIso: "2026-03-14",
      sessions: [
        {
          id: "mon-bike",
          date: "2026-03-09",
          title: "Bike endurance",
          sport: "bike",
          durationMinutes: 90,
          storedStatus: "completed",
          isProtected: true,
          isKey: true
        },
        {
          id: "wed-swim",
          date: "2026-03-11",
          title: "Aerobic swim",
          sport: "swim",
          durationMinutes: 60,
          storedStatus: "completed"
        },
        {
          id: "fri-run",
          date: "2026-03-13",
          title: "Easy run",
          sport: "run",
          durationMinutes: 30,
          storedStatus: "planned",
          isFlexible: true,
          intentSummary: "Easy aerobic support run"
        },
        {
          id: "sun-bike",
          date: "2026-03-15",
          title: "Long bike",
          sport: "bike",
          durationMinutes: 90,
          storedStatus: "planned",
          isProtected: true,
          isKey: true
        }
      ]
    });

    expect(summary.weekRisk).toBe("watch");
    expect(summary.adaptation).not.toBeNull();
    expect(summary.adaptation).toMatchObject({
      operation: "drop_session",
      primaryLabel: "Apply recommendation"
    });
    expect(summary.adaptation?.recommendation).toMatch(/Drop easy run and keep long bike unchanged/i);
    expect(summary.topIntervention.recommendedAction).toMatch(/Drop easy run/i);
  });
});
