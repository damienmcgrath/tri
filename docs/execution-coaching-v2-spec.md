# Execution Coaching V2 Spec

## Summary
Execution Coaching V2 turns workout review into a real coaching system rather than a score display.

The feature has three connected surfaces:
- `Session Review`: a post-workout coaching read for one session.
- `Coach Briefing`: a weekly execution summary without requiring chat.
- `Coach Chat`: follow-up conversation grounded in stored execution evidence and athlete context.

The system should answer:
- what was planned
- what actually happened
- whether the intended training purpose landed
- what the athlete should do next
- what this means for the rest of the week

Execution Score remains part of the product, but it becomes supporting evidence rather than the sole headline artifact.

## Goals
- Make Session Review the most trustworthy workout-execution surface in the app.
- Turn Coach Briefing into a useful weekly synthesis, not just a gateway to chat.
- Add athlete context as a first-class input to coaching interpretation.
- Use deterministic rules for measurable facts and OpenAI models for interpretation, prioritization, and athlete-readable coaching.
- Ensure all coaching outputs explain uncertainty clearly and conservatively.

## Non-Goals
- Redesign Dashboard, Plan, Calendar, or Coach broadly.
- Build a telemetry-heavy analytics dashboard.
- Replace deterministic diagnosis with a fully freeform LLM judgment.
- Make aggressive training-plan changes from thin data.

## Product Principles
- Facts first: the system must separate observed evidence from interpretation.
- Coach-like, not app-like: surface judgments and decisions, not raw machine output.
- Explain uncertainty: low-confidence reviews should still be useful, but clearly framed as early reads.
- One source of truth: Session Review, Coach Briefing, and Coach Chat should share the same persisted execution evidence and athlete context.
- Conservative adaptation: weak evidence should yield weaker recommendations.

## User Problems
- A completed workout can look reviewable but still feel empty or generic.
- A numeric score alone does not tell the athlete what to do.
- Coach Briefing can ignore uploaded/linked/reviewed context and feel disconnected from reality.
- The app currently lacks a durable athlete context model beyond race name/date and plan linkage.
- Sparse-data sessions can still produce overly confident language.

## Users
- Self-coached triathletes using the app to understand execution quality.
- Athletes with mixed data quality across swim, bike, run, and strength.
- Athletes who want both per-session coaching and weekly implications.

## Key Concepts

### 1. Deterministic Evidence
Structured facts derived from the planned session and linked activity:
- duration completion
- interval completion
- HR drift
- time above target
- pacing fade
- variability
- detected issues
- evidence count

### 2. Coach Verdict
The primary athlete-facing artifact for a session.

It should answer:
- did the session achieve its purpose
- at what cost
- what is the right next call

### 3. Weekly Execution Brief
The primary athlete-facing artifact for the Coach page.

It should answer:
- is the week on track
- what matters most right now
- which sessions need attention
- what should change, if anything

### 4. Athlete Context
Shared context used by Session Review, Coach Briefing, and Coach Chat.

It has four sources:
- athlete-declared context
- plan-derived context
- observed patterns from reviewed sessions
- short-lived weekly state

## Primary User Stories
- As an athlete, I want to open a session and immediately understand whether it achieved the intended purpose.
- As an athlete, I want the review to tell me what to repeat, what to protect, and what to change.
- As an athlete, I want Coach to summarize the week without needing to ask a question first.
- As an athlete, I want the app to understand my goal race, experience level, and current limiters.
- As an athlete, I want the app to explain when a review is provisional and why.

## Success Criteria
- Session Review clearly distinguishes `planned`, `analysis pending`, `reviewable`, and `skipped` states.
- Coach Briefing never tells an athlete to “start from scratch” when uploads/links/reviews already exist.
- Athlete context can be collected, edited, and reused across surfaces.
- Model-generated coaching is grounded in persisted evidence and never invents metrics.
- Provisional reviews are visible, understandable, and conservatively interpreted.

## Product Shape

### Session Review V2
The session page should render this hierarchy:

