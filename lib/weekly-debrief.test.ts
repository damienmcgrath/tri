import {
  buildWeeklyDebriefFacts,
  classifyWeeklyDebriefWeekShape,
  computeWeeklyDebriefReadiness,
  isWeeklyDebriefStale
} from "./weekly-debrief";

describe("weekly debrief helpers", () => {
  test("unlocks when the week is effectively complete before sunday", () => {
    const readiness = computeWeeklyDebriefReadiness({
      todayIso: "2026-03-13",
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      plannedMinutes: 400,
      resolvedMinutes: 300,
      totalKeySessions: 2,
      resolvedKeySessions: 2
    });

    expect(readiness.isReady).toBe(true);
    expect(readiness.unlockedBy).toBe("effective_completion");
  });

  test("stays locked when a key session is still unresolved", () => {
    const readiness = computeWeeklyDebriefReadiness({
      todayIso: "2026-03-13",
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      plannedMinutes: 400,
      resolvedMinutes: 320,
      totalKeySessions: 2,
      resolvedKeySessions: 1
    });

    expect(readiness.isReady).toBe(false);
    expect(readiness.reason).toMatch(/remaining key session/i);
  });

  test("classifies messy weeks as disrupted even when reflections are sparse", () => {
    expect(
      classifyWeeklyDebriefWeekShape({
        plannedSessions: 7,
        completedSessions: 3,
        skippedSessions: 3,
        reflectionsSparse: true,
        completionPct: 52
      })
    ).toBe("disrupted");
  });

  test("marks otherwise clean sparse weeks as partial reflection", () => {
    expect(
      classifyWeeklyDebriefWeekShape({
        plannedSessions: 6,
        completedSessions: 5,
        skippedSessions: 0,
        reflectionsSparse: true,
        completionPct: 84
      })
    ).toBe("partial_reflection");
  });

  test("detects stale persisted artifacts when source timestamps move forward", () => {
    expect(
      isWeeklyDebriefStale({
        persisted: {
          generated_at: "2026-03-15T08:00:00.000Z",
          source_updated_at: "2026-03-15T08:00:00.000Z",
          status: "ready",
          generation_version: 2
        },
        sourceUpdatedAt: "2026-03-15T09:00:00.000Z"
      })
    ).toBe(true);
  });

  test("builds a factual debrief for a disrupted week with evidence links", () => {
    const result = buildWeeklyDebriefFacts({
      sessions: [
        {
          id: "session-1",
          date: "2026-03-09",
          sport: "run",
          type: "Long Run",
          session_name: "Long Run",
          notes: null,
          status: "completed",
          duration_minutes: 90,
          updated_at: "2026-03-09T10:00:00.000Z",
          created_at: "2026-03-08T10:00:00.000Z",
          execution_result: {
            version: 2,
            linkedActivityId: "activity-1",
            deterministic: {
              sessionId: "session-1",
              athleteId: "athlete-1",
              sport: "run",
              planned: {
                title: "Long Run",
                intentCategory: "aerobic",
                durationSec: 5400,
                targetBands: null,
                plannedIntervals: null,
                sessionRole: "key"
              },
              actual: {
                durationSec: 5100,
                avgHr: 145,
                avgPower: null,
                avgPaceSPerKm: 300,
                timeAboveTargetPct: 0.04,
                intervalCompletionPct: null,
                variabilityIndex: null,
                splitMetrics: null
              },
              detectedIssues: [],
              missingEvidence: [],
              rulesSummary: {
                intentMatch: "on_target",
                executionScore: 88,
                executionScoreBand: "On target",
                confidence: "high",
                provisional: false,
                evidenceCount: 3,
                executionCost: "low"
              }
            },
            verdict: {
              sessionVerdict: {
                headline: "Intent landed",
                summary: "The intended training purpose appears to have landed with controlled execution.",
                intentMatch: "on_target",
                executionCost: "low",
                confidence: "high",
                nextCall: "move_on"
              },
              explanation: {
                whatHappened: "Execution stayed close to the planned session targets.",
                whyItMatters: "Matching the planned intent protects the adaptation you wanted from the day and supports the rest of the week.",
                whatToDoNextTime: "Repeat the same pacing and control on the next similar session.",
                whatToDoThisWeek: "Move into the rest of the week as planned."
              },
              uncertainty: {
                label: "confident_read",
                detail: "This read is grounded in enough execution evidence to be used with confidence.",
                missingEvidence: []
              },
              citedEvidence: [
                {
                  claim: "The session mostly matched the planned intent.",
                  support: ["average HR 145 bpm"]
                }
              ]
            },
            weeklyImpact: {
              suggestedWeekAction: "Move into the rest of the week as planned.",
              suggestedNextCall: "move_on"
            },
            createdAt: "2026-03-09T10:00:00.000Z",
            updatedAt: "2026-03-09T10:00:00.000Z",
            status: "matched_intent",
            intentMatchStatus: "matched_intent",
            executionScore: 88,
            executionScoreBand: "On target",
            executionScoreSummary: "The intended training purpose appears to have landed with controlled execution.",
            executionSummary: "Execution stayed close to the planned session targets.",
            summary: "The intended training purpose appears to have landed with controlled execution.",
            whyItMatters: "Matching the planned intent protects the adaptation you wanted from the day and supports the rest of the week.",
            recommendedNextAction: "Repeat the same pacing and control on the next similar session.",
            diagnosisConfidence: "high",
            executionScoreProvisional: false,
            suggestedWeekAdjustment: "Move into the rest of the week as planned.",
            evidence: ["average HR 145 bpm"],
            durationCompletion: 0.94,
            intervalCompletionPct: null,
            timeAboveTargetPct: 0.04,
            avgHr: 145,
            avgPower: null,
            firstHalfAvgHr: null,
            lastHalfAvgHr: null,
            firstHalfPaceSPerKm: null,
            lastHalfPaceSPerKm: null,
            executionCost: "low",
            missingEvidence: []
          },
          is_key: true
        },
        {
          id: "session-2",
          date: "2026-03-11",
          sport: "bike",
          type: "Threshold",
          session_name: "Threshold Ride",
          notes: "[skipped 2026-03-11]",
          status: "planned",
          duration_minutes: 60,
          updated_at: "2026-03-11T12:00:00.000Z",
          created_at: "2026-03-08T10:00:00.000Z",
          execution_result: null,
          is_key: true
        },
        {
          id: "session-3",
          date: "2026-03-13",
          sport: "swim",
          type: "Endurance Swim",
          session_name: "Endurance Swim",
          notes: "[skipped 2026-03-13]",
          status: "planned",
          duration_minutes: 45,
          updated_at: "2026-03-13T12:00:00.000Z",
          created_at: "2026-03-08T10:00:00.000Z",
          execution_result: null,
          is_key: false
        }
      ],
      activities: [
        {
          id: "activity-extra",
          upload_id: "upload-2",
          sport_type: "strength",
          start_time_utc: "2026-03-12T18:00:00.000Z",
          duration_sec: 1800,
          distance_m: null,
          avg_hr: null,
          avg_power: null,
          schedule_status: "unscheduled",
          is_unplanned: true,
          created_at: "2026-03-12T18:30:00.000Z"
        }
      ],
      links: [
        {
          completed_activity_id: "activity-1",
          planned_session_id: "session-1",
          confirmation_status: "confirmed",
          created_at: "2026-03-09T10:05:00.000Z"
        }
      ],
      athleteContext: {
        identity: {
          athleteId: "athlete-1",
          displayName: "Damien"
        },
        goals: {
          priorityEventName: "Spring 70.3",
          priorityEventDate: "2026-06-01",
          goalType: "perform"
        },
        declared: {
          experienceLevel: {
            value: "intermediate",
            source: "athlete_declared",
            updatedAt: "2026-03-01T00:00:00.000Z"
          },
          limiters: [],
          strongestDisciplines: ["bike"],
          weakestDisciplines: ["run"],
          weeklyConstraints: [],
          injuryNotes: null,
          coachingPreference: "balanced"
        },
        derived: {
          activePlanId: "plan-1",
          phase: "build",
          daysToRace: 79,
          upcomingKeySessions: []
        },
        observed: {
          recurringPatterns: []
        },
        weeklyState: {
          fatigue: 3,
          sleepQuality: 4,
          soreness: 2,
          stress: 2,
          confidence: 4,
          note: null,
          updatedAt: "2026-03-13T09:00:00.000Z"
        }
      },
      timeZone: "UTC",
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      todayIso: "2026-03-15"
    });

    expect(result.facts.weekShape).toBe("disrupted");
    expect(result.facts.title).toMatch(/Disrupted week/i);
    expect(result.evidence.some((item) => item.href === "/sessions/session-1")).toBe(true);
    expect(result.deterministicNarrative.observations.length).toBeGreaterThan(0);
  });
});
