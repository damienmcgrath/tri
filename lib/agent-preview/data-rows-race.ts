// Race-bundle / profile / review / lessons seed rows for the preview database.
// Pulled out of data-scenarios.ts so the umbrella file stays scannable.

import {
  PREVIEW_FUTURE_RACE_PROFILE_ID,
  PREVIEW_RACE_BUNDLE_ID,
  PREVIEW_RACE_LESSONS_ID,
  PREVIEW_RACE_PROFILE_ID,
  PREVIEW_RACE_REVIEW_ID,
  PREVIEW_RACE_SESSION_ID,
  PREVIEW_UPLOAD_ID,
  PREVIEW_USER_ID
} from "./data-types";
import {
  RACE_SEGMENT_DURATIONS_SEC,
  RACE_TOTAL_DURATION_SEC,
  previewDateOffset,
  previewPriorRaceMonday,
  raceSegmentEndIso,
  raceSegmentStartIso
} from "./data-factories";

export function buildRaceRows() {
  return {
    race_bundles: (() => {
      const mon = previewPriorRaceMonday();
      const startedAt = raceSegmentStartIso(mon, "swim");
      const endedAt = raceSegmentEndIso(mon, "run");
      return [
        {
          id: PREVIEW_RACE_BUNDLE_ID,
          user_id: PREVIEW_USER_ID,
          started_at: startedAt,
          ended_at: endedAt,
          total_duration_sec: RACE_TOTAL_DURATION_SEC,
          total_distance_m: 1500 + 213 + 39966 + 160 + 9368,
          source: "strava_reconstructed",
          upload_id: PREVIEW_UPLOAD_ID,
          // Phase 1A: goal anchor + pre-race snapshot + subjective inputs
          race_profile_id: PREVIEW_RACE_PROFILE_ID,
          goal_time_sec: 10800,
          goal_strategy_summary:
            "Negative-split bike, hold 4:15/km on the first 5k, push final 2k if HR caps at 170.",
          course_profile_snapshot: {
            swim_distance_m: 1500,
            bike_distance_km: 40,
            run_distance_km: 10,
            bike_elevation_m: 320,
            course_type: "rolling",
            expected_conditions: "cool"
          },
          conditions_snapshot: {},
          pre_race_ctl: 78.4,
          pre_race_atl: 62.1,
          pre_race_tsb: 16.3,
          pre_race_tsb_state: "fresh",
          pre_race_ramp_rate: 1.4,
          pre_race_snapshot_at: new Date().toISOString(),
          pre_race_snapshot_status: "captured",
          taper_compliance_score: 0.857,
          taper_compliance_summary: "6 of 7 taper sessions on target",
          athlete_rating: 4,
          athlete_notes:
            "Felt strong off the bike, slight nutrition wobble at km 8 of the run but recovered fast.",
          issues_flagged: ["nutrition"],
          finish_position: 18,
          age_group_position: 4,
          subjective_captured_at: new Date().toISOString(),
          status: "reviewed",
          inferred_transitions: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];
    })(),
    race_profiles: (() => {
      // Past race: Joe Hannon Olympic on Sunday of LAST week. Already
      // bundled / reviewed / lessons-generated → it's the carry-forward
      // source for the upcoming race.
      const priorMon = previewPriorRaceMonday();
      // Future race: Galway 70.3 on TODAY's date. Putting it on race_day
      // proximity guarantees the carry-forward surfaces in the morning
      // brief regardless of which weekday the preview is loaded on
      // (carry-forward is only repeated on race_day / day_before).
      const upcomingDate = new Date().toISOString().slice(0, 10);
      return [
        {
          id: PREVIEW_RACE_PROFILE_ID,
          user_id: PREVIEW_USER_ID,
          athlete_id: PREVIEW_USER_ID,
          name: "Joe Hannon Olympic",
          date: previewDateOffset(priorMon, 6),
          distance_type: "olympic",
          priority: "B",
          course_profile: {
            swim_distance_m: 1500,
            bike_distance_km: 40,
            run_distance_km: 10,
            bike_elevation_m: 320,
            course_type: "rolling",
            expected_conditions: "cool"
          },
          ideal_discipline_distribution: { swim: 0.18, bike: 0.55, run: 0.27 },
          goal_time_sec: 10800,
          goal_strategy_summary:
            "Negative-split bike, hold 4:15/km on the first 5k, push final 2k if HR caps at 170.",
          notes: "B-race rehearsal slotted before Galway 70.3.",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          id: PREVIEW_FUTURE_RACE_PROFILE_ID,
          user_id: PREVIEW_USER_ID,
          athlete_id: PREVIEW_USER_ID,
          name: "Galway 70.3",
          date: upcomingDate,
          distance_type: "70.3",
          priority: "A",
          course_profile: {
            swim_distance_m: 1900,
            bike_distance_km: 90,
            run_distance_km: 21.1,
            bike_elevation_m: 720,
            course_type: "rolling",
            expected_conditions: "windy"
          },
          ideal_discipline_distribution: { swim: 0.1, bike: 0.55, run: 0.35 },
          goal_time_sec: 18000,
          goal_strategy_summary:
            "NP 220–225W on the bike, open the run at 4:30/km and hold through 16km, attack final 5km.",
          notes:
            "A-race target. Carry-forward from Joe Hannon Olympic should anchor the bike-pacing cue.",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];
    })(),
    // Pre-populated race review row so iteration on the populated card layout
    // is instant. Set is_provisional: true and delete the row (or run the
    // regenerate button) to exercise the placeholder + manual-regen flow.
    race_reviews: [
      {
        id: PREVIEW_RACE_REVIEW_ID,
        user_id: PREVIEW_USER_ID,
        race_bundle_id: PREVIEW_RACE_BUNDLE_ID,
        planned_session_id: PREVIEW_RACE_SESSION_ID,
        headline: "Even-split Olympic; bike held within 2% across halves.",
        narrative:
          "Held a balanced execution across all five segments. Swim closed strong, transitioning at race-pace HR. Bike pacing was the highlight — 220W → 216W across halves with normalised power 224W and IF 0.91, a controlled effort that left fuel for the run. Run faded modestly in the back half (4:15/km → 4:30/km) as expected for an Olympic effort, with HR drifting to 172. Transitions were quick and clean.",
        coach_take:
          "Repeat this pacing template at Galway 70.3: hold bike to NP 220–225W and run the first 5km at 4:15/km. If HR caps at 170 through 8km, push the final 2km.",
        transition_notes: "T1 2:10, T2 1:39 — both under target. Mount/dismount sequence clean.",
        pacing_notes: {
          swim: { firstHalf: 102, lastHalf: 99, deltaPct: -2.94, unit: "sec_per_100m", note: "Negative split — 1:42 → 1:39 per 100m. Drafting paid off in the back half." },
          bike: { firstHalf: 220, lastHalf: 216, deltaPct: -1.82, unit: "watts", note: "Power held within 2% across halves. Sustainable pacing with NP 224W, IF 0.91." },
          run: { firstHalf: 257, lastHalf: 269, deltaPct: 4.67, unit: "sec_per_km", note: "Modest fade — 4:17 → 4:29 /km. Cadence held at 178." }
        },
        discipline_distribution_actual: {
          swim: Number((RACE_SEGMENT_DURATIONS_SEC.swim / RACE_TOTAL_DURATION_SEC).toFixed(4)),
          t1: Number((RACE_SEGMENT_DURATIONS_SEC.t1 / RACE_TOTAL_DURATION_SEC).toFixed(4)),
          bike: Number((RACE_SEGMENT_DURATIONS_SEC.bike / RACE_TOTAL_DURATION_SEC).toFixed(4)),
          t2: Number((RACE_SEGMENT_DURATIONS_SEC.t2 / RACE_TOTAL_DURATION_SEC).toFixed(4)),
          run: Number((RACE_SEGMENT_DURATIONS_SEC.run / RACE_TOTAL_DURATION_SEC).toFixed(4))
        },
        discipline_distribution_delta: {
          swim: Number((RACE_SEGMENT_DURATIONS_SEC.swim / RACE_TOTAL_DURATION_SEC - 0.18).toFixed(4)),
          bike: Number(((RACE_SEGMENT_DURATIONS_SEC.bike + RACE_SEGMENT_DURATIONS_SEC.t1) / RACE_TOTAL_DURATION_SEC - 0.55).toFixed(4)),
          run: Number(((RACE_SEGMENT_DURATIONS_SEC.run + RACE_SEGMENT_DURATIONS_SEC.t2) / RACE_TOTAL_DURATION_SEC - 0.27).toFixed(4))
        },
        model_used: "gpt-5-mini",
        is_provisional: false,
        generated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // Phase 1B layered output. Verdict + race story shape; deterministic
        // gates already enforced (emotionalFrame=null, crossDisciplineInsight=null
        // for this clean execution).
        verdict: {
          headline: "Finished in 2:31:30 with bike held 220→216W (−1.8%) across halves.",
          perDiscipline: {
            swim: { status: "on_plan", summary: "Closed at 1:39/100m — 3% negative split off a controlled first half." },
            bike: { status: "strong", summary: "Held 220→216W across halves; NP 224W, IF 0.91." },
            run: { status: "faded", summary: "Pace eased 4.7% (4:17 → 4:29 /km) as HR drifted to 172." }
          },
          coachTake: {
            target: "NEXT bike block at 220–225W NP for 30 minutes",
            scope: "next race-pace ride",
            successCriterion: "Halves move less than 2% between first and last; HR caps at 165",
            progression: "If steady, extend to 45 minutes the following week"
          },
          emotionalFrame: null
        },
        race_story: {
          overall:
            "Held a balanced execution across all five segments. Swim came in even with a 3% negative split. Bike was the highlight — 220→216W across halves at NP 224W (IF 0.91), a controlled effort that left fuel for the run. Run eased modestly in the back half (4:17 → 4:29 /km) as HR drifted to 172, an expected pattern for an Olympic effort. Transitions came in quick and clean.",
          perLeg: {
            swim: {
              narrative: "Swim closed at 1:39/100m, transitioning at race-pace HR.",
              keyEvidence: ["1:42 → 1:39 /100m halves", "Drafting paid in the back half"]
            },
            bike: {
              narrative: "Bike held 220→216W across halves with NP 224W, IF 0.91.",
              keyEvidence: ["−1.8% halves drift", "NP 224W", "IF 0.91"]
            },
            run: {
              narrative: "Run eased 4.7% in the second half (4:17 → 4:29 /km) as HR drifted +6bpm.",
              keyEvidence: ["+4.7% halves drift", "HR 166 → 172", "Cadence held at 178"]
            }
          },
          transitions: "T1 2:10, T2 1:39 — both under target.",
          crossDisciplineInsight: null
        },
        leg_status: {
          swim: { label: "on_plan", evidence: ["Halves moved -2.9%."] },
          bike: { label: "strong", evidence: ["Halves moved -1.8% with avg above target."] },
          run: { label: "faded", evidence: ["Second half eased 4.7% vs the first."] }
        },
        emotional_frame: null,
        cross_discipline_insight: null,
        // Phase 1C — per-segment diagnostic packets. The bike packet shows
        // the populated reference frames (vs Plan + vs Threshold + vs Best
        // Comparable Training); the run packet shows decoupling fired since
        // HR drifted at slowing pace; the swim packet has the minimum
        // populated state for visual coverage.
        segment_diagnostics: [
          {
            discipline: "swim",
            referenceFrames: {
              vsPlan: {
                label: "on_plan",
                deltaPct: -1.0,
                summary: "Avg 1:40 /100m vs plan 1:41 /100m (-1.0%)."
              },
              vsThreshold: null,
              vsBestComparableTraining: null,
              vsPriorRace: null
            },
            pacingAnalysis: {
              splitType: "negative",
              driftObservation: null,
              decouplingObservation: null
            },
            anomalies: [],
            aiNarrative:
              "Swim came in just under plan — 1:42 → 1:39 /100m across halves, a clean 3% negative split off a controlled first half."
          },
          {
            discipline: "bike",
            referenceFrames: {
              vsPlan: {
                label: "on_plan",
                deltaPct: 0.4,
                summary: "Bike split 1:14:28 vs plan 1:14:00 (+0.4%)."
              },
              vsThreshold: {
                thresholdValue: 245,
                thresholdUnit: "watts",
                intensityFactor: 0.91,
                summary: "224W avg vs FTP 245W = IF 0.91 — appropriate for olympic-distance race effort."
              },
              vsBestComparableTraining: {
                sessionId: "preview-session-bike-tt",
                sessionDate: "2026-04-12",
                sessionName: "Race-pace 40km TT",
                comparison:
                  "Closest training analogue: Race-pace 40km TT (2026-04-12, 1:15:00). Race leg 1:14:28."
              },
              vsPriorRace: null
            },
            pacingAnalysis: {
              splitType: "even",
              driftObservation: null,
              decouplingObservation: null
            },
            anomalies: [],
            aiNarrative:
              "Bike held the line: 224W avg at IF 0.91 sits squarely in olympic race-effort range, matched the recent race-pace 40km TT, and halves moved less than 2%."
          },
          {
            discipline: "run",
            referenceFrames: {
              vsPlan: {
                label: "under",
                deltaPct: 4.7,
                summary: "Avg 4:23 /km vs plan 4:11 /km (+4.7%)."
              },
              vsThreshold: null,
              vsBestComparableTraining: {
                sessionId: "preview-session-long-run",
                sessionDate: "2026-04-08",
                sessionName: "Long endurance run",
                comparison:
                  "Closest training analogue: Long endurance run (2026-04-08, 1:00:00). Race leg 45:00."
              },
              vsPriorRace: null
            },
            pacingAnalysis: {
              splitType: "positive",
              driftObservation: "Second half eased 4.7% (4:17 → 4:29 /km).",
              decouplingObservation: null
            },
            anomalies: [
              {
                type: "cadence_drop",
                atSec: 1500,
                observation: "Cadence dropped from 178 → 176 spm in the second half — minor form drift."
              }
            ],
            aiNarrative:
              "Run eased 4.7% in the second half (4:17 → 4:29 /km) as HR climbed +6 bpm to 172. Cadence drift was minor (178 → 176 spm)."
          }
        ],
        transitions_analysis: {
          t1: {
            athleteSec: 130,
            populationMedianSec: 150,
            hrAtEnd: 152,
            summary: "T1 2:10 vs typical 2:30 (−0:20), end HR 152 bpm."
          },
          t2: {
            athleteSec: 99,
            populationMedianSec: 90,
            hrAtEnd: 165,
            summary: "T2 1:39 vs typical 1:30 (+0:09), end HR 165 bpm."
          }
        },
        pacing_arc_data: {
          totalDurationSec: RACE_TOTAL_DURATION_SEC,
          points: [
            { tSec: 800, role: "swim", hr: 142, power: null, paceSec: 102 },
            { tSec: 2200, role: "bike", hr: 152, power: 220, paceSec: null },
            { tSec: 4500, role: "bike", hr: 154, power: 218, paceSec: null },
            { tSec: 6000, role: "bike", hr: 154, power: 216, paceSec: null },
            { tSec: 7100, role: "run", hr: 166, power: null, paceSec: 257 },
            { tSec: 7800, role: "run", hr: 172, power: null, paceSec: 269 }
          ],
          transitions: [
            { role: "t1", startSec: RACE_SEGMENT_DURATIONS_SEC.swim, endSec: RACE_SEGMENT_DURATIONS_SEC.swim + RACE_SEGMENT_DURATIONS_SEC.t1, inferred: true },
            { role: "t2", startSec: RACE_SEGMENT_DURATIONS_SEC.swim + RACE_SEGMENT_DURATIONS_SEC.t1 + RACE_SEGMENT_DURATIONS_SEC.bike, endSec: RACE_SEGMENT_DURATIONS_SEC.swim + RACE_SEGMENT_DURATIONS_SEC.t1 + RACE_SEGMENT_DURATIONS_SEC.bike + RACE_SEGMENT_DURATIONS_SEC.t2, inferred: true }
          ],
          legBoundaries: [
            { role: "swim", startSec: 0, endSec: RACE_SEGMENT_DURATIONS_SEC.swim },
            { role: "bike", startSec: RACE_SEGMENT_DURATIONS_SEC.swim + RACE_SEGMENT_DURATIONS_SEC.t1, endSec: RACE_SEGMENT_DURATIONS_SEC.swim + RACE_SEGMENT_DURATIONS_SEC.t1 + RACE_SEGMENT_DURATIONS_SEC.bike },
            { role: "run", startSec: RACE_SEGMENT_DURATIONS_SEC.swim + RACE_SEGMENT_DURATIONS_SEC.t1 + RACE_SEGMENT_DURATIONS_SEC.bike + RACE_SEGMENT_DURATIONS_SEC.t2, endSec: RACE_TOTAL_DURATION_SEC }
          ],
          inferredGaps: true,
          thresholdHrBpm: 168
        },
        tone_violations: [],
        // Phase 3.2 — Training-to-Race Linking artifact. Two matched bike
        // sessions plus a missed-warning brick for the run. Lets the
        // TrainingToRaceLinksCard render against seeded data.
        training_to_race_links: {
          windowWeeks: 8,
          perLeg: {
            swim: [
              {
                sessionId: "77777777-7777-4777-8777-777777777771",
                date: "2026-04-12",
                sessionName: "1500m race-pace pool set",
                durationSec: 1500,
                matchedAxis: "pace",
                matchScore: 0.82,
                metricsV2: { avgPower: null, normalizedPower: null, avgPace: 100, avgHr: 158 },
                narrative:
                  "Race swim pace of 1:39/100m matched “1500m race-pace pool set” (1:40/100m, 2026-04-12)."
              }
            ],
            bike: [
              {
                sessionId: "77777777-7777-4777-8777-777777777772",
                date: "2026-04-05",
                sessionName: "Vrhnika 2hr brick",
                durationSec: 7200,
                matchedAxis: "np",
                matchScore: 0.91,
                metricsV2: { avgPower: 218, normalizedPower: 224, avgPace: null, avgHr: 152 },
                narrative:
                  "Race bike NP of 224W matched “Vrhnika 2hr brick” (224W NP, 2026-04-05)."
              },
              {
                sessionId: "77777777-7777-4777-8777-777777777773",
                date: "2026-03-29",
                sessionName: "FTP intervals 4×8min",
                durationSec: 4200,
                matchedAxis: "hr_at_power",
                matchScore: 0.74,
                metricsV2: { avgPower: 230, normalizedPower: 232, avgPace: null, avgHr: 158 },
                narrative:
                  "Bike HR ran at 154bpm on race day; “FTP intervals 4×8min” held 158bpm at comparable load (2026-03-29)."
              }
            ],
            run: [
              {
                sessionId: "77777777-7777-4777-8777-777777777774",
                date: "2026-04-09",
                sessionName: "10K race-pace tempo",
                durationSec: 2700,
                matchedAxis: "pace",
                matchScore: 0.86,
                metricsV2: { avgPower: null, normalizedPower: null, avgPace: 260, avgHr: 165 },
                narrative:
                  "Race run pace of 4:23/km tracked closely against “10K race-pace tempo” (4:20/km, 2026-04-09)."
              }
            ]
          },
          warningsMissed: [
            {
              sessionId: "77777777-7777-4777-8777-777777777775",
              date: "2026-04-16",
              sessionName: "Brick run off-the-bike",
              observation:
                "Threshold target slipped — pace 8% under target through the back half. Same shape as the race-day fade."
            }
          ],
          aiNarrative:
            "Build had it in you. Bike NP 224W matched your best 2-hour brick; the run pace was close to your tempo session. The April 16 brick warned that race-pace effort was hard to hold off the bike — that's a distribution problem to fix in the next block.",
          source: "ai",
          generatedAt: new Date().toISOString()
        },
        // Phase 3.3 — Pre-race Retrospective artifact. Peak CTL fell 12 days
        // before the race, taper held, key sessions executed cleanly.
        pre_race_retrospective: {
          buildWindowDays: 56,
          ctlTrajectory: {
            sport: "total",
            series: [
              { date: "2026-03-05", ctl: 58, atl: 50, tsb: 8 },
              { date: "2026-03-19", ctl: 65, atl: 60, tsb: 5 },
              { date: "2026-04-02", ctl: 70, atl: 62, tsb: 8 },
              { date: "2026-04-15", ctl: 73, atl: 58, tsb: 15 },
              { date: "2026-04-29", ctl: 70, atl: 35, tsb: 35 }
            ],
            peakCtl: 73,
            peakCtlDate: "2026-04-15",
            targetPeakCtl: null,
            daysFromPeakToRace: 12,
            raceMorningCtl: 70
          },
          taperReadOut: {
            complianceScore: 0.92,
            summary: "Reasonable taper, slight overshoot mid-week."
          },
          keySessionExecutionRate: {
            totalKeySessions: 8,
            completedKeySessions: 7,
            rate: 0.88,
            keySessionsList: [
              {
                sessionId: "77777777-7777-4777-8777-777777777772",
                date: "2026-04-05",
                name: "Vrhnika 2hr brick",
                executed: true,
                executionScore: 1
              },
              {
                sessionId: "77777777-7777-4777-8777-777777777773",
                date: "2026-03-29",
                name: "FTP intervals 4×8min",
                executed: true,
                executionScore: 1
              },
              {
                sessionId: "77777777-7777-4777-8777-777777777775",
                date: "2026-04-16",
                name: "Brick run off-the-bike",
                executed: true,
                executionScore: 0.5
              }
            ]
          },
          verdict: {
            headline: "Build executed cleanly into a clean taper.",
            body:
              "Peak CTL 73 on 2026-04-15, 12 days before race. Taper compliance 92%. Key sessions: 7/8 (88%).",
            actionableAdjustment:
              "Hold the same periodisation shape for the next build cycle."
          },
          source: "ai",
          generatedAt: new Date().toISOString()
        }
      }
    ],
    // Phase 1D — pre-populated lessons row so the LessonsCard renders. The
    // shape mirrors what generateRaceLessons writes; confidence is "low"
    // because this is the only seeded race in preview.
    race_lessons: [
      {
        id: PREVIEW_RACE_LESSONS_ID,
        user_id: PREVIEW_USER_ID,
        race_bundle_id: PREVIEW_RACE_BUNDLE_ID,
        race_review_id: PREVIEW_RACE_REVIEW_ID,
        athlete_profile_takeaways: [
          {
            headline: "You execute Olympic distance with controlled bike pacing",
            body:
              "Bike held 220→216W (−1.8%) across halves at NP 224W (IF 0.91), and the run still faded only 4.7%. The pattern suggests you can hold race-pace bike efforts without cooking the run — at least at this distance.",
            confidence: "low",
            referencesCount: 0
          }
        ],
        training_implications: [
          {
            headline: "Repeat the bike-pacing template at the next race",
            change:
              "Hold 220–225W NP for the bike at the next Olympic-distance race; cap effort at IF 0.92 across halves.",
            priority: "high",
            rationale: "Bike was the strongest leg of this race; repeating the template should hold."
          },
          {
            headline: "Add 1 long run with race-pace finish per week",
            change:
              "Run 60–75 minutes at endurance, finishing the last 15 minutes at 4:15/km — twice a week for 3 weeks.",
            priority: "medium",
            rationale: "Run faded 4.7% in the second half (4:17 → 4:29 /km); race-pace finishes target the fade."
          }
        ],
        carry_forward: {
          headline: "Open the bike at NP 220W, not 230W",
          instruction:
            "Hold first 5km of the bike at NP 220W. Only let power rise after HR settles below 158.",
          successCriterion: "Bike halves move <2% (target NP within 220–225W).",
          expiresAfterRaceId: PREVIEW_RACE_BUNDLE_ID
        },
        references_race_ids: [],
        superseded_by_race_id: null,
        model_used: "gpt-5-mini",
        is_provisional: false,
        generated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]
  };
}