#### Top Summary
- session title
- discipline
- session date
- duration
- review mode
- session status
- intent result
- execution cost
- confidence
- execution score as secondary evidence

#### Planned vs Actual
- planned intent
- actual execution summary
- main gap
- 2-4 useful evidence points only

#### Coaching Takeaway
- why it matters
- what to do differently next time
- suggested action for the week

#### Uncertainty
- shown only when confidence is not high
- explains what is missing and why the read is provisional

#### Ask Coach Follow-Up
- preserved as the bridge into chat
- prompts should use the stored verdict and weekly context

### Coach Briefing V2
The Coach page should render:
- weekly headline
- short weekly summary
- one key positive
- one key risk
- next-week decision
- compact trend line
- sessions needing attention
- athlete context cue when it is materially influencing the briefing

Example:
- `Execution is mostly on track, but one key bike session came up short`
- `5 reviewed sessions are on target. One key bike session finished short, so keep the next key session controlled and protect recovery rather than adding load.`

### Coach Chat V2
Coach Chat should use:
- reviewed session evidence
- athlete context snapshot
- weekly execution brief
- explicit citations back to session reviews

It should never rely on freeform recall of session state.

## Information Architecture

### Existing Surfaces to Extend
- `Session Review`
- `Coach Briefing`
- `Coach Chat`
- `Settings`

### New Surfaces

#### Settings > Athlete Context
Durable coaching context editor:
- experience level
- goal type
- primary event
- strongest disciplines
- weakest disciplines
- current limiters
- weekly constraints
- injury/caution notes
- preferred coaching style

#### Weekly Check-In
Lightweight weekly state capture:
- fatigue
- sleep
- soreness
- stress
- confidence
- free text note

This can live as:
- a compact Coach card
- or a modal from Coach / Dashboard

## Data Model

### Existing Tables Used
- `profiles`
- `training_plans`
- `sessions`
- `session_activity_links`
- `completed_activities`

### New Tables

#### `athlete_context`
Durable coaching context.

Columns:
- `athlete_id uuid primary key references public.profiles(id) on delete cascade`
- `experience_level text`
- `goal_type text`
- `priority_event_name text`
- `priority_event_date date`
- `limiters jsonb not null default '[]'::jsonb`
- `strongest_disciplines jsonb not null default '[]'::jsonb`
- `weakest_disciplines jsonb not null default '[]'::jsonb`
- `weekly_constraints jsonb not null default '[]'::jsonb`
- `injury_notes text`
- `coaching_preference text`
- `updated_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`

#### `athlete_checkins`
Short-lived weekly state.

Columns:
- `id uuid primary key default gen_random_uuid()`
- `athlete_id uuid not null references public.profiles(id) on delete cascade`
- `week_start date not null`
- `fatigue smallint`
- `sleep_quality smallint`
- `soreness smallint`
- `stress smallint`
- `confidence smallint`
- `note text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Rules:
- one editable check-in per athlete per `week_start`

#### `athlete_observed_patterns`
Persisted recurring tendencies derived from reviewed sessions.

Columns:
- `id uuid primary key default gen_random_uuid()`
- `athlete_id uuid not null references public.profiles(id) on delete cascade`
- `pattern_key text not null`
- `label text not null`
- `detail text not null`
- `support_count integer not null default 0`
- `confidence text not null`
- `last_observed_at timestamptz not null`
- `source_session_ids jsonb not null default '[]'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Examples:
- `easy_day_drift_after_bike_intensity`
- `threshold_sessions_finishing_short`
- `late_long_run_fade`

### Existing Table Extension

#### `sessions.execution_result`
Keep this, but evolve it into a richer persisted object with two layers:
- deterministic evidence
- athlete-facing verdict

Recommended structure:

```ts
type PersistedExecutionReview = {
  version: 2;
  linkedActivityId: string | null;
  deterministic: ExecutionEvidence;
  verdict: CoachVerdict | null;
  weeklyImpact: {
    suggestedWeekAction: string;
    suggestedNextCall: "move_on" | "proceed_with_caution" | "repeat_session" | "protect_recovery" | "adjust_next_key_session";
  } | null;
  createdAt: string;
  updatedAt: string;
};
```

