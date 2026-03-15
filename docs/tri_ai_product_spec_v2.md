# tri.ai — Product & Engineering Specification v2.0

**Date:** March 15, 2026
**Purpose:** Complete implementation spec aligned with actual codebase architecture
**Status:** Active — covers current state, confirmed decisions, and full feature roadmap

---

## Table of Contents

1. [Product Identity](#1-product-identity)
2. [Product Philosophy & Principles](#2-product-philosophy--principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Surface-by-Surface Specification](#4-surface-by-surface-specification)
5. [Feature Specifications — Current Improvements](#5-feature-specifications--current-improvements)
6. [Feature Specifications — New Features](#6-feature-specifications--new-features)
7. [AI Architecture & Prompt Design](#7-ai-architecture--prompt-design)
8. [Data Model & Schema](#8-data-model--schema)
9. [Design System & Visual Language](#9-design-system--visual-language)
10. [Implementation Priorities](#10-implementation-priorities)

---

## 1. Product Identity

### What tri.ai is

tri.ai is an AI-assisted triathlon coaching web app that combines structured training plans, completed workout data from Garmin, weekly progress tracking, and explainable coaching insights into a single coherent athlete experience.

### What tri.ai is not

- Not a generic training log or activity tracker
- Not a Strava/Garmin clone focused on social or device data
- Not a chatbot bolted onto a calendar
- Not a gamified fitness app

### Core proposition

tri.ai is a **weekly coaching intelligence layer** built on top of structured training data. It helps an athlete understand what was supposed to happen, what actually happened, what it means, and what to do next.

### Target user

Primary: Serious amateur triathletes training toward specific race goals (70.3, Ironman, Olympic distance). Self-coached or lightly coached. Wants structure, insight, and progression — not just data.

Secondary (future): Athletes working with a human coach who want better day-to-day visibility between coaching check-ins. Human coaches wanting AI-assisted review and plan collaboration tools.

### Current context

The app is built and functional with these core surfaces: Dashboard, Plan, Calendar, Coach, Session Review, and Weekly Debrief. The athlete is training for Warsaw 70.3 (84 days out at time of writing), currently in Week 3 of a Build block.

### Stack

- **Frontend:** Next.js 14 (App Router), React 18.3, TypeScript, Tailwind CSS 3.4
- **UI:** Custom design system — no external component library (no shadcn, no MUI). All component styles defined in `globals.css` via `@layer components` and Tailwind utility classes
- **Backend:** Supabase (PostgreSQL, Auth, RLS policies)
- **AI:** OpenAI API via Responses API (`gpt-5-mini` default, `gpt-5.4` for deep reasoning)
- **Deployment:** Vercel (with `@vercel/analytics` and `@vercel/speed-insights`)
- **Data source:** Garmin (FIT/TCX file upload; auto-sync planned for future)
- **Key libraries:** Zod (validation), @dnd-kit (drag-and-drop for plan editing), fit-file-parser + fast-xml-parser (activity parsing), Upstash Redis (rate limiting), Geist fonts (typography)
- **Testing:** Jest + Testing Library

---

## 2. Product Philosophy & Principles

These principles govern every design and engineering decision. They are not aspirational — they are constraints.

### Principle 1: The athlete should understand the week in seconds

When the athlete logs in, they should immediately know: how much of the week is complete, whether they are on track, what matters right now. This is a 3-second read, not a 30-second scan.

### Principle 2: Progress over logistics

The dashboard leads with momentum and completion, not navigation clutter, date pickers, or duplicate "next session" cards. Progress is the emotional anchor.

### Principle 3: Quality over volume

A good summary speaks to execution quality, intent adherence, and signs of fatigue or drift — not just "you completed 8 of 11 sessions." The question is always "how well?" not just "how much?"

### Principle 4: AI must be explainable and grounded

Every AI-generated summary, insight, or recommendation must be traceable to specific data. The athlete should be able to inspect what supports any claim. No mysterious coaching conclusions.

### Principle 5: Coach-grade, not gamified

The interface should feel like a premium performance tool — focused, restrained, polished, confident. No streaks, no badges, no confetti. The tone is trusted advisor, not cheerleader.

### Principle 6: Adaptation is normal, not failure

Language matters throughout the app. "Adapt" not "failed." "Protect" used sparingly. "Focus" and "complete" over "behind" and "missed." The app supports the athlete psychologically, not just operationally.

### Principle 7: Each surface has one job

Dashboard says *what*. Debrief says *why*. Coach says *what to do about it*. Calendar tracks *execution*. Plan shows *strategy*. No surface should restate what another already covers.

### Principle 8: Passive intelligence over active burden

The app should learn from the athlete's behavior (skipped sessions, declining execution scores, shorter durations) without requiring them to fill out forms. Formal check-ins exist but are optional and lightweight.

---

## 3. Architecture Overview

### Four-layer mental model

Every feature, route, and component maps to one of these layers:

**Layer 1 — Source of Truth**
Athlete identity (`profiles` + `athlete_context`), training plans (`training_plans` + `training_weeks` + `sessions`), completed activities from Garmin uploads (`activity_uploads` + `completed_activities`), athlete check-ins, observed patterns, and race info.

**Layer 2 — Interpretation Engine**
Activity-to-session matching (`session_activity_links`), adherence calculation, weekly rollups (`lib/training/week-metrics.ts`), execution scoring (`lib/workouts/session-execution.ts`), session diagnosis (`lib/coach/session-diagnosis.ts`), derived metrics from `metrics_v2` JSONB.

**Layer 3 — Coaching Intelligence**
AI-generated weekly debriefs (`lib/weekly-debrief.ts`), coach chat with tool-calling (`lib/coach/`), session execution reviews (`lib/execution-review.ts`), plan change proposals. Uses structured context from Layer 2, never raw data alone.

**Layer 4 — Athlete Experience**
Dashboard, Calendar, Plan, Coach, Session Review, Weekly Debrief, Settings. Each surface pulls from Layers 1-3 and presents a specific lens on the athlete's training. All protected routes live under `app/(protected)/`.

### AI architecture

The AI layer uses environment-driven model selection:

```
Environment Variables:
├── OPENAI_COACH_MODEL=gpt-5-mini     (fast, cost-effective)
└── OPENAI_COACH_DEEP_MODEL=gpt-5.4   (complex reasoning, adaptation)

Coach System:
├── lib/coach/instructions.ts          System prompt + structuring instructions
├── lib/coach/tools.ts                 7 function-calling tools with Zod schemas
├── lib/coach/tool-handlers.ts         Tool execution logic
├── lib/coach/auth.ts                  Auth context resolution
├── lib/coach/audit.ts                 Interaction logging
├── lib/coach/session-diagnosis.ts     Session execution analysis
└── lib/coach/workout-summary.ts       Workout summarization
```

**AI is invoked on structured context, not raw data.** The `AthleteContextSnapshot` type (defined in `lib/athlete-context.ts`) provides:
- Athlete identity and display name
- Goals (priority event, goal type, days to race)
- Declared context (experience level, limiters, disciplines, constraints, coaching preference)
- Derived context (active plan, phase, upcoming key sessions)
- Observed patterns (recurring themes from execution data, with confidence levels)
- Weekly state (check-in data: fatigue, sleep, soreness, stress, confidence)

### Deterministic vs AI responsibility split

| Responsibility | Owner |
|---|---|
| Was a session completed? | Deterministic (matching logic in `lib/workouts/activity-matching.ts`) |
| Planned vs actual time delta | Deterministic |
| Is a session on target, partial, or missed? | Deterministic (rules in `lib/workouts/session-execution.ts`) |
| Weekly completion percentage | Deterministic (`lib/training/week-metrics.ts`) |
| Metrics extraction (HR, power, pace, zones) | Deterministic (from `metrics_v2` JSONB via `lib/workouts/activity-parser.ts`) |
| What does the week mean? | AI |
| Is the athlete on track for race day? | AI (with structured inputs) |
| How should the athlete adapt? | AI (with constraints) |
| Session execution narrative | AI |
| Coaching follow-up answers | AI (via tool-calling coach chat) |

### Data flow patterns

**Server-side rendering:** Next.js 14 App Router with `force-dynamic` pages. Data fetched during render via Supabase server client (`lib/supabase/server.ts`).

**No client-side state library:** No Redux or Zustand. State is server-fetched, with mutations handled via Server Actions in per-route `actions.ts` files.

**Streaming:** Coach chat uses OpenAI Responses API with SSE (Server-Sent Events) for real-time answer deltas and tool call events.

**Rate limiting:** Upstash Redis-backed rate limiting (`lib/security/rate-limit.ts`):
- Coach chat: 40 req/min per IP, 20 req/min per user
- Activity uploads: 20/hour per IP, 10/hour per user

---

## 4. Surface-by-Surface Specification

### 4A. Dashboard

**Purpose:** The athlete's command center. One-glance weekly status. Answer: "How is my week going and what should I do right now?"

**Current implementation:** `app/(protected)/dashboard/page.tsx`
- `progress-glance-card.tsx` — weekly volume summary by discipline
- `week-progress-card.tsx` — planned vs completed with daily breakdown
- `weekly-debrief-card.tsx` — AI-generated weekly summary teaser
- `next-action-copy.ts` — "What matters right now" copy generation
- `tcx-upload-form.tsx` — activity file upload

**Current state issues:**
- Too many cards saying similar things
- Information hierarchy is flat — everything competes for attention

**Target state — three-zone layout:**

**Zone 1: Weekly Progress (top, dominant)**
- Large completion percentage (keep the hero metric — it works)
- Week date range and status badge ("Slightly behind" / "On track" / "Ahead")
- Compact day strip showing done/remaining per day
- Completed / Remaining / Missed row
- This zone answers: "How far through the week am I?"

**Zone 2: What Matters Right Now (right column or prominent card)**
- Single card with the most important action
- "What matters right now" heading stays — it's excellent copy
- Shows: remaining sessions for today, or the next key session if today is clear
- Quick links: "Open session" / "View plan"
- If no sessions remain today: shift to tomorrow's preview or the week's key remaining session
- This zone answers: "What should I focus on next?"

**Zone 3: Weekly Narrative (below progress)**
- The weekly debrief headline and subtitle only (not the full debrief)
- 2-3 key bullet insights pulled from the debrief facts
- "Open debrief" link to the full debrief page
- This zone answers: "What's the story of my week so far?"

**What to remove from dashboard:**
- Any duplicate phrasing of the same insight across multiple cards
- Consolidate overlapping cards into the three zones above

**Contextual awareness behavior:**
- Morning of a key session day: Zone 2 highlights the key session with brief prep note
- After a flagged session completes: Zone 3 includes a mention with link to session review
- Late in the week with remaining load: Zone 2 shows what's left with time context
- Week complete: Dashboard shifts to celebration/summary mode with link to full debrief

### 4B. Calendar

**Purpose:** The execution surface. Daily operational view of the current week. Answer: "What's happening this week, what have I done, what's left?"

**Current implementation:** `app/(protected)/calendar/page.tsx`
- `week-calendar.tsx` — interactive week view with session cards, status filtering, sport filtering, drag-to-move, mark-as-skipped, quick-add, linked activity display

**Role clarification:** Calendar is where the athlete lives during the week. It's the operational cockpit. Sessions get marked complete, skipped, or tagged as extra here. The time horizon is this week, with a glance at next week.

**Current state:** Strong. The week grid with sport-type color coding, completion badges, duration planned vs actual, and status indicators is working well.

**Improvements:**

1. **Adaptation workflow (priority feature — see Section 6B)**
   When a session is missed or the week's shape changes, Calendar should surface adaptation options. This is the primary home for the adaptation engine.

2. **Session quick actions**
   Each session card should support quick status changes without opening the full session:
   - Mark as skipped (with optional reason: "tired," "time," "injury," "weather," "other")
   - Tag as extra/unplanned
   - Quick RPE after completion (optional, non-blocking)

3. **Day context header**
   Each day column could show a one-line contextual note when relevant:
   - "Key session today" (for sessions where `is_key = true`)
   - "Recovery day" (when the plan intends easy work)
   - "Rest day" (when no sessions are planned)

4. **Unassigned activity handling**
   When an uploaded activity doesn't match a planned session, Calendar should surface it with a prompt: "Unplanned 30min bike detected. Tag as extra or assign to a planned session."

### 4C. Plan

**Purpose:** The strategy surface. Multi-week view of training structure. Answer: "What's the shape of my training and why is it structured this way?"

**Current implementation:** `app/(protected)/plan/page.tsx`
- `plan-editor.tsx` — client-side plan editing with drag-and-drop (@dnd-kit)
- Also: `app/(protected)/plan/builder/page.tsx` — plan builder route

**Role clarification:** Plan is visited weekly or less. It's for understanding the training arc, not for daily execution. This is also the future home for coach collaboration.

**Current state:** Partially implemented. Basic plan editing exists but needs elevation.

**Target state redesign:**

**Header section (keep, enhance):**
- Block name and phase ("Week 3 - Build") — derived from `training_weeks.focus` field
- Date range and planned volume
- Week focus — keep this, it's valuable
- Rest days count
- **Add:** Week-over-week volume delta ("+ 30 min vs last week")
- **Add:** Position in block (computed from consecutive `training_weeks` with same `focus` value)

**Week board (keep, enhance):**
- Current session cards by day are fine structurally
- **Add:** Key session indicators (highlight sessions where `sessions.is_key = true`)
- **Add:** Session intent notes visible on hover or tap (from `sessions.notes` or `sessions.intent_category`)
- **Add:** Coach notes per session (future: editable by human coach)

**New: Weekly load shape visualization**
Below or beside the week board, add a simple stacked horizontal bar chart showing planned volume by discipline per day. This gives an instant visual read on the week's load distribution. A compact spark-chart style visualization using CSS bars (no charting library needed — consistent with existing approach).

**New: Multi-week plan view**
Add the ability to zoom out and see 4-6 weeks at a time in a condensed view:
- Week number, block/phase (from `training_weeks.focus`), total planned hours
- Key sessions highlighted
- Volume progression visible as a simple trend

**New: Week notes and coach collaboration (future)**
- Expandable section per week for notes (stored in `training_weeks.notes`)
- In future: a human coach can leave annotations, move sessions, adjust targets

### 4D. Coach

**Purpose:** Contextual AI coaching. Issue-driven guidance. Answer: "What should I do about what happened this week?"

**Current implementation:** `app/(protected)/coach/page.tsx`
- `coach-chat.tsx` — streaming chat UI with tool-calling integration
- `weekly-checkin-card.tsx` — weekly subjective check-in form (fatigue, sleep, soreness, stress, confidence on 1-5 scale)
- API: `app/api/coach/chat/route.ts` — SSE streaming endpoint

**Current state:** Good architecture — conversational AI with 7 tools for data retrieval and plan change proposals. Structured response format (headline, answer, insights, actions, warnings).

**Improvements:**

1. **Clean up thread history**
   - Auto-archive threads older than 2 weeks
   - Group by week: "This week" / "Last week" / "Older"
   - Show thread topic summary, not just first message
   - Limit visible threads to 5 most recent, with "Show older" expand
   - Table: `ai_conversations` — add `week_start` or use `created_at` for grouping

2. **Strengthen the briefing card**
   - Add one sentence connecting to the macro arc: "Week 3 of 12 toward Warsaw 70.3. Build phase — bike and run volume are primary."
   - Make the "Next-week decision" more prominent — this is high-value content that's currently buried

3. **Check-in integration**
   - When check-in data exists in `athlete_checkins`, the briefing should reference it: "You reported normal fatigue and okay sleep — the plan looks appropriate."
   - When check-in data shows stress: "You reported high stress this week. Consider protecting recovery between key sessions."
   - Check-in data is already wired into `AthleteContextSnapshot.weeklyState`

4. **Suggested questions improvement**
   Make suggested questions context-aware:
   - After a missed session: "How should I make up for the missed Thursday swim?"
   - After a strong week: "Am I ready to increase volume next week?"
   - Before a key session: "What should I focus on in tomorrow's long bike?"

### 4E. Session Review

**Purpose:** Deep dive into individual session execution. Answer: "How well did I execute this session and what does it mean?"

**Current implementation:** `app/(protected)/sessions/[sessionId]/page.tsx`
- Execution review with verdict, key observations, recommendations
- Data stored in `sessions.execution_result` (JSONB)
- Generation via `app/api/sessions/[sessionId]/review/regenerate/route.ts`

**Current state:** Strong. Execution score, split analysis, stat cards, "What to Do Next," contextual guidance, and "Ask coach follow-up" are well-designed.

**Improvements:**

1. **Post-session feel capture (new — see Section 6C)**
   On first open of a session review after completion, show a non-blocking banner for RPE + optional note.

2. **Multi-week session comparison (new — see Section 6D)**
   For recurring session types, show a "Compared to last time" card with key metric deltas and AI-generated one-line insight.

3. **Execution score explanation**
   Add an expandable "How is this scored?" section explaining the factors: duration match, intensity match, intent alignment, split consistency.

### 4F. Weekly Debrief

**Purpose:** End-of-week coaching summary. The narrative synthesis of the training week. Answer: "What happened this week, what went well, what should I carry forward?"

**Current implementation:** `app/(protected)/debrief/page.tsx`
- `debrief-feedback-card.tsx` — feedback collection (helpful/accurate)
- `debrief-refresh-button.tsx` — manual regeneration trigger
- Also: `app/(protected)/debrief/coach/page.tsx` — coach-facing debrief
- API: `app/api/weekly-debrief/refresh/route.ts`
- Data: `weekly_debriefs` table with `facts` (JSONB), `narrative` (JSONB), `coach_share` (JSONB)

**Current state:** This is the best surface in the app. The headline, stat row, narrative, "What Went Well" / "What to Notice" / "Carry Into Next Week" structure, and supporting evidence inspection are all excellent.

**Improvements:**

1. **Add macro-arc context**
   One line at the top connecting this week to the bigger picture:
   - "Week 3 of 12 - Build Phase - Warsaw 70.3 in 84 days"
   - "Cumulative bike volume: on track | Run volume: 12% behind plan"

2. **Week-over-week comparison (after week 2+)**
   A compact "vs last week" row:
   - Completed: 8/11 vs 9/11 last week
   - Time: 8h 9m vs 9h 15m last week
   - Execution quality trend: stable / improving / declining

3. **Shareable summary card (see Section 6E)**
   A "Share this week" button that generates a branded image card suitable for Instagram stories.

4. **Feedback loop improvement**
   The current "Did this match the week?" feedback is good (`weekly_debriefs.helpful`, `weekly_debriefs.accurate`, `weekly_debriefs.feedback_note`). Enhance by:
   - Storing feedback and using it to calibrate future AI outputs
   - If the athlete consistently rates summaries as "not accurate," flag this for model tuning

### 4G. Settings

**Purpose:** Configuration and integrations. Rarely visited.

**Current implementation:** `app/(protected)/settings/page.tsx`
- `/settings/race` — race name and date (stored in `profiles.race_name`, `profiles.race_date`)
- `/settings/integrations` — activity upload management, metrics backfill, review backfill
- `/settings/athlete-context` — athlete context form (experience level, goals, limiters, disciplines, constraints, coaching preference — stored in `athlete_context`)

---

## 5. Feature Specifications — Current Improvements

### 5A. Dashboard Simplification

**Priority:** High
**Effort:** Medium
**Dependencies:** None

**Spec:**
Consolidate the dashboard into exactly three zones as specified in Section 4A. No more than 3 distinct content areas on the dashboard at any time.

**Key files:**
- `app/(protected)/dashboard/page.tsx`
- `app/(protected)/dashboard/components/progress-glance-card.tsx`
- `app/(protected)/dashboard/components/week-progress-card.tsx`
- `app/(protected)/dashboard/components/weekly-debrief-card.tsx`
- `app/(protected)/dashboard/components/next-action-copy.ts`

**Acceptance criteria:**
- Dashboard loads with three clear zones: progress, what matters now, weekly narrative
- No two cards on the dashboard say the same thing in different words
- An athlete can understand their week status in under 3 seconds
- Dashboard is not scrollable on a standard laptop viewport (all content above the fold)

### 5B. Coach Thread Cleanup

**Priority:** Medium
**Effort:** Low
**Dependencies:** None

**Spec:**
Implement thread grouping and auto-archiving in the Coach sidebar.

**Key files:**
- `app/(protected)/coach/components/coach-chat.tsx`
- Table: `ai_conversations`

**Implementation:**
1. Group threads by week using `created_at` timestamp
2. Show at most 5 threads in "This week" and 3 in "Last week"
3. "Older" is collapsed by default with count badge
4. Auto-generate thread titles from first user message (truncate to 40 chars) — stored in `ai_conversations.title`
5. Add "..." menu per thread with "Delete" option

**Acceptance criteria:**
- Thread sidebar never shows more than 8 threads at once without scrolling
- Threads are grouped by the week they were created
- Old threads are accessible but not visually dominant

### 5C. Information Deduplication Audit

**Priority:** High
**Effort:** Low
**Dependencies:** 5A

**Spec:**
Audit every surface for repeated information. Each insight should appear in exactly one primary location:

| Insight | Primary Location | Can Reference (link only) |
|---|---|---|
| Weekly completion stats | Dashboard Zone 1 | Debrief stat row |
| Weekly narrative headline | Debrief | Dashboard Zone 3 (headline + link) |
| What matters right now | Dashboard Zone 2 | — |
| Sessions needing attention | Coach briefing | Calendar badges (visual only) |
| Carry-forward items | Debrief | Coach briefing (one-line mention) |
| Session execution details | Session Review | Coach (when discussing that session) |
| Macro-arc position | Debrief header | Coach briefing (one-line mention) |

---

## 6. Feature Specifications — New Features

### 6A. Macro-Arc Awareness

**Priority:** High
**Effort:** Medium
**Dependencies:** `training_weeks.focus` field (already exists), `profiles.race_date` (already exists)

**What it is:**
Every weekly surface should anchor the week in the bigger training picture. The athlete should always know where they are in the arc toward race day.

**Implementation:**

1. **Data requirements (all exist already):**
   - `training_weeks.focus` — block/phase identifier (Build, Recovery, Taper, Race, Custom)
   - `training_weeks.week_index` — week number within plan
   - `profiles.race_date` — race date
   - `profiles.race_name` — race name
   - Cumulative volume targets per discipline per block — derived from `sessions` table

2. **New computed function: `getMacroContext()`**
   Location: `lib/training/macro-context.ts`

   Derives block position by grouping consecutive `training_weeks` with the same `focus` value:
   ```typescript
   type MacroContext = {
     raceName: string | null;
     raceDate: string | null;
     daysToRace: number | null;
     currentBlock: string;             // "Build", "Recovery", etc.
     blockWeek: number;                // e.g., 3
     blockTotalWeeks: number;          // e.g., 6
     cumulativeVolumeByDiscipline: {
       swim: { plannedMinutes: number; actualMinutes: number; deltaPct: number };
       bike: { plannedMinutes: number; actualMinutes: number; deltaPct: number };
       run: { plannedMinutes: number; actualMinutes: number; deltaPct: number };
     };
   };
   ```

   No new database table needed. Block context is computed from existing `training_weeks` rows.

3. **Surface integration:**
   - **Debrief header:** "Week 3 of 12 - Build Phase - Warsaw 70.3 in 84 days"
   - **Debrief body:** "Cumulative bike volume is on track (-4%). Run volume is 15% behind cumulative plan — worth monitoring."
   - **Coach briefing:** "Build phase, week 3. Bike and run are primary emphases."
   - **Dashboard:** Race countdown already exists in global header — sufficient for now

4. **AI prompt integration:**
   The `MacroContext` is included in every AI call that generates weekly-level content. The AI should reference it naturally — one sentence in the debrief, one sentence in the coach briefing.

### 6B. Adaptation Engine

**Priority:** Critical — highest-impact new feature
**Effort:** High
**Dependencies:** Matching logic, weekly rollups, macro-arc context

**What it is:**
When training doesn't go to plan, the app should help the athlete redistribute remaining load intelligently rather than just flagging what was missed.

**Interaction model:**
The adaptation engine lives primarily in Calendar. When the week's shape changes, it surfaces options — not automatic changes.

**Trigger conditions:**
1. A planned session is marked as skipped (via `sessions.status = 'skipped'`)
2. A completed session is significantly shorter than planned (>25% duration reduction)
3. Two or more sessions are missed in a week
4. The athlete's check-in reports high fatigue/stress (from `athlete_checkins`)
5. An unplanned rest day appears mid-week
6. The athlete explicitly asks the coach "how should I adjust?"

**Adaptation logic (hybrid: rules + AI):**

Step 1 — Deterministic assessment (computed from `sessions` table):
```
remaining_sessions = sessions WHERE status = 'planned' AND week_id = current
completed_sessions = sessions WHERE status = 'completed' AND week_id = current
skipped_sessions = sessions WHERE status = 'skipped' AND week_id = current
key_sessions_remaining = remaining_sessions WHERE is_key = true
days_left_in_week = 7 - current_day_of_week
```

Step 2 — Rule-based constraints:
- Never add volume to a day that already has a key session
- Never suggest more than 2 sessions per day
- Never suggest training on a planned rest day unless athlete explicitly opts in
- Key sessions are protected by default — they move before they get cut
- Recovery/optional sessions (`session_role = 'recovery'` or `'optional'`) can be dropped first
- If <2 days remain in week, don't try to make up missed volume — carry insight forward

Step 3 — AI-generated adaptation options (using `gpt-5.4` deep model):
Generate 2-3 adaptation options with rationale, leveraging the existing `create_plan_change_proposal` tool pattern.

**UI presentation (Calendar):**
When an adaptation trigger fires:
1. A banner appears at the top of Calendar: "Your week has shifted. Would you like adaptation suggestions?"
2. Clicking opens a side panel or modal with the adaptation options
3. Each option shows: what changes, what stays, projected completion %, key session impact
4. The athlete selects one (or dismisses to handle manually)
5. Selected option updates the calendar with modified sessions marked as adapted

**Data storage (new table):**
```sql
-- NEW TABLE
create table public.adaptations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_id uuid references public.training_weeks(id) on delete set null,
  trigger_type text not null check (trigger_type in (
    'session_skipped', 'duration_short', 'fatigue_checkin', 'manual_request'
  )),
  trigger_session_id uuid references public.sessions(id) on delete set null,
  options jsonb not null default '[]'::jsonb,
  selected_option integer,
  status text not null default 'suggested' check (status in ('suggested', 'applied', 'dismissed')),
  model_used text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
```

### 6C. Post-Session Feel Capture

**Priority:** Medium
**Effort:** Low
**Dependencies:** Session Review page

**What it is:**
A lightweight, non-blocking subjective data capture shown when an athlete first opens a session review after completion.

**Spec:**

1. **Trigger:** First time a session review is opened after the activity is linked.

2. **UI:** A compact banner at the top of the session review page (not a modal, not blocking):
   ```
   How did this feel?
   [1] [2] [3] [4] [5] [6] [7] [8] [9] [10]   RPE
   Note (optional): [________________________]   [Save] [Skip]
   ```

3. **Behavior:**
   - Appears once per session. After save or skip, never shows again
   - "Skip" dismisses permanently — no nagging
   - RPE values: 1-10 (standard RPE scale)
   - Note field: single line, max 200 chars, optional

4. **Data storage (new table, following existing conventions):**
   ```sql
   -- NEW TABLE
   create table public.session_feels (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users(id) on delete cascade,
     session_id uuid not null references public.sessions(id) on delete cascade,
     rpe smallint not null check (rpe >= 1 and rpe <= 10),
     note text,
     was_prompted boolean not null default true,
     created_at timestamptz not null default now(),
     unique (session_id)
   );
   ```

5. **Data usage:**
   - Included in session review AI context
   - Included in weekly debrief context for pattern detection
   - Included in multi-week trend comparisons

### 6D. Multi-Week Session Comparison & Trends

**Priority:** Medium-High
**Effort:** Medium
**Dependencies:** 2+ weeks of data, session matching, session type categorization

**What it is:**
Paired comparison of similar sessions across weeks, and longer-term trend surfacing after 4+ weeks.

**Two tiers:**

**Tier 1: Session-to-session comparison (available at 2+ weeks)**
When viewing a session review for a recurring session type, show a "Compared to last time" card.

**Matching logic for comparison:**
- Match by `sessions.type` + `sessions.sport` first (e.g., "Easy Run" to "Easy Run")
- If no exact type match, match by sport + similar duration range (+/-20%)
- Compare the most recent instance to the previous instance
- Only show comparison if the previous instance is within 4 weeks

**Metrics to compare by sport:**

| Sport | Key Comparison Metrics (from `metrics_v2` JSONB) |
|---|---|
| Run | avgHr, avgPaceSecPerKm, duration, avgCadence, RPE |
| Bike | avgPower, normalizedPower, avgHr, intensityFactor, trainingStressScore, duration, RPE |
| Swim | avgPacePer100mSec, avgSwolf, duration, RPE |
| Strength | Duration, RPE, notes comparison |

**AI-generated insight:** One sentence interpreting the delta. Keep it specific and grounded.

**Tier 2: Multi-week trends (available at 4+ weeks)**
Surface trend cards in the Weekly Debrief and Coach Briefing.

**New utility:** `lib/training/trends.ts`
- Consistent direction over 3+ data points = trend
- Improvement: lower HR at same/faster pace, higher power at same HR, faster pace at same RPE
- Concern: rising HR at same pace, declining power, increasing RPE for same workload

**Where trends appear:**
- Session Review: "Compared to last time" card (Tier 1)
- Weekly Debrief: "Trends" section with 1-3 notable trends
- Coach Briefing: mentioned in key positive or key risk if relevant
- Coach Chat: available as context for answering trend questions

### 6E. Shareable Weekly Summary Card

**Priority:** Medium
**Effort:** Medium
**Dependencies:** Weekly debrief data, branded design system

**What it is:**
A visually striking image summarizing the training week, designed for Instagram stories.

**Design requirements:**
- Dark background matching app theme (`--color-base: #0a0a0b`)
- Lime accent (`--color-accent: #beff00`) elements
- Sport-colored daily discipline-stacked bar chart as the visual centerpiece
- tri.ai wordmark (top and bottom)
- 9:16 ratio (1080x1920) and square (1080x1080) variants
- Readable at mobile resolution

**Content:** Week number, block, date range, completion bar, daily volume breakdown by sport, debrief headline, race countdown.

**Implementation:**
- Generate as Canvas render on the client
- "Share this week" button on the Weekly Debrief page
- Downloads as PNG
- Data sourced from `weekly_debriefs.facts` JSONB

### 6F. Week Ahead Preview

**Priority:** Medium
**Effort:** Medium
**Dependencies:** Plan data, macro-arc context, previous week's debrief

**What it is:**
A "preview briefing" generated Sunday evening or Monday morning that sets up the coming week.

**Content:** Week number, block, planned volume, key sessions, what to watch, compared to last week.

**Generation timing:**
- Auto-generated when Sunday's debrief is finalized
- Available on the Dashboard as a card when the new week begins
- Also accessible from Plan view

**AI inputs:**
- Next week's planned sessions (from `sessions` table)
- Previous week's debrief (from `weekly_debriefs`)
- Macro-arc context (computed)
- Check-in data (from `athlete_checkins`, if available)
- Carry-forward items from previous debrief

### 6G. Ambient Check-in Intelligence

**Priority:** Medium
**Effort:** Medium-Low
**Dependencies:** Session tracking, skip reasons, coach chat, RPE capture

**What it is:**
The app gathers subjective athlete signals from their natural behavior, reducing the need for formal check-in forms.

**Signal sources:**

| Behavior | Signal | How to Capture |
|---|---|---|
| Athlete skips a session with reason "tired" | Fatigue indicator | Skip reason on Calendar (via `sessions.status` + notes) |
| Session durations consistently shorter than planned | Possible fatigue or time pressure | Computed from `session_activity_links` + activity duration vs `sessions.duration_minutes` |
| RPE trending up for same session types | Fatigue accumulation | From `session_feels` table |
| Athlete asks coach about rest/recovery | Recovery concern | Coach chat topic detection (from `ai_messages`) |
| Execution scores declining over 2+ sessions | Performance drift | From `sessions.execution_result` JSONB |
| Long gaps between session completions | Schedule disruption | Activity timestamps from `completed_activities` |

**How ambient signals are used:**
- Aggregated into a `weekly_wellness_context` object
- Included in AI prompts for debrief, coach briefing, and adaptation suggestions
- Surfaced to the athlete only when a pattern is notable
- Builds on existing `athlete_observed_patterns` table

**Formal check-in remains available:**
The weekly check-in widget (stored in `athlete_checkins` with 1-5 integer scales for fatigue, sleep, soreness, stress, confidence) stays on the Coach page. It's optional, not nagging.

---

## 7. AI Architecture & Prompt Design

### 7A. Prompt design principles

1. **Structured input, narrative output.** Every AI call receives a structured JSON context object. The AI's job is to interpret and narrate, not to compute.

2. **Role specificity.** Each AI call has a specific system prompt defining the output's purpose, format, and constraints. The "coaching voice" is consistent but the task varies.

3. **Grounding requirements.** Every claim in AI output should be traceable to a specific input data point. The system prompt instructs: "Never invent athlete data" and "only use facts returned by tools."

4. **Brevity and density.** AI outputs should be dense with insight, not padded with encouragement. One specific sentence > three generic sentences.

5. **Tone calibration.** The AI voice should be: confident but not arrogant, specific but not clinical, supportive but not sycophantic, direct but not blunt. Think: experienced coach who respects the athlete's intelligence.

### 7B. Coach system prompt (actual)

From `lib/coach/instructions.ts`:

```
You are TriCoach AI, an evidence-grounded triathlon coach.

Core behavior rules:
- Be concise, practical, and supportive.
- Never invent athlete data.
- If athlete-specific context is needed, call tools and prefer persisted weekly brief
  / context snapshots over freeform summaries.
- If data is missing, explicitly say what is missing.
- Never claim to directly edit a training plan.
- You may create proposal records only via create_plan_change_proposal.
- When you reference session reviews, cite the specific session name and only use
  facts returned by tools.
- Keep recommendations actionable and prioritized.
- Keep responses in plain text without markdown tables.
```

### 7C. Coach structured response format

From `lib/coach/instructions.ts` (COACH_STRUCTURING_INSTRUCTIONS):

The coach's raw response is transformed into strict JSON for UI rendering:
```json
{
  "headline": "string",
  "answer": "string",
  "insights": ["string[]"],
  "actions": [{"type": "string", "label": "string", "payload?": "string"}],
  "warnings": ["string[]"],
  "proposal": "optional object (only when referencing a saved proposal)"
}
```

### 7D. Coach tools (7 functions)

All defined in `lib/coach/tools.ts` with Zod schemas, executed in `lib/coach/tool-handlers.ts`:

| Tool | Description | Parameters |
|---|---|---|
| `get_athlete_snapshot` | Profile + training context via `AthleteContextSnapshot` | None |
| `get_recent_sessions` | Completed & planned sessions | `daysBack` (1-60, default 14) |
| `get_upcoming_sessions` | Future planned sessions | `daysAhead` (1-30, default 7) |
| `get_week_progress` | Weekly volume summary (planned vs completed) | None |
| `get_weekly_brief` | Persisted weekly execution briefing | None |
| `get_activity_details` | Full source-backed metrics for one activity | `activityId` (UUID, required) |
| `create_plan_change_proposal` | Create proposal record (never edits directly) | `title`, `rationale`, `changeSummary` (required); `targetSessionId`, `proposedDate`, `proposedDurationMinutes` (optional) |

### 7E. Coach chat flow

```
User message
  → Resolve auth context (lib/coach/auth.ts)
  → Load conversation + recent message history (ai_conversations + ai_messages)
  → Send to OpenAI Responses API with system prompt + tools
  → Stream response via SSE:
      - Answer deltas (real-time text streaming)
      - Tool call events (up to 6 iterations of tool use)
  → Final answer generation
  → JSON structuring step (COACH_STRUCTURING_INSTRUCTIONS)
  → Persist: ai_messages (user + assistant), update ai_conversations
  → Return structured response to UI
```

### 7F. AI call inventory

| AI Call | Trigger | Model | Input | Output |
|---|---|---|---|---|
| Weekly Debrief | Manual refresh (`/api/weekly-debrief/refresh`) | gpt-5-mini | Activities, sessions, athlete context, check-ins, patterns | Facts JSONB + Narrative JSONB + Coach Share JSONB |
| Coach Chat | User sends message (`/api/coach/chat`) | gpt-5-mini (default) or gpt-5.4 | Thread history, tool results | Structured JSON (headline, answer, insights, actions, warnings) |
| Session Review | Manual regenerate (`/api/sessions/[id]/review/regenerate`) | gpt-5-mini | Session data, activity metrics, execution evidence | Execution verdict stored in `sessions.execution_result` |
| Adaptation Options | NEW: Adaptation trigger | gpt-5.4 (deep) | Remaining plan, constraints, macro context | 2-3 adaptation options |
| Week Ahead Preview | NEW: Sunday/Monday generation | gpt-5-mini | Next week plan, previous debrief, carry-forward | Preview briefing |
| Session Comparison | NEW: Session review (comparable exists) | gpt-5-mini | Current + previous metrics, deltas | One-sentence trend insight |
| Trend Insight | NEW: Debrief generation (4+ weeks) | gpt-5-mini | Trend data arrays | 1-3 trend summaries |

### 7G. Context type (actual)

The `AthleteContextSnapshot` type from `lib/athlete-context.ts`:

```typescript
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
    limiters: Array<{ value: string; source: "athlete_declared"; updatedAt: string | null }>;
    strongestDisciplines: string[];
    weakestDisciplines: string[];
    weeklyConstraints: string[];
    injuryNotes: string | null;
    coachingPreference: "direct" | "balanced" | "supportive" | null;
  };
  derived: {
    activePlanId: string | null;
    phase: string | null;           // "base" | "build" | "peak" | "taper" | "pre_plan"
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
    fatigue: number | null;         // 1-5 scale
    sleepQuality: number | null;
    soreness: number | null;
    stress: number | null;
    confidence: number | null;
    note: string | null;
    updatedAt: string | null;
  };
};
```

---

## 8. Data Model & Schema

### 8A. Existing tables (current production schema)

All tables use Supabase RLS policies scoping data to `auth.uid()`. All use `set_updated_at()` trigger where `updated_at` exists.

**profiles**
```sql
-- PK is auth.users(id), not a separate athlete_id
id uuid primary key references auth.users(id) on delete cascade,
display_name text,
avatar_url text,
race_name text,
race_date date,
active_plan_id uuid,             -- FK to training_plans
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

**athlete_context**
```sql
athlete_id uuid primary key references profiles(id) on delete cascade,
experience_level text check (in ('beginner', 'intermediate', 'advanced')),
goal_type text check (in ('finish', 'perform', 'qualify', 'build')),
priority_event_name text,
priority_event_date date,
limiters jsonb not null default '[]',
strongest_disciplines jsonb not null default '[]',
weakest_disciplines jsonb not null default '[]',
weekly_constraints jsonb not null default '[]',
injury_notes text,
coaching_preference text check (in ('direct', 'balanced', 'supportive')),
created_at timestamptz, updated_at timestamptz
```

**athlete_checkins**
```sql
id uuid primary key,
athlete_id uuid not null references profiles(id),
week_start date not null,
fatigue smallint check (1-5),
sleep_quality smallint check (1-5),
soreness smallint check (1-5),
stress smallint check (1-5),
confidence smallint check (1-5),
note text,
created_at timestamptz, updated_at timestamptz,
unique (athlete_id, week_start)
```

**athlete_observed_patterns**
```sql
id uuid primary key,
athlete_id uuid not null references profiles(id),
pattern_key text not null,
label text not null,
detail text not null,
support_count integer not null default 0,
confidence text not null check (in ('low', 'medium', 'high')),
last_observed_at timestamptz not null,
source_session_ids jsonb not null default '[]',
created_at timestamptz, updated_at timestamptz,
unique (athlete_id, pattern_key)
```

**training_plans**
```sql
id uuid primary key,
user_id uuid not null references auth.users(id),
name text not null,
start_date date not null,
duration_weeks integer not null check (> 0),
created_at timestamptz, updated_at timestamptz
```

**training_weeks**
```sql
id uuid primary key,
plan_id uuid not null references training_plans(id),
week_index integer not null check (> 0),
week_start_date date not null,
focus text not null default 'Build' check (in ('Build', 'Recovery', 'Taper', 'Race', 'Custom')),
notes text,
target_minutes integer,
target_tss integer,
created_at timestamptz, updated_at timestamptz,
unique (plan_id, week_index)
```
Note: Block/phase is derived from consecutive weeks with the same `focus` value — no separate `training_blocks` table.

**sessions** (primary session table — replaces legacy `planned_sessions`)
```sql
id uuid primary key,
plan_id uuid not null references training_plans(id),
week_id uuid references training_weeks(id),
user_id uuid not null references auth.users(id),
date date not null,
sport text not null check (in ('swim', 'bike', 'run', 'strength', 'other')),
type text not null,
duration_minutes integer not null check (> 0),
notes text,
distance_value numeric,
distance_unit text,
status text not null default 'planned' check (in ('planned', 'completed', 'skipped')),
target text,
day_order integer not null default 0,
is_key boolean not null default false,
session_name text,
discipline text,
subtype text,
workout_type text,
intent_category text,
session_role text check (in ('key', 'supporting', 'recovery', 'optional')),
source_metadata jsonb,
execution_result jsonb,           -- persisted execution review payload
created_at timestamptz, updated_at timestamptz
```

**planned_sessions** (legacy — kept for backward compatibility, FK migrated to `sessions`)
```sql
id uuid primary key,
plan_id uuid not null references training_plans(id),
user_id uuid not null references auth.users(id),
date date not null,
sport text not null,
type text not null,
duration integer not null,
notes text,
created_at timestamptz, updated_at timestamptz
```

**activity_uploads**
```sql
id uuid primary key,
user_id uuid not null references auth.users(id),
filename text not null,
file_type text not null check (in ('fit', 'tcx')),
file_size integer not null check (> 0 and <= 20971520),   -- max 20MB
sha256 text not null,
storage_key text,
raw_file_base64 text,
status text not null check (in ('uploaded', 'parsed', 'matched', 'error')) default 'uploaded',
error_message text,
created_at timestamptz,
unique (user_id, sha256)          -- deduplication
```

**completed_activities**
```sql
id uuid primary key,
user_id uuid not null references auth.users(id),
upload_id uuid references activity_uploads(id),
sport_type text not null,
start_time_utc timestamptz not null,
end_time_utc timestamptz,
duration_sec integer not null check (>= 0),
distance_m numeric(10,2),
avg_hr integer,
avg_power integer,
calories integer,
source text not null default 'upload',
parse_summary jsonb not null default '{}',
-- v2 metrics columns:
moving_duration_sec integer,
elapsed_duration_sec integer,
pool_length_m numeric(6,2),
laps_count integer,
avg_pace_per_100m_sec integer,
best_pace_per_100m_sec integer,
avg_stroke_rate_spm integer,
avg_swolf integer,
avg_cadence integer,
max_hr integer,
max_power integer,
elevation_gain_m integer,
elevation_loss_m integer,
activity_type_raw text,
activity_subtype_raw text,
activity_vendor text,
metrics_v2 jsonb not null default '{}',   -- comprehensive structured metrics
created_at timestamptz
```

**`metrics_v2` JSONB structure** (populated by `lib/workouts/activity-parser.ts`):
- Power: avgPower, normalizedPower, maxPower, variabilityIndex, intensityFactor, totalWorkKj
- Heart rate: avgHr, maxHr, thresholdHr, HR zone summaries
- Cadence: avgCadence, maxCadence, totalCycles
- Swim-specific: avgPacePer100mSec, bestPacePer100mSec, avgStrokeRateSpm, avgSwolf, poolLengthM, lapsCount
- Run-specific: avgPaceSecPerKm, bestPaceSecPerKm, normalizedGradedPaceSecPerKm, elevationGain/Loss
- Training load: trainingStressScore, aerobicTrainingEffect, anaerobicTrainingEffect, recoveryTimeSec
- Zone summaries for power, HR, and pace
- Lap details and split metrics (first/second half comparisons)

**session_activity_links**
```sql
id uuid primary key,
user_id uuid not null references auth.users(id),
planned_session_id uuid not null references sessions(id),  -- migrated FK
completed_activity_id uuid not null references completed_activities(id),
link_type text not null check (in ('auto', 'manual')),
confidence numeric(3,2),
confirmation_status text check (in ('suggested', 'confirmed', 'rejected')),
match_reason jsonb,
created_at timestamptz,
unique (completed_activity_id)
```

**ai_conversations**
```sql
id uuid primary key,
user_id uuid not null references auth.users(id),
athlete_id uuid references profiles(id),  -- added for coach ownership RLS
title text not null,
last_response_id text,            -- OpenAI response ID for continuation
created_at timestamptz, updated_at timestamptz
```

**ai_messages**
```sql
id uuid primary key,
conversation_id uuid not null references ai_conversations(id),
user_id uuid not null references auth.users(id),
role text not null check (in ('user', 'assistant')),
content text not null,
response_id text,                 -- OpenAI response ID
previous_response_id text,
model text,
created_at timestamptz
```

**coach_plan_change_proposals**
```sql
id uuid primary key,
athlete_id uuid not null references profiles(id),
user_id uuid not null references auth.users(id),
target_session_id uuid references sessions(id),
title text not null,
rationale text not null,
change_summary text not null,
proposed_date date,
proposed_duration_minutes integer check (> 0),
status text not null default 'pending' check (in ('pending', 'approved', 'rejected')),
created_at timestamptz, updated_at timestamptz
```

**weekly_debriefs**
```sql
id uuid primary key,
athlete_id uuid not null references profiles(id),
user_id uuid not null references auth.users(id),
week_start date not null,
week_end date not null,
status text not null check (in ('ready', 'stale', 'failed')),
source_updated_at timestamptz not null,
generated_at timestamptz not null default now(),
generation_version integer not null default 1,
facts jsonb not null default '{}',
narrative jsonb not null default '{}',
coach_share jsonb not null default '{}',
helpful boolean,
accurate boolean,
feedback_note text,
feedback_updated_at timestamptz,
created_at timestamptz, updated_at timestamptz,
unique (athlete_id, week_start)
```

**completed_sessions** (legacy ingestion table)
```sql
id uuid primary key,
user_id uuid not null references auth.users(id),
garmin_id text,
date date not null,
sport text not null,
metrics jsonb not null default '{}',
completion_status text default 'completed',
source text default 'tcx_import',
source_file_name text,
source_hash text,
created_at timestamptz, updated_at timestamptz
```

**recovery_logs** (legacy)
```sql
id uuid primary key,
user_id uuid not null references auth.users(id),
date date not null,
sleep_hours numeric(4,2),
fatigue_level int check (1-5),
soreness_areas text[],
created_at timestamptz,
unique (user_id, date)
```

**ingestion_events** (legacy upload tracking)
```sql
id uuid primary key,
user_id uuid not null references auth.users(id),
source text not null,
file_name text,
source_hash text,
status text not null check (in ('success', 'partial', 'failed')),
imported_count integer, failed_count integer,
error_message text,
raw_payload jsonb,
created_at timestamptz
```

### 8B. Proposed new tables

These tables support new features and follow existing conventions (RLS, snake_case, JSONB for complex data, `user_id`/`athlete_id` FK patterns).

**adaptations** (for Section 6B)
```sql
-- NEW: Adaptation Engine
create table public.adaptations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_id uuid references public.training_weeks(id) on delete set null,
  trigger_type text not null check (trigger_type in (
    'session_skipped', 'duration_short', 'fatigue_checkin', 'manual_request'
  )),
  trigger_session_id uuid references public.sessions(id) on delete set null,
  options jsonb not null default '[]'::jsonb,
  selected_option integer,
  status text not null default 'suggested' check (status in ('suggested', 'applied', 'dismissed')),
  model_used text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
-- RLS: athlete_id = auth.uid()
```

**session_feels** (for Section 6C)
```sql
-- NEW: Post-Session Feel Capture
create table public.session_feels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  rpe smallint not null check (rpe >= 1 and rpe <= 10),
  note text,
  was_prompted boolean not null default true,
  created_at timestamptz not null default now(),
  unique (session_id)
);
-- RLS: user_id = auth.uid()
```

### 8C. Row Level Security pattern

All tables follow this RLS pattern:
```sql
alter table public.[table_name] enable row level security;

-- For tables using user_id:
create policy "[table]_select_own" on public.[table] for select using (auth.uid() = user_id);
create policy "[table]_insert_own" on public.[table] for insert with check (auth.uid() = user_id);
create policy "[table]_update_own" on public.[table] for update using (auth.uid() = user_id);

-- For tables using athlete_id (where athlete_id = auth.uid()):
create policy "[table]_select_own" on public.[table] for select using (athlete_id = auth.uid());

-- For nested tables (training_weeks via training_plans):
create policy "[table]_select_own" on public.[table] for select
  using (exists (select 1 from training_plans tp where tp.id = [table].plan_id and tp.user_id = auth.uid()));
```

### 8D. Key indexes

```sql
-- Existing indexes (representative selection):
create index training_plans_user_id_idx on training_plans(user_id);
create index sessions_plan_id_idx on sessions(plan_id);
create index sessions_week_id_idx on sessions(week_id);
create index sessions_user_id_idx on sessions(user_id);
create index sessions_date_idx on sessions(date);
create index sessions_week_day_order_idx on sessions(week_id, date, day_order);
create index completed_activities_user_start_idx on completed_activities(user_id, start_time_utc desc);
create index session_activity_links_user_idx on session_activity_links(user_id);
create index ai_conversations_user_id_updated_at_idx on ai_conversations(user_id, updated_at desc);
create index ai_messages_conversation_id_created_at_idx on ai_messages(conversation_id, created_at);
create index weekly_debriefs_athlete_week_idx on weekly_debriefs(athlete_id, week_start desc);
create index athlete_checkins_athlete_week_idx on athlete_checkins(athlete_id, week_start desc);
create index athlete_observed_patterns_athlete_last_observed_idx on athlete_observed_patterns(athlete_id, last_observed_at desc);
```

---

## 9. Design System & Visual Language

### 9A. Color system

The app uses a **dark theme only** with CSS custom properties defined in `globals.css`. No light mode.

**Core palette (from actual CSS variables):**

| Role | Variable | Value | Usage |
|---|---|---|---|
| Background (base) | `--color-base` | `#0a0a0b` | Page background |
| Background (surface) | `--color-surface` | `#111114` | Card backgrounds |
| Background (raised) | `--color-surface-raised` | `#18181c` | Hover states, nested surfaces |
| Background (overlay) | `--color-surface-overlay` | `#1f1f25` | Elevated overlays |
| Accent (primary) | `--color-accent` | `#beff00` | CTAs, active states, key metrics |
| Accent (muted) | `--color-accent-muted` | `rgba(190, 255, 0, 0.08)` | Accent backgrounds |
| Success | `--color-success` | `#34d399` | Completion badges |
| Warning | `--color-warning` | `#ffb43c` | Attention badges |
| Danger | `--color-danger` | `#ff5a28` | Missed sessions, errors |
| Info | `--color-info` | `#63b3ed` | Informational elements |

**Text hierarchy (opacity-based):**

| Level | Variable | Value |
|---|---|---|
| Primary | `--color-text-primary` | `rgba(255, 255, 255, 1)` |
| Secondary | `--color-text-secondary` | `rgba(255, 255, 255, 0.65)` |
| Tertiary | `--color-text-tertiary` | `rgba(255, 255, 255, 0.35)` |
| Disabled | `--color-text-disabled` | `rgba(255, 255, 255, 0.2)` |

**Border system (opacity-based, not hex):**

| Level | Variable | Value |
|---|---|---|
| Subtle | `--border-subtle` | `rgba(255, 255, 255, 0.06)` |
| Default | `--border-default` | `rgba(255, 255, 255, 0.12)` |
| Strong | `--border-strong` | `rgba(255, 255, 255, 0.18)` |
| Accent | `--border-accent` | `rgba(190, 255, 0, 0.22)` |

**Sport colors:**

| Sport | Variable | Value | Usage |
|---|---|---|---|
| Run | `--color-run` | `#ff5a28` (coral) | Session cards, calendar badges, chart segments |
| Swim | `--color-swim` | `#63b3ed` (blue) | Session cards, calendar badges, chart segments |
| Bike | `--color-bike` | `#34d399` (emerald) | Session cards, calendar badges, chart segments |
| Strength | `--color-strength` | `#a78bfa` (purple) | Session cards, calendar badges, chart segments |

### 9B. Typography

**Fonts:** Geist Sans (primary), Geist Mono (metrics/stats)

Configured in `tailwind.config.ts`:
```typescript
fontFamily: {
  sans: ["var(--font-geist-sans)", "sans-serif"],
  mono: ["var(--font-geist-mono)", "monospace"]
}
```

**Base:** 14px body, line-height 1.6, antialiased

**Heading weight:** All headings use `font-weight: 500 !important` (medium, not bold — a deliberate design choice)

**Labels:** 11px, font-weight 500, letter-spacing 0.08em, uppercase, accent color. Class: `.label`, `.priority-kicker`

**Stats/metrics:** Geist Mono via `.stat` class (13px, monospace). Variants: `.stat--accent`, `.stat--success`, `.stat--warning`

### 9C. Border radius tokens

| Token | Value |
|---|---|
| `--radius-sm` | 6px |
| `--radius-md` | 10px |
| `--radius-lg` | 14px |
| `--radius-xl` | 20px |
| `--radius-full` | 9999px |

### 9D. Motion tokens

| Token | Value |
|---|---|
| `--motion-fast` | 150ms |
| `--motion-standard` | 180ms |
| `--motion-ease` | ease |

Respects `prefers-reduced-motion: reduce`.

### 9E. Component patterns (from `globals.css` @layer components)

**Cards:**
- `.surface` — primary card (surface bg, subtle border, radius-md, no shadow)
- `.surface-subtle` — subdued card (raised bg, radius-sm)
- `.surface-overlay` — elevated card (overlay bg, default border)
- `.priority-card-primary/secondary/emphasis` — 20px padding, surface bg
- `.priority-card-supporting` — 16px padding, raised bg
- `.next-action-card` — left accent bar (2px lime), default border

**Buttons:**
- `.btn-primary` — accent bg, dark text
- `.btn-secondary` — accent border, accent-muted bg, accent text
- `.btn-ghost` — transparent, secondary text
- `.btn-header-cta` — same as secondary, header-specific

**Status chips:**
- `.signal-ready` / `.status-chip-completed` — success green
- `.signal-load` — warning amber
- `.signal-risk` / `.status-chip-skipped` — warning amber
- `.signal-recovery` — info blue
- `.signal-neutral` / `.status-chip-planned` — muted
- `.pill-accent` — accent border, accent text
- `.pill-accent-soft` — default border, secondary text

**Discipline badges:**
- `.discipline-swim` / `.chip--swim` — blue (63b3ed)
- `.discipline-bike` / `.chip--bike` — emerald (34d399)
- `.discipline-run` / `.chip--run` — coral (ff5a28)
- `.discipline-strength` / `.chip--strength` — purple (a78bfa)
- Texture variants: `.discipline-texture-solid`, `.discipline-texture-dashed`, `.discipline-texture-dot-grid`

**Debrief-specific:**
- `.debrief-hero` — accent radial gradient overlay
- `.debrief-metric-card` — min-height 110px, radius 18px
- `.debrief-section-card` — subtle gradient, radius 18px
- `.debrief-list-card` — with positive (green left border) and notice (amber left border) variants
- `.debrief-carry-card` — accent border, accent gradient
- `.debrief-kicker` — 10px, letter-spacing 0.16em, uppercase, tertiary color

**Navigation:**
- `.nav-item-active` — accent bg (0.06 opacity), white text, 2px accent left bar

### 9F. Shareable card design specifics

The shareable weekly summary card must have these brand-signature elements:
- Dark background matching `--color-base` (`#0a0a0b`)
- Lime accent (`--color-accent`: `#beff00`)
- The daily discipline-stacked bar chart as the centerpiece visual using sport colors
- tri.ai wordmark (clean, modern, lowercase)
- Compact, high-density layout
- Race goal and countdown

---

## 10. Implementation Priorities

### Phase 1: Foundation Improvements (Weeks 1-2)

| Task | Surface | Effort | Impact | Key Files |
|---|---|---|---|---|
| Dashboard simplification (3-zone layout) | Dashboard | Medium | High | `app/(protected)/dashboard/` |
| Information deduplication audit | All | Low | High | Cross-surface review |
| Macro-arc context computed function | Backend | Medium | High | New: `lib/training/macro-context.ts` |
| Macro-arc display in Debrief header | Debrief | Low | Medium | `app/(protected)/debrief/page.tsx` |
| Macro-arc mention in Coach briefing | Coach | Low | Medium | `lib/coach/tool-handlers.ts` |
| Coach thread cleanup and grouping | Coach | Low | Medium | `app/(protected)/coach/components/coach-chat.tsx` |

### Phase 2: New Features — Core (Weeks 3-5)

| Task | Surface | Effort | Impact | Key Files |
|---|---|---|---|---|
| Adaptation engine (rules + AI) | Calendar, Backend, AI | High | Critical | New: `lib/training/adaptation-rules.ts`, `app/api/coach/adaptation/route.ts`, calendar component |
| Post-session feel capture | Session Review | Low | Medium | New: `session_feels` migration, session review banner component |
| Session comparison (Tier 1: vs last time) | Session Review | Medium | High | New: `lib/training/session-comparison.ts`, comparison card component |
| Week Ahead preview generation | Dashboard, Backend, AI | Medium | High | New: `app/api/weekly-debrief/week-ahead/route.ts`, dashboard card |
| Check-in data integration into AI prompts | Coach, Backend | Low-Med | Medium | `lib/coach/tool-handlers.ts`, `lib/weekly-debrief.ts` |

### Phase 3: New Features — Enhancement (Weeks 6-8)

| Task | Surface | Effort | Impact | Key Files |
|---|---|---|---|---|
| Shareable weekly summary card | Debrief | Medium | High (growth) | New: canvas renderer component on debrief page |
| Multi-week trend detection (Tier 2) | Debrief, Coach | Medium | High | New: `lib/training/trends.ts` |
| Plan view elevation (load shape viz, key indicators) | Plan | Medium | Medium | `app/(protected)/plan/` components |
| Ambient check-in intelligence | Backend, AI | Medium | Medium | `lib/training/ambient-signals.ts`, `athlete_observed_patterns` |
| Execution score explanation | Session Review | Low | Low-Med | Session review expandable component |

### Phase 4: Future Horizon (Weeks 9+)

| Task | Notes |
|---|---|
| Garmin auto-sync | Replace manual upload with webhook/polling — no code exists yet |
| Human coach collaboration on Plan | Multi-user editing, coach annotations, shared plan view |
| Native mobile app | Push contextual awareness to notifications |
| Multi-athlete support | Coach manages multiple athletes through one interface |
| Race-week and taper intelligence | Specialized AI logic for final 2-3 weeks before race day |
| Post-race analysis | Full training block retrospective |
| Training plan generation | AI-assisted plan creation from scratch |

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| Execution score | Rating of how well an actual session matched its planned intent |
| Session match | Linkage between a planned session and a completed activity (via `session_activity_links`) |
| Key session | A planned session where `sessions.is_key = true` |
| Session role | Classification: `key`, `supporting`, `recovery`, `optional` (from `sessions.session_role`) |
| TSS | Training Stress Score — composite load metric from power data |
| IF | Intensity Factor — ratio of normalized power to FTP |
| NP | Normalized Power — weighted average power accounting for variability |
| RPE | Rate of Perceived Exertion — subjective effort scale (1-10) |
| Block | A multi-week training phase (Build, Recovery, Taper, Race, Custom) — derived from `training_weeks.focus` |
| Macro arc | The full training timeline from current date to race day |
| Adaptation | An AI-suggested modification to the remaining week's plan when the original plan is disrupted |
| Ambient signal | Subjective athlete data inferred from behavior rather than explicit input |
| Debrief | The comprehensive end-of-week AI-generated coaching summary (stored in `weekly_debriefs`) |
| Coach briefing | The coach page's top-level status summary |
| metrics_v2 | Comprehensive structured metrics JSONB on `completed_activities` |

## Appendix B: Actual file/route structure

```
app/
├── (protected)/                          # Auth-gated route group
│   ├── layout.tsx                        # App shell with nav
│   ├── components/
│   │   ├── app-shell.tsx
│   │   ├── global-header.tsx             # Sticky header with race countdown
│   │   ├── shell-nav.tsx                 # Responsive sidebar + mobile bottom nav
│   │   ├── account-menu.tsx
│   │   ├── page-header.tsx
│   │   ├── status-strip.tsx
│   │   ├── details-accordion.tsx
│   │   └── week-context.ts              # Date utilities (getMonday, addDays, etc.)
│   ├── dashboard/
│   │   ├── page.tsx
│   │   ├── actions.ts
│   │   └── components/
│   │       ├── progress-glance-card.tsx
│   │       ├── week-progress-card.tsx
│   │       ├── weekly-debrief-card.tsx
│   │       ├── next-action-copy.ts
│   │       └── tcx-upload-form.tsx
│   ├── calendar/
│   │   ├── page.tsx
│   │   ├── actions.ts
│   │   └── components/
│   │       ├── week-calendar.tsx
│   │       └── week-calendar.test.tsx
│   ├── plan/
│   │   ├── page.tsx
│   │   ├── builder/page.tsx
│   │   ├── actions.ts
│   │   └── components/
│   │       └── plan-editor.tsx
│   ├── coach/
│   │   ├── page.tsx
│   │   ├── actions.ts
│   │   └── components/
│   │       ├── coach-chat.tsx
│   │       └── weekly-checkin-card.tsx
│   ├── debrief/
│   │   ├── page.tsx
│   │   ├── coach/page.tsx
│   │   ├── actions.ts
│   │   └── components/
│   │       ├── debrief-feedback-card.tsx
│   │       └── debrief-refresh-button.tsx
│   ├── sessions/
│   │   ├── [sessionId]/page.tsx
│   │   └── activity/[activityId]/page.tsx
│   ├── activities/
│   │   └── [activityId]/
│   │       ├── page.tsx
│   │       └── components/
│   │           └── activity-linking-card.tsx
│   └── settings/
│       ├── page.tsx
│       ├── race/page.tsx
│       ├── integrations/page.tsx
│       ├── athlete-context/page.tsx
│       └── components/
│           ├── athlete-context/athlete-context-form.tsx
│           └── integrations/
│               ├── activity-uploads-panel.tsx
│               ├── activity-metrics-backfill-button.tsx
│               └── review-backfill-button.tsx
├── api/
│   ├── coach/
│   │   ├── chat/route.ts                 # Streaming coach chat (SSE)
│   │   ├── review-backfill/route.ts      # Batch session review backfill
│   │   └── weekly-brief-refresh/route.ts # Refresh weekly briefing
│   ├── weekly-debrief/
│   │   ├── refresh/route.ts              # Generate weekly debrief
│   │   └── feedback/route.ts             # Save debrief feedback
│   ├── uploads/
│   │   └── activities/
│   │       ├── route.ts                  # GET list / POST upload
│   │       ├── backfill/route.ts         # Backfill activity metrics
│   │       └── [uploadId]/
│   │           ├── route.ts              # DELETE upload
│   │           └── attach/route.ts       # Manual activity-to-session link
│   ├── sessions/
│   │   └── [sessionId]/
│   │       └── review/
│   │           └── regenerate/route.ts   # Regenerate session review
│   ├── athlete-context/route.ts          # Save athlete context
│   ├── athlete-checkin/route.ts          # Save weekly check-in
│   └── health/route.ts                   # Health check
├── auth/
│   ├── sign-in/page.tsx
│   ├── sign-up/page.tsx
│   ├── forgot-password/page.tsx
│   ├── update-password/page.tsx
│   └── callback/route.ts
├── globals.css                           # Design system + component styles
├── layout.tsx                            # Root layout with fonts
└── page.tsx                              # Landing page

lib/
├── coach/
│   ├── instructions.ts                   # System prompt + structuring instructions
│   ├── tools.ts                          # 7 coach tools with Zod schemas
│   ├── tool-handlers.ts                  # Tool execution logic
│   ├── auth.ts                           # Coach auth context resolution
│   ├── audit.ts                          # Interaction logging
│   ├── session-diagnosis.ts              # Session execution analysis
│   └── workout-summary.ts               # Workout summarization
├── workouts/
│   ├── activity-parser.ts                # FIT/TCX parsing, SHA256, metrics extraction
│   ├── activity-matching.ts              # Score-based session matching
│   ├── matching-service.ts               # Matching orchestration
│   ├── tcx.ts                            # TCX-specific parsing
│   ├── session-execution.ts              # Execution verdict generation
│   └── activity-metrics-backfill.ts      # Batch metrics updates
├── training/
│   ├── semantics.ts                      # Session naming from metadata
│   ├── session.ts                        # Session display names
│   ├── week-metrics.ts                   # Weekly volume computation
│   └── week-metrics.test.ts
├── security/
│   ├── rate-limit.ts                     # Upstash Redis rate limiting
│   └── request.ts                        # IP/origin validation
├── supabase/
│   ├── server.ts                         # Request-scoped Supabase client
│   └── browser.ts                        # Client-side Supabase
├── ui/
│   ├── discipline.ts                     # Sport metadata (colors, shapes)
│   ├── sparse-data.ts                    # Data completeness analysis
│   └── status-chip.tsx                   # Status badge component
├── athlete-context.ts                    # AthleteContextSnapshot builder
├── weekly-debrief.ts                     # Debrief generation logic
├── execution-review.ts                   # Session review generation
├── session-review.ts                     # Session-level reviews
├── date/iso.ts                           # ISO date formatting
├── time/week.ts                          # Week calculations
├── calendar/day-items.ts                 # Calendar display logic
├── activities/completed-activities.ts    # Activity aggregation
└── agent-preview/                        # Dev-only mock system
    ├── config.ts
    ├── client.ts                         # Mock Supabase client
    └── data.ts                           # Seeded test data

// NEW files needed for feature implementation:
// lib/training/macro-context.ts          # Phase 1: Macro-arc context computation
// lib/training/adaptation-rules.ts       # Phase 2: Adaptation constraints
// lib/training/session-comparison.ts     # Phase 2: Session-to-session comparison
// lib/training/trends.ts                 # Phase 3: Multi-week trend detection
// lib/training/ambient-signals.ts        # Phase 3: Ambient check-in intelligence
// app/api/coach/adaptation/route.ts      # Phase 2: Adaptation API
// app/api/weekly-debrief/week-ahead/route.ts  # Phase 2: Week ahead preview

supabase/
└── migrations/                           # 19 migration files (chronological)

Configuration:
├── next.config.mjs                       # Security headers (CSP, HSTS)
├── tailwind.config.ts                    # Custom colors, spacing, radius
├── middleware.ts                         # Auth gate + security headers
├── tsconfig.json
├── jest.config.ts
├── .env.example                          # Required env vars
└── package.json
```

---

*This spec is a living document aligned with the actual codebase as of March 15, 2026. Update it as decisions are made and features ship.*
