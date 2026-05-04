// Athlete-signal seed rows for the preview database — checkins, observed
// patterns, weekly debriefs, session feels/verdicts, scores, comparisons,
// session_load, etc. Pulled out of data-scenarios.ts so the umbrella file
// stays scannable.

import {
  PREVIEW_ACTIVITY_EXTRA_RUN_ID,
  PREVIEW_ACTIVITY_LONG_RUN_ID,
  PREVIEW_ACTIVITY_ONE_ID,
  PREVIEW_ACTIVITY_SWIM_ID,
  PREVIEW_ACTIVITY_TWO_ID,
  PREVIEW_USER_ID
} from "./data-types";
import {
  previewDateOffset,
  previewMonday
} from "./data-factories";

export function buildAthleteRows() {
  return {
    athlete_context: [
      {
        athlete_id: PREVIEW_USER_ID,
        experience_level: "intermediate",
        goal_type: "perform",
        priority_event_name: "Galway 70.3",
        priority_event_date: "2026-06-21",
        limiters: ["Late-run durability"],
        strongest_disciplines: ["Bike"],
        weakest_disciplines: ["Swim"],
        weekly_constraints: ["Tuesday and Thursday need <90 minute sessions"],
        injury_notes: "Monitor calf tightness after long runs.",
        coaching_preference: "balanced",
        updated_at: "2026-03-14T18:00:00.000Z"
      }
    ],
    athlete_checkins: [
      {
        athlete_id: PREVIEW_USER_ID,
        week_start: "2026-03-09",
        fatigue: 3,
        sleep_quality: 4,
        soreness: 2,
        stress: 3,
        confidence: 4,
        note: "Travel made Thursday messy, but overall I feel good.",
        updated_at: "2026-03-14T20:00:00.000Z"
      }
    ],
    athlete_observed_patterns: [
      {
        athlete_id: PREVIEW_USER_ID,
        pattern_key: "late_threshold_fade",
        label: "Threshold fade late in sessions",
        detail: "Bike threshold quality drops in the last third when the opening rep is too ambitious.",
        confidence: "medium",
        source_session_ids: ["77777777-7777-4777-8777-777777777772"],
        support_count: 2
      },
      {
        athlete_id: PREVIEW_USER_ID,
        pattern_key: "easy_runs_controlled",
        label: "Easy run control is strong",
        detail: "Easy runs are consistently staying aerobic and protecting recovery.",
        confidence: "high",
        source_session_ids: ["77777777-7777-4777-8777-777777777773"],
        support_count: 3
      }
    ],
    weekly_debriefs: [
      {
        athlete_id: PREVIEW_USER_ID,
        week_start: "2026-03-09",
        week_end: "2026-03-15",
        status: "ready",
        source_updated_at: "2026-03-15T09:00:00.000Z",
        generated_at: "2026-03-15T10:00:00.000Z",
        generation_version: 6,
        helpful: null,
        accurate: null,
        feedback_note: null,
        feedback_updated_at: null,
        narrative: {
          executiveSummary: "A disrupted build week where the bookends held. The CSS swim and long run both delivered what was needed — mid-week brick work fell through but did not undo the quality work either side of it. Bike power showed the familiar late-rep fade pattern again, worth watching as load increases.",
          highlights: [
            "CSS intervals executed cleanly — pace control held through all 12 reps with no fade in the final set.",
            "Long run on Sunday landed well: 21km aerobic with the last 3km drifting to steady as planned.",
            "FTP Build bike: first two reps matched target power — the quality stimulus arrived even without the third."
          ],
          observations: [
            "Brick run and race prep brick lost to mid-week schedule compression — cumulative bike-run transition work is now behind for the block.",
            "Bike power fades in the final rep of threshold work; this is the second consecutive week with this pattern."
          ],
          carryForward: [
            "Protect the brick slot next week — even a shortened 20-minute transition run off the bike will rebuild the missing stimulus without requiring a full make-up session.",
            "In the next FTP Build, start 5 watts lower to hold form through all three reps rather than letting the last one fade."
          ],
          nonObviousInsight: "Bike power has faded in the final rep of threshold work two weeks running — the pattern is emerging against a steady CTL climb, which points at durability catching up with the intensity ceiling rather than a top-end issue.",
          teach: "When final-rep fade repeats at stable power but climbing HR, the aerobic system is losing efficiency late — the fix is more sub-threshold volume, not harder intervals."
        },
        coach_share: {
          headline: "Bookend quality held despite mid-week disruption",
          summary: "CSS swim and long run both delivered. Brick stack lost mid-week but core quality arrived either side of the gap.",
          wins: [
            "CSS swim held pace through all 12 reps",
            "Long run 21km steady and on target",
            "FTP bike quality in first two reps"
          ],
          concerns: [
            "Brick stack missed — bike-run transitions behind for the block",
            "Bike threshold fade becoming a recurring pattern"
          ],
          carryForward: [
            "Protect the brick slot next week — even a shortened 20-minute transition run off the bike will rebuild the missing stimulus.",
            "Start FTP Build 5 watts lower to hold form through all three reps rather than fading the last one."
          ]
        },
        facts: {
          weekLabel: "Week of Mar 9",
          weekRange: "Mar 9 – Mar 15",
          title: "Key sessions held, mid-week brick stack lost",
          statusLine: "CSS swim and long run delivered — brick work fell through. Net effect: run and swim quality intact, transition work behind.",
          primaryTakeawayTitle: "Quality at the bookends, gap in the middle",
          primaryTakeawayDetail: "The two highest-value sessions landed cleanly. The lost brick stack is the main thing to carry forward — one week behind on bike-run transitions is recoverable if protected next week.",
          plannedSessions: 7,
          completedPlannedSessions: 4,
          completedSessions: 5,
          addedSessions: 1,
          skippedSessions: 3,
          remainingSessions: 0,
          keySessionsCompleted: 3,
          keySessionsMissed: 2,
          keySessionsTotal: 5,
          plannedMinutes: 500,
          completedPlannedMinutes: 265,
          completedMinutes: 297,
          skippedMinutes: 235,
          extraMinutes: 32,
          completionPct: 59,
          dominantSport: "run",
          keySessionStatus: "3 of 5 key sessions completed",
          weekShape: "disrupted",
          reflectionsSparse: false,
          narrativeSource: "ai",
          artifactStateLabel: "final",
          artifactStateNote: null,
          provisionalReviewCount: 0,
          confidenceNote: null,
          metrics: [
            { label: "Sessions completed", value: "5 / 7", detail: "3 key sessions on target", tone: "neutral" },
            { label: "Key sessions", value: "3 / 5", detail: "Brick stack lost mid-week", tone: "caution" },
            { label: "Training time", value: "4h 57m", detail: "vs 8h 20m planned", tone: "muted" }
          ],
          factualBullets: [
            "CSS swim: 12 x 100m executed with strong pace control — no fade through the final set.",
            "FTP Build bike: first two reps on target, third rep faded in the final minutes.",
            "Long run: 21km with last 3km drifting to steady — matched intent cleanly.",
            "Race Prep Brick and Brick Run skipped due to mid-week schedule compression."
          ],
          evidenceGroups: [
            {
              claim: "CSS swim and long run delivered the week's quality",
              detail: "Both bookend sessions matched intent — swim pace held through the final reps, long run stayed aerobic with a controlled finish.",
              supports: [
                {
                  id: "77777777-7777-4777-8777-777777777771",
                  label: "CSS Intervals — Sun Mar 9",
                  href: "/sessions/77777777-7777-4777-8777-777777777771",
                  kind: "session",
                  reason: "Execution score 91 — pace control held cleanly through all 12 reps."
                },
                {
                  id: "77777777-7777-4777-8777-777777777777",
                  label: "Long Run — Sun Mar 15",
                  href: "/sessions/77777777-7777-4777-8777-777777777777",
                  kind: "session",
                  reason: "21km aerobic with last 3km steady as planned — execution score 86."
                }
              ]
            },
            {
              claim: "Bike threshold quality shows a recurring late-rep fade",
              detail: "FTP Build had the same fade pattern as last week — first two reps on target, third fades.",
              supports: [
                {
                  id: "77777777-7777-4777-8777-777777777772",
                  label: "FTP Build — Mon Mar 10",
                  href: "/sessions/77777777-7777-4777-8777-777777777772",
                  kind: "session",
                  reason: "Execution score 74 — power held for 2 of 3 reps, third faded in the final minutes."
                }
              ]
            }
          ]
        }
      }
      ,{
        athlete_id: PREVIEW_USER_ID,
        week_start: "2026-03-16",
        week_end: "2026-03-22",
        status: "ready",
        source_updated_at: "2026-03-22T09:00:00.000Z",
        generated_at: "2026-03-22T10:00:00.000Z",
        generation_version: 6,
        helpful: null,
        accurate: null,
        feedback_note: null,
        feedback_updated_at: null,
        narrative: {
          executiveSummary: "A shortened week with one solid swim session and a useful extra run. The strength upload still needs assigning — once placed, the week reads as a light but intentional recovery-style block. Not enough volume to call it a proper build week, but the sessions that landed were clean.",
          highlights: [
            "Pull Endurance swim: 55 minutes of steady work with good stroke consistency throughout.",
            "Extra run added useful aerobic volume without disrupting recovery.",
            "Strength session logged — once assigned it will round out the week's cross-training picture."
          ],
          observations: [
            "Only 2 of 3 planned sessions completed — the unassigned strength upload may close that gap once reviewed.",
            "Low overall volume for a build phase — worth watching if this becomes a pattern."
          ],
          carryForward: [
            "Assign the strength upload so the week's picture is complete before moving on.",
            "Next week should aim for full session count to keep the build block on track."
          ]
        },
        coach_share: {
          headline: "Light week — swim held, strength pending review",
          summary: "Pull Endurance swim was solid. Strength upload needs assigning. Extra run added useful volume.",
          wins: [
            "Pull Endurance swim: 55 min steady",
            "Extra run added aerobic volume"
          ],
          concerns: [
            "Only 2 of 3 planned sessions done",
            "Low volume for a build week"
          ],
          carryForward: [
            "Assign the pending strength upload.",
            "Aim for full session count next week."
          ]
        },
        facts: {
          weekLabel: "Week of Mar 16",
          weekRange: "Mar 16 – Mar 22",
          title: "Light week with clean swim, strength pending",
          statusLine: "Pull Endurance swim landed well. Extra run added volume. Strength upload still needs review.",
          primaryTakeawayTitle: "Swim quality held in a light week",
          primaryTakeawayDetail: "The swim session was the anchor — clean and on target. The missing volume is the main thing to address next week.",
          plannedSessions: 3,
          completedPlannedSessions: 1,
          completedSessions: 2,
          addedSessions: 1,
          skippedSessions: 0,
          remainingSessions: 2,
          keySessionsCompleted: 1,
          keySessionsMissed: 0,
          keySessionsTotal: 1,
          plannedMinutes: 170,
          completedPlannedMinutes: 55,
          completedMinutes: 90,
          skippedMinutes: 0,
          extraMinutes: 35,
          completionPct: 53,
          dominantSport: "swim",
          keySessionStatus: "1 of 1 key sessions completed",
          weekShape: "partial_reflection",
          reflectionsSparse: false,
          narrativeSource: "ai",
          artifactStateLabel: "final",
          artifactStateNote: null,
          provisionalReviewCount: 0,
          confidenceNote: null,
          metrics: [
            { label: "Sessions completed", value: "2 / 3", detail: "1 extra run added", tone: "neutral" },
            { label: "Key sessions", value: "1 / 1", detail: "Pull Endurance swim on target", tone: "positive" },
            { label: "Training time", value: "1h 30m", detail: "vs 2h 50m planned", tone: "muted" }
          ],
          factualBullets: [
            "Pull Endurance swim: 55 minutes of steady-state work with consistent stroke rate.",
            "Extra run: 35 minutes easy aerobic — added useful volume without disrupting recovery.",
            "Strength upload (40 min) logged but not yet assigned to a planned session."
          ],
          evidenceGroups: [
            {
              claim: "Swim session anchored the week",
              detail: "Pull Endurance was the only planned session completed — it landed cleanly and gave the week its quality signal.",
              supports: [
                {
                  id: "77777777-7777-4777-8777-777777777781",
                  label: "Pull Endurance — Mon Mar 16",
                  href: "/sessions/77777777-7777-4777-8777-777777777781",
                  kind: "session",
                  reason: "55 minutes steady with good stroke consistency."
                }
              ]
            },
            {
              claim: "Extra run kept volume from being too light",
              detail: "The unplanned run added 35 minutes of aerobic work that rounded out an otherwise sparse week.",
              supports: [
                {
                  id: PREVIEW_ACTIVITY_EXTRA_RUN_ID,
                  label: "Extra Run — Tue Mar 17",
                  href: `/sessions/activity/${PREVIEW_ACTIVITY_EXTRA_RUN_ID}`,
                  kind: "activity",
                  reason: "35 minutes easy — added volume without replacing planned work."
                }
              ]
            }
          ]
        }
      }
    ],
    ingestion_events: [],
    session_feels: [
      {
        id: "88888888-8888-4888-8888-888888888881",
        user_id: PREVIEW_USER_ID,
        session_id: "77777777-7777-4777-8777-777777777772",
        rpe: null,
        overall_feel: 4,
        energy_level: "normal",
        legs_feel: "normal",
        motivation: "fired_up",
        sleep_quality: "great",
        life_stress: "normal",
        note: "Felt strong on the bike. Power numbers were solid throughout.",
        was_prompted: true,
        prompt_shown_at: "2026-03-10T08:00:00.000Z",
        completed_at: "2026-03-10T08:00:12.000Z",
        completion_time_ms: 12000,
        dismissed: false,
        created_at: "2026-03-10T08:00:12.000Z"
      },
      {
        id: "88888888-8888-4888-8888-888888888882",
        user_id: PREVIEW_USER_ID,
        session_id: "77777777-7777-4777-8777-777777777777",
        rpe: null,
        overall_feel: 2,
        energy_level: "low",
        legs_feel: "heavy",
        motivation: "struggled",
        sleep_quality: "poor",
        life_stress: "high",
        note: "Legs felt dead from the start. Had to cut the last 3km short.",
        was_prompted: true,
        prompt_shown_at: "2026-03-15T10:00:00.000Z",
        completed_at: "2026-03-15T10:00:08.000Z",
        completion_time_ms: 8000,
        dismissed: false,
        created_at: "2026-03-15T10:00:08.000Z"
      }
    ],
    session_verdicts: [
      {
        id: "99999999-9999-4999-8999-999999999991",
        user_id: PREVIEW_USER_ID,
        session_id: "77777777-7777-4777-8777-777777777772",
        activity_id: PREVIEW_ACTIVITY_ONE_ID,
        purpose_statement: "FTP Build: 3 x 12 min @ 92-95% FTP — targeting sustained power at threshold to develop lactate clearance and muscular endurance for the bike leg.",
        training_block_context: "Week 1 of 3-week build block",
        intended_zones: { power: { min: 230, max: 245 } },
        intended_metrics: { duration_minutes: 75, intervals: 3 },
        execution_summary: "Power held steady at 237W average across all three intervals (target: 230-245W). Heart rate response was proportional, averaging 158bpm with no late drift. Cadence was consistent at 88rpm. The session delivered its intended FTP stimulus cleanly.",
        verdict_status: "achieved",
        metric_comparisons: [
          { metric: "Avg Power", target: "230-245W", actual: "237W", assessment: "on_target" },
          { metric: "Avg HR", target: "155-165 bpm", actual: "158 bpm", assessment: "on_target" },
          { metric: "Duration", target: "75m", actual: "73m (97%)", assessment: "on_target" },
          { metric: "Cadence", target: "85-95 rpm", actual: "88 rpm", assessment: "on_target" }
        ],
        key_deviations: null,
        adaptation_signal: "This confirms your FTP capacity is tracking well. Thursday's tempo ride will proceed as planned at the same intensity targets.",
        adaptation_type: "proceed",
        affected_session_ids: null,
        discipline: "bike",
        feel_data: { overall_feel: 4, energy_level: "normal", motivation: "fired_up" },
        raw_ai_response: {
          non_obvious_insight: "Power held 237 W across all three intervals with HR drift under 2% — your FTP-at-HR has improved 3 bpm vs. the same session four weeks ago at the same load.",
          teach: "Stable HR at matched power across weeks is the clearest fitness signal for FTP work: the aerobic cost of the ceiling is dropping, so the ceiling can move up next block."
        },
        ai_model_used: "preview",
        ai_prompt_version: "v1",
        created_at: "2026-03-10T08:05:00.000Z",
        updated_at: "2026-03-10T08:05:00.000Z"
      },
      {
        id: "99999999-9999-4999-8999-999999999992",
        user_id: PREVIEW_USER_ID,
        session_id: "77777777-7777-4777-8777-777777777777",
        activity_id: PREVIEW_ACTIVITY_LONG_RUN_ID,
        purpose_statement: "Sunday Long Run: 95 min easy with last 20 min at steady — building aerobic durability and progressive fatigue resistance for the run leg.",
        training_block_context: "Week 2 of 3-week build block",
        intended_zones: { hr: { min: 130, max: 148 } },
        intended_metrics: { duration_minutes: 95 },
        execution_summary: "HR averaged 8bpm above expected for the easy portion (146 vs target 130-140), suggesting incomplete recovery from midweek sessions. Pace drift was significant: +12 sec/km over the final 5km. The session partially delivered its aerobic stimulus but at a higher physiological cost than intended.",
        verdict_status: "partial",
        metric_comparisons: [
          { metric: "Avg HR", target: "130-140 bpm", actual: "146 bpm", assessment: "above" },
          { metric: "Duration", target: "95m", actual: "88m (93%)", assessment: "below" },
          { metric: "Pace Drift", target: "< 5 sec/km", actual: "+12 sec/km", assessment: "above" }
        ],
        key_deviations: [
          { metric: "Heart Rate", description: "HR averaged 8bpm above the easy ceiling, indicating higher-than-expected cardiovascular cost.", severity: "moderate" },
          { metric: "Late Fade", description: "Significant pace drift in the final third suggests residual fatigue from the week.", severity: "significant" }
        ],
        adaptation_signal: "Your HR was elevated and pace faded late, suggesting incomplete recovery. I've flagged Tuesday's threshold session for potential intensity reduction to protect the rest of this build block.",
        adaptation_type: "modify",
        affected_session_ids: ["77777777-7777-4777-8777-777777777774"],
        discipline: "run",
        feel_data: { overall_feel: 2, energy_level: "low", legs_feel: "heavy" },
        raw_ai_response: {
          non_obvious_insight: "HR ran 8 bpm hot at easy pace with a 12 s/km fade in the last third — two sleep-under-6h nights preceded this run, which explains the cardiac drift better than any fitness regression does.",
          teach: "An easy-day HR that sits 5+ bpm above band with late fade points at recovery debt, not aerobic decline — the next easy day should be shortened or moved, not pushed."
        },
        ai_model_used: "preview",
        ai_prompt_version: "v1",
        created_at: "2026-03-15T10:05:00.000Z",
        updated_at: "2026-03-15T10:05:00.000Z"
      }
    ],
    adaptation_rationales: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        user_id: PREVIEW_USER_ID,
        trigger_type: "recovery_signal",
        trigger_data: {
          sourceSessionId: "77777777-7777-4777-8777-777777777777",
          sourceSessionName: "Sunday Long Run",
          verdictStatus: "partial",
          verdictSummary: "HR elevated 8bpm above expected, significant pace drift in final third."
        },
        rationale_text: "I'm reducing Tuesday's threshold intensity from Z4 to high Z3 because your long run showed elevated HR and late-stage fade — signs of incomplete recovery. This protects the quality of Thursday's key bike session, which is the priority for this build week.",
        changes_summary: [
          { session_id: "77777777-7777-4777-8777-777777777774", session_label: "Tuesday Threshold Run", change_type: "intensity_reduced", before: "5 x 6 min @ threshold (Z4)", after: "5 x 6 min @ high tempo (Z3)" }
        ],
        preserved_elements: ["Thursday's FTP intervals unchanged — this is the week's key session", "Weekend long ride volume preserved"],
        week_number: 2,
        training_block: "Build",
        affected_sessions: ["77777777-7777-4777-8777-777777777774"],
        source_verdict_id: "99999999-9999-4999-8999-999999999992",
        status: "pending",
        athlete_response: null,
        created_at: "2026-03-15T10:06:00.000Z",
        acknowledged_at: null
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
        user_id: PREVIEW_USER_ID,
        trigger_type: "load_rebalance",
        trigger_data: {
          sourceSessionId: "77777777-7777-4777-8777-777777777775",
          sourceSessionName: "Wednesday Swim",
          verdictStatus: "achieved",
          verdictSummary: "Session executed well but weekly swim volume trending low."
        },
        rationale_text: "I've added 10 minutes to Saturday's swim to rebalance weekly volume. Your Wednesday swim was solid but total swim minutes are 20% below target for this build block. The extra time is easy aerobic pull sets — no intensity change.",
        changes_summary: [
          { session_id: "77777777-7777-4777-8777-777777777776", session_label: "Saturday Endurance Swim", change_type: "duration_increased", before: "45 min", after: "55 min" }
        ],
        preserved_elements: ["Saturday's main set unchanged", "Sunday long ride unaffected"],
        week_number: 2,
        training_block: "Build",
        affected_sessions: ["77777777-7777-4777-8777-777777777776"],
        source_verdict_id: "99999999-9999-4999-8999-999999999993",
        status: "pending",
        athlete_response: null,
        created_at: "2026-03-15T09:30:00.000Z",
        acknowledged_at: null
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac",
        user_id: PREVIEW_USER_ID,
        trigger_type: "feel_based",
        trigger_data: {
          sourceSessionId: "77777777-7777-4777-8777-777777777773",
          sourceSessionName: "Thursday Bike Intervals",
          verdictStatus: "partial",
          verdictSummary: "RPE reported as 9/10 when target was 7/10."
        },
        rationale_text: "Thursday's bike intervals felt harder than planned (RPE 9 vs target 7). I'm swapping Friday's tempo run for an easy recovery jog to give your legs a chance to absorb the bike load before the weekend.",
        changes_summary: [
          { session_id: "77777777-7777-4777-8777-777777777778", session_label: "Friday Tempo Run", change_type: "intensity_reduced", before: "40 min with 20 min @ tempo", after: "30 min easy recovery jog" }
        ],
        preserved_elements: ["Saturday's long ride preserved — key weekend session"],
        week_number: 2,
        training_block: "Build",
        affected_sessions: ["77777777-7777-4777-8777-777777777778"],
        source_verdict_id: "99999999-9999-4999-8999-999999999994",
        status: "pending",
        athlete_response: null,
        created_at: "2026-03-15T08:15:00.000Z",
        acknowledged_at: null
      }
    ],
    morning_briefs: [
      {
        id: "bb000001-0000-4000-8000-000000000001",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        brief_date: "2026-04-04",
        session_preview: "Tempo Run — 45 min with 3 x 8 min at threshold. Key session. Focus on cadence and relaxed shoulders through the final rep.",
        readiness_context: "You completed Tuesday's FTP intervals cleanly (85/100) and Wednesday's easy run stayed controlled. Legs should be fresh enough for quality threshold work today.",
        week_context: "3 of 6 sessions done this week. On track for 5h 30m total volume. Two key sessions remaining (today's tempo run and Sunday's long ride).",
        pending_actions: ["Review Tuesday's adaptation rationale"],
        brief_text: "Good morning. You're midway through Build Week 4 and the quality sessions are landing well. Today's tempo run is the week's second key session — the threshold reps should feel controlled after two days of lighter work. Keep cadence above 170 and stay relaxed through the shoulders in the final rep block. Sunday's long ride closes the week.",
        input_data: null,
        viewed_at: null,
        created_at: "2026-04-04T06:00:00.000Z",
        ai_model_used: "preview",
        ai_prompt_version: "v1"
      }
    ],
    training_scores: [
      {
        id: "cc000001-0000-4000-8000-000000000001",
        user_id: PREVIEW_USER_ID,
        score_date: "2026-04-04",
        composite_score: 72,
        execution_quality: 78,
        execution_inputs: { verdictCount: 4, keyVerdictCount: 2 },
        progression_signal: 65,
        progression_inputs: { comparisonCount: 3, improvingCount: 2 },
        progression_active: true,
        balance_score: 70,
        balance_inputs: {
          actualDistribution: { swim: 0.18, bike: 0.42, run: 0.30, strength: 0.10 },
          idealDistribution: { swim: 0.20, bike: 0.40, run: 0.30, strength: 0.10 }
        },
        goal_race_type: "half_ironman",
        training_block: "Build",
        score_delta_7d: 4,
        score_delta_28d: 8,
        created_at: "2026-04-04T06:00:00.000Z"
      }
    ],
    week_transition_briefings: [
      {
        id: "dd000001-0000-4000-8000-000000000001",
        user_id: PREVIEW_USER_ID,
        athlete_id: PREVIEW_USER_ID,
        current_week_start: "2026-03-30",
        last_week_takeaway: "Recovery week absorbed well — fatigue markers dropped and the light sessions felt controlled. You're coming into this build week with solid freshness.",
        this_week_focus: "Build Week 4 ramps back up with two key sessions: Tuesday's FTP intervals and Saturday's tempo run. The priority is executing the bike intervals cleanly after the recovery week reset.",
        adaptation_context: "No adaptations carried forward from last week. The pending rationale from the long run fade has been addressed by the recovery block.",
        pending_rationale_ids: [],
        coaching_prompt: "Focus on nailing Tuesday's FTP intervals — you should feel fresh coming off recovery. If legs are heavy by Thursday, we can lighten the tempo run to protect Sunday's long ride.",
        viewed_at: null,
        dismissed_at: null,
        created_at: "2026-03-30T06:00:00.000Z",
        ai_model_used: "preview",
        ai_prompt_version: "v1"
      }
    ],
    session_comparisons: [
      {
        id: "ee000001-0000-4000-8000-000000000001",
        user_id: PREVIEW_USER_ID,
        current_session_id: "77777777-7777-4777-8777-77777777778b",
        comparison_session_id: "77777777-7777-4777-8777-777777777772",
        match_score: 0.92,
        match_factors: { discipline: 1.0, type: 1.0, duration: 0.95, intent: 1.0 },
        comparison_summary: "Your FTP intervals show clear improvement compared to 3 weeks ago. Power held steady across all three reps this time (vs late fade previously), and heart rate response was more proportionate. The threshold stimulus landed cleanly — a meaningful step forward in sustained power capacity.",
        metric_deltas: [
          { metric: "Avg Power", currentValue: "237W", previousValue: "228W", direction: "up", magnitude: "moderate" },
          { metric: "Execution Score", currentValue: "85", previousValue: "74", direction: "up", magnitude: "significant" },
          { metric: "Cadence", currentValue: "88 rpm", previousValue: "85 rpm", direction: "up", magnitude: "minor" }
        ],
        trend_direction: "improving",
        trend_confidence: "moderate",
        weeks_apart: 3,
        discipline: "bike",
        session_type: "FTP Build",
        comparison_range: "recent",
        created_at: "2026-03-31T10:00:00.000Z"
      },
      {
        id: "ee000002-0000-4000-8000-000000000002",
        user_id: PREVIEW_USER_ID,
        current_session_id: "77777777-7777-4777-8777-77777777778a",
        comparison_session_id: "77777777-7777-4777-8777-777777777771",
        match_score: 0.88,
        match_factors: { discipline: 1.0, type: 1.0, duration: 0.90, intent: 1.0 },
        comparison_summary: "CSS intervals remain stable. Pacing control improved slightly in the second half, suggesting better fatigue management. Stroke rate consistency is a strength.",
        metric_deltas: [
          { metric: "Avg Pace", currentValue: "1:32/100m", previousValue: "1:33/100m", direction: "up", magnitude: "minor" },
          { metric: "Execution Score", currentValue: "89", previousValue: "91", direction: "down", magnitude: "minor" }
        ],
        trend_direction: "stable",
        trend_confidence: "moderate",
        weeks_apart: 3,
        discipline: "swim",
        session_type: "CSS Intervals",
        comparison_range: "recent",
        created_at: "2026-03-30T10:00:00.000Z"
      }
    ],
    session_intensity_profiles: [],
    weekly_intensity_summaries: [],
    session_load: (() => {
      const mon = previewMonday();
      return [
        {
          id: "ff000001-0000-4000-8000-000000000001",
          user_id: PREVIEW_USER_ID,
          activity_id: PREVIEW_ACTIVITY_SWIM_ID,
          session_id: "77777777-7777-4777-8777-777777777790",
          sport: "swim",
          date: previewDateOffset(mon, 0),
          tss: 48,
          tss_source: "hr",
          duration_sec: 2700,
          intensity_factor: null
        },
        {
          id: "ff000002-0000-4000-8000-000000000002",
          user_id: PREVIEW_USER_ID,
          activity_id: PREVIEW_ACTIVITY_ONE_ID,
          session_id: "77777777-7777-4777-8777-777777777791",
          sport: "bike",
          date: previewDateOffset(mon, 1),
          tss: 82,
          tss_source: "power",
          duration_sec: 4500,
          intensity_factor: 0.88
        },
        {
          id: "ff000003-0000-4000-8000-000000000003",
          user_id: PREVIEW_USER_ID,
          activity_id: PREVIEW_ACTIVITY_TWO_ID,
          session_id: "77777777-7777-4777-8777-777777777792",
          sport: "run",
          date: previewDateOffset(mon, 2),
          tss: 32,
          tss_source: "hr",
          duration_sec: 2100,
          intensity_factor: null
        }
      ];
    })(),
  };
}