## Shared Read Models

### `AthleteContextSnapshot`
Canonical shared context for all coaching surfaces.

```ts
type AthleteContextSnapshot = {
  identity: {
    athleteId: string;
    displayName: string | null;
  };
  goals: {
    priorityEventName: string | null;
    priorityEventDate: string | null;
    goalType: "finish" | "perform" | "qualify" | "build" | null;
  };
  declared: {
    experienceLevel: {
      value: "beginner" | "intermediate" | "advanced" | null;
      source: "athlete_declared" | "profile_fallback" | "unknown";
      updatedAt: string | null;
    };
    limiters: Array<{
      value: string;
      source: "athlete_declared";
      updatedAt: string | null;
    }>;
    strongestDisciplines: string[];
    weakestDisciplines: string[];
    weeklyConstraints: string[];
    injuryNotes: string | null;
    coachingPreference: "direct" | "balanced" | "supportive" | null;
  };
  derived: {
    activePlanId: string | null;
    phase: string | null;
    daysToRace: number | null;
    upcomingKeySessions: string[];
  };
  observed: {
    recurringPatterns: Array<{
      key: string;
      label: string;
      detail: string;
      confidence: "low" | "medium" | "high";
      sourceSessionIds: string[];
    }>;
  };
  weeklyState: {
    fatigue: number | null;
    sleepQuality: number | null;
    soreness: number | null;
    stress: number | null;
    confidence: number | null;
    note: string | null;
    updatedAt: string | null;
  };
};
```

### `ExecutionEvidence`
Deterministic rules output.

```ts
type ExecutionEvidence = {
  sessionId: string;
  athleteId: string;
  sport: "swim" | "bike" | "run" | "strength" | "other";
  planned: {
    title: string;
    intentCategory: string | null;
    durationSec: number | null;
    targetBands: {
      hr?: { min?: number; max?: number };
      power?: { min?: number; max?: number };
      pace?: { min?: number; max?: number };
    } | null;
    plannedIntervals: number | null;
    sessionRole: "key" | "supporting" | "recovery" | "unknown";
  };
  actual: {
    durationSec: number | null;
    avgHr: number | null;
    avgPower: number | null;
    avgPaceSPerKm: number | null;
    timeAboveTargetPct: number | null;
    intervalCompletionPct: number | null;
    variabilityIndex: number | null;
    splitMetrics: {
      firstHalfAvgHr?: number;
      lastHalfAvgHr?: number;
      firstHalfAvgPower?: number;
      lastHalfAvgPower?: number;
      firstHalfPaceSPerKm?: number;
      lastHalfPaceSPerKm?: number;
    } | null;
  };
  detectedIssues: Array<{
    code: string;
    severity: "low" | "moderate" | "high";
    supportingMetrics: string[];
  }>;
  rulesSummary: {
    intentMatch: "on_target" | "partial" | "missed";
    executionScore: number | null;
    executionScoreBand: "On target" | "Partial match" | "Missed intent" | null;
    confidence: "high" | "medium" | "low";
    provisional: boolean;
    evidenceCount: number;
  };
};
```

### `CoachVerdict`
Model-generated, schema-constrained interpretation.

```ts
type CoachVerdict = {
  sessionVerdict: {
    headline: string;
    summary: string;
    intentMatch: "on_target" | "partial" | "missed";
    executionCost: "low" | "moderate" | "high" | "unknown";
    confidence: "high" | "medium" | "low";
    nextCall: "move_on" | "proceed_with_caution" | "repeat_session" | "protect_recovery" | "adjust_next_key_session";
  };
  explanation: {
    whatHappened: string;
    whyItMatters: string;
    whatToDoNextTime: string;
    whatToDoThisWeek: string;
  };
  uncertainty: {
    label: "confident_read" | "early_read" | "insufficient_data";
    detail: string;
    missingEvidence: string[];
  };
  citedEvidence: Array<{
    claim: string;
    support: string[];
  }>;
};
```

### `WeeklyExecutionBrief`
Coach Briefing input model.

```ts
type WeeklyExecutionBrief = {
  weekHeadline: string;
  weekSummary: string;
  keyPositive: string | null;
  keyRisk: string | null;
  nextWeekDecision: string;
  trend: {
    reviewedCount: number;
    onTargetCount: number;
    partialCount: number;
    missedCount: number;
    provisionalCount: number;
  };
  sessionsNeedingAttention: Array<{
    sessionId: string;
    sessionName: string;
    scoreHeadline: string;
    reason: string;
  }>;
  confidenceNote: string | null;
};
```

## Data Collection Plan

### Durable Athlete Context
Collect from:
- first Coach use if missing
- Settings > Athlete Context
- optional Coach follow-up prompts that save structured answers

Required first-pass questions:
- experience level
- priority event
- biggest limiter
- strongest discipline
- current weekly constraint

### Weekly State
Collect from:
- a lightweight weekly check-in card on Coach
- optional resurfacing every 7 days or when no recent check-in exists

### Observed Patterns
Derived from reviewed sessions only.

Rules:
- do not generate a pattern from a single session
- require repeated support
- always store support count and source session IDs

## System Architecture

### High-Level Pipeline
1. Athlete uploads activity.
2. Activity is linked to a planned session.
3. System builds deterministic `ExecutionEvidence`.
4. System persists `execution_result` v2.
5. If enough evidence exists, system generates a model-based `CoachVerdict`.
6. System updates or creates recurring observed patterns.
7. System recomputes the weekly execution brief.
8. Session Review, Coach Briefing, and Coach Chat all read from those stored objects.

### Canonical Loaders
Add shared server-side loaders:
- `lib/athlete-context.ts`
  - `getAthleteContextSnapshot(supabase, athleteId)`
- `lib/execution-review.ts`
  - `buildExecutionEvidence(...)`
  - `buildCoachVerdict(...)`
  - `buildWeeklyExecutionBrief(...)`

Avoid page-specific re-derivation of the same concepts.

## Deterministic Layer

### Responsibilities
- classify planned session intent
- compute target comparisons
- detect execution issues
- count evidence
- assign score and band
- assign provisional status
- attach supporting metric references

### Rules Engine Guidance
Keep the current rules engine in `lib/coach/session-diagnosis.ts` as the base, but evolve it to output:
- explicit issue severities
- explicit missing evidence list
- explicit session role if available
- clearer distinction between `intent match` and `execution cost`

### Add Execution Cost
Add a second deterministic dimension:
- `low`
- `moderate`
- `high`
- `unknown`

Suggested heuristic inputs:
- excessive HR drift
- too much time above target
- large late fade
- incomplete quality reps
- shortened sessions after high strain
- weekly fatigue check-in when present

This should remain conservative and interpretable.

## Model Layer

### Responsibilities
The model should:
- convert evidence into a coach verdict
- prioritize what matters most
- explain uncertainty clearly
- personalize language based on athlete context
- synthesize weekly meaning across sessions

The model should not:
- invent metrics
- invent unseen causes
- override deterministic facts
- recommend aggressive changes from low-confidence evidence

### OpenAI Usage
Use a structured-response capable model to produce JSON against a fixed schema.

Model output should be rejected if:
- schema invalid
- it references facts not present in evidence/context
- it contradicts deterministic status

### Prompt Shape

#### System Prompt
```text
You are an endurance coach helping athletes interpret completed workouts.
Use only the provided evidence and context.
Do not invent metrics, missing facts, or unsupported causes.
If evidence is limited, explain that clearly and keep recommendations conservative.
Prefer practical next steps over generic motivation.
Separate what happened in the session from what it means for the week.
```

#### Session Input
```json
{
  "sessionEvidence": {},
  "athleteContext": {},
  "recentReviewedSessions": [],
  "weekContext": {
    "phase": null,
    "daysToRace": null,
    "upcomingKeySessions": []
  }
}
```

#### Weekly Input
```json
{
  "reviewedSessions": [],
  "athleteContext": {},
  "weekContext": {},
  "observedPatterns": []
}
```

### Prompting Rules
- Tell the model whether each context field is athlete-declared, observed, or derived.
- Include freshness where relevant.
- Include missing evidence explicitly.
- Require athlete-readable outputs, not analyst phrasing.

## UX Requirements

### Session Review

#### States
- `Not reviewable yet`
- `Analysis pending`
- `Post-execution review`
- `Skipped-session review`

#### Primary Fields
- `Session verdict`
- `Intent match`
- `Execution cost`
- `Confidence`
- `Execution score` as secondary

#### Copy Rules
- never imply a planned workout is already reviewed
- never show dead-score placeholders if analysis is missing
- provisional language should explain what is missing
- positive sessions should receive positive coaching, not fallback risk language

### Coach Briefing

#### Must Show
- week-level headline
- short summary
- sessions needing attention
- compact trend
- one concrete next decision

#### Must Avoid
- session-diagnosis strings as the headline
- raw counts without meaning
- telling the athlete to upload or complete workouts when uploads/links already exist

### Athlete Context UX

#### First-Time Setup Card
Card on Coach page when context is incomplete:
- `Help coach personalize your training`
- 4-5 questions max
- save progressively

#### Settings Page
Persistent edit surface for all durable context.

#### Weekly Check-In
Small recurring input with quick sliders or segmented choices.

## Safety and Trust Rules
- The model may interpret facts, not invent facts.
- Low-confidence reviews may suggest caution, but not aggressive plan rewrites.
- Provisional reviews cannot by themselves trigger large week changes.
- Strong week-level recommendations require multiple reviewed sessions or strong context.
- Swim and strength reviews with sparse data should bias toward modest interpretation.
- The UI should always be able to show why a judgment was made.

## Explainability Requirements
Every session verdict should support:
- a headline
- a short explanation
- cited evidence bullets
- an uncertainty note when needed

Every weekly brief should support:
- why this is the current headline
- which sessions drove it
- what to do next

## API and Service Boundaries

### New Server Helpers
- `getAthleteContextSnapshot`
- `saveAthleteContext`
- `saveWeeklyCheckin`
- `refreshObservedPatterns`
- `buildExecutionEvidence`
- `generateCoachVerdict`
- `generateWeeklyExecutionBrief`

### Recommended Endpoints / Actions
- `POST /api/athlete-context`
- `POST /api/athlete-checkin`
- `POST /api/coach/review-backfill`
  - existing route can continue, but should generate v2 persisted review objects
- `POST /api/coach/weekly-brief-refresh`

## Implementation Plan

### Phase 1: Athlete Context Foundation
- add `athlete_context` table
- add `athlete_checkins` table
- add `athlete_observed_patterns` table
- build `getAthleteContextSnapshot`
- add Settings > Athlete Context page
- add minimal Coach setup card

### Phase 2: Execution Review V2 Persistence
- evolve `session-execution.ts` to output `ExecutionEvidence`
- version `sessions.execution_result`
- preserve backward compatibility for v1 review payloads
- add execution cost derivation
- add missing-evidence tracking

### Phase 3: Model-Based Session Verdicts
- add `generateCoachVerdict`
- persist structured verdict into `sessions.execution_result`
- update Session Review page to render verdict-first UI
- preserve graceful fallback to deterministic-only mode

### Phase 4: Weekly Coach Briefing
- add weekly brief builder
- update Coach page to render week-level summary from persisted reviews
- use athlete context and observed patterns

### Phase 5: Observed Patterns and Better Follow-Up
- derive recurring tendencies from reviewed sessions
- feed them into weekly brief and chat
- add better prompt chips and citations

## Backward Compatibility
- Existing `execution_result` payloads should continue to render.
- Session Review should detect review version:
  - `v2`: use verdict-first UI
  - `v1`: map old fields into the same UI as a fallback
- Coach should tolerate athletes with:
  - no athlete context
  - no weekly check-in
  - mixed v1/v2 session reviews

## Observability
Track:
- review generation success/failure
- model schema validation failures
- verdict generation latency
- percentage of provisional reviews
- number of sessions with deterministic evidence but no verdict
- number of sessions needing backfill
- athlete context completion rate
- weekly check-in completion rate

Audit logs should capture:
- model request id
- input version
- output schema validity
- fallback path used

## Metrics
Primary product metrics:
- session review open-to-chat rate
- percentage of session reviews with actionable next step
- Coach page dwell time without chat
- athlete context completion rate
- percentage of weekly briefings with at least one reviewed session

Quality metrics:
- user-reported trust/satisfaction
- correction rate for obviously misleading verdicts
- fraction of provisional reviews shown with explicit uncertainty

## Testing Strategy

### Unit Tests
- intent classification
- issue detection
- execution cost derivation
- provisional logic
- athlete context snapshot merging
- observed pattern generation

### Integration Tests
- linking activity creates deterministic review
- verdict generation persists correctly
- Coach Briefing updates after new reviewed sessions
- athlete context updates are reflected in Coach/Session Review

### UI Tests
- Session Review states
- Coach Briefing empty / partial / rich states
- Athlete Context onboarding and settings flows
- Weekly check-in flow

### Model Contract Tests
- schema validation
- unsupported claim rejection
- low-confidence conservative behavior
- deterministic fallback when model fails

## Risks
- overfitting verdicts to thin data
- storing stale athlete context without provenance
- model tone sounding polished but not grounded
- too much product complexity before enough reviewed sessions exist

## Risk Mitigations
- persist source and freshness for athlete context
- require schema-constrained outputs
- show uncertainty explicitly
- maintain deterministic fallback path
- phase rollout behind feature flags

## Feature Flags
- `execution_review_v2`
- `coach_weekly_brief_v2`
- `athlete_context_v1`
- `weekly_checkin_v1`
- `observed_patterns_v1`
- `coach_verdict_model_v1`

## Files Likely Affected
- [lib/coach/session-diagnosis.ts](/Users/Damien/Code/tri/lib/coach/session-diagnosis.ts)
- [lib/workouts/session-execution.ts](/Users/Damien/Code/tri/lib/workouts/session-execution.ts)
- [lib/session-review.ts](/Users/Damien/Code/tri/lib/session-review.ts)
- [app/(protected)/sessions/[sessionId]/page.tsx](/Users/Damien/Code/tri/app/(protected)/sessions/[sessionId]/page.tsx)
- [app/(protected)/coach/page.tsx](/Users/Damien/Code/tri/app/(protected)/coach/page.tsx)
- [app/(protected)/coach/coach-chat.tsx](/Users/Damien/Code/tri/app/(protected)/coach/coach-chat.tsx)
- [lib/coach/tool-handlers.ts](/Users/Damien/Code/tri/lib/coach/tool-handlers.ts)
- [lib/coach/auth.ts](/Users/Damien/Code/tri/lib/coach/auth.ts)
- `app/(protected)/settings/athlete-context/page.tsx` (new)
- `app/api/athlete-context/route.ts` (new)
- `app/api/athlete-checkin/route.ts` (new)
- `lib/athlete-context.ts` (new)
- new Supabase migrations for athlete context tables

## Open Questions
- Should weekly check-ins live on Coach, Dashboard, or both?
- Should `experience_level` be athlete-entered only, or partially inferred from training history?
- Should observed patterns be purely deterministic, or allow model summarization over deterministic detections?
- Should weekly brief generation be synchronous on page load or background-refreshed and cached?

## Recommendation
Implement in this order:
1. athlete context foundation
2. execution review v2 persistence
3. session verdict UI
4. weekly coach briefing
5. observed patterns
6. richer chat grounding

That sequence gives the product a better brain without destabilizing the current review pipeline.
