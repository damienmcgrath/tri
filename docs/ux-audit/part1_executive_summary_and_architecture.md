# tri.ai UX Flow Analysis & Architecture Audit

## Part 1: Executive Summary & Codebase Architecture Map

**Date:** 2026-04-06
**Scope:** Full JTBD flow analysis across all surfaces of the tri.ai web application
**Method:** Source code inspection of routes, components, data flows, and navigation paths

---

## 1. Executive Summary

### The Core Finding

tri.ai has built **exceptional training intelligence** — Session Verdicts, Execution Scores, Adaptation Rationales, Training Scores, Discipline Balance, Multi-Week Comparisons, Feel Capture, Weekly Debriefs, Morning Briefs, Week Transition Briefings, and a grounded AI Coach. The data model is sophisticated and the AI pipeline is well-engineered.

**The problem is not the intelligence. The problem is the information architecture.**

The app's six surfaces (Dashboard, Plan, Calendar, Coach, Session Review, Weekly Debrief) are organised around *what the system produces* rather than *what the athlete needs in the moment*. An athlete who just finished a run and wants to understand what it means for their week must navigate: Upload (Settings/Integrations or Strava sync) → Session Review (`/sessions/[id]`) → Feel Capture (same page) → Dashboard (week progress) → Calendar (upcoming sessions) → possibly Coach (to ask a question). That's 4-5 surface transitions for a single post-workout moment.

### Top 3 Friction Points

1. **Post-upload is a dead end.** After a FIT/TCX upload or Strava sync, there is no guided flow from "upload complete" to "I understand what this means." The athlete must manually navigate to `/sessions/[id]` to see the verdict, then separately check the Dashboard for week impact. The adaptation signal in the Session Verdict card has no forward link to the Calendar or Coach. *(Affects Moments 3, 4, 5)*

2. **The Dashboard is dense but not adaptive.** The Dashboard shows week progress, today's sessions, transition briefings, training score, trends, and the weekly debrief card — all at once, regardless of context. On Monday morning it shows the same layout as Wednesday afternoon. The Morning Brief is commented out (`// import { MorningBriefCard }`). The Transition Briefing only appears Mon-Tue. There is no context-aware prioritisation of what the athlete needs *right now*. *(Affects Moments 1, 4, 9)*

3. **Session context is fragmented across 3 surfaces.** To fully understand a single session, an athlete needs: the Plan surface (purpose, block context, intensity classification), the Calendar surface (where it sits in the week, adaptation rationale), and the Session Review surface (verdict, feel, comparison). No single surface provides the complete picture. *(Affects Moments 2, 3, 7)*

### Top 3 Recommended Changes

1. **Post-upload guided flow** (Hypothesis D) — After activity sync/upload, enter a linear overlay: Upload Confirmation → Feel Capture → Session Verdict → Adaptation Preview → "Back to Dashboard." Removes 3-4 navigation steps from Moment 3. **Effort: Medium. Impact: Critical.**

2. **Context-aware Dashboard states** (Hypothesis A) — The Dashboard should detect the athlete's current moment and promote the most relevant content: post-upload → show verdict; Monday morning → show transition + week preview; mid-week → show score + progress; end-of-week → promote debrief. **Effort: Large. Impact: High.**

3. **Ambient Coach entry points** (Hypothesis E) — Add contextual "Ask about this" triggers on Session Review, Calendar adaptation cards, Dashboard score, and Plan discipline balance. Opens Coach with pre-loaded context. Currently the Coach is only accessible via the nav tab or the "Ask tri.ai" header button. **Effort: Medium. Impact: High.**

---

## 2. Codebase Architecture Map

### 2a. Route Structure

The app uses Next.js 14 App Router with a `(protected)` route group for all auth-gated pages.

#### Protected Pages (require auth)

| Route | Surface | Key Data | Primary Components |
|-------|---------|----------|--------------------|
| `/dashboard` | Dashboard | sessions, activities, links, profile, training_score, weekly_debrief, trends, week_transition | WeekNavigator, WeekProgressCard, TrainingScoreCard, WeeklyDebriefCard, TransitionBriefingCard, TrendCards, WeekAheadCard |
| `/plan` | Plan | training_plans, training_weeks, sessions | PlanEditor (with SeasonTimeline, BlockOverview, DisciplineDistributionChart, IntensityBar, RebalancingCard) |
| `/plan/builder` | Plan Settings | training_plans | Plan creation form |
| `/calendar` | Calendar | sessions, completed_activities, session_activity_links, adaptations, adaptation_rationales | WeekCalendar, CoachNoteCards |
| `/coach` | Coach | diagnosed_sessions, athlete_context, weekly_execution_brief, week_transition_briefing | CoachChat, CoachBriefingCard, WeeklyCheckinCard, TransitionBriefingCard |
| `/sessions/[sessionId]` | Session Review | session, completed_activities, execution_result, session_feels, session_verdicts, session_comparisons | FeelCaptureBanner, SessionVerdictCard, SessionComparisonCard, RegenerateReviewButton |
| `/sessions/activity/[activityId]` | Activity Review | completed_activity, execution_result | Redirect or activity-based review |
| `/activities/[activityId]` | Activity Details | activity details, metrics_v2 | ActivityLinkingCard, zone breakdowns, lap data |
| `/debrief` | Weekly Debrief | weekly_debrief snapshot, macro_context, adjacent debriefs | Debrief narrative, metrics, evidence, DebriefFeedbackCard, ShareSummaryButton |
| `/debrief/coach` | Debrief Coach Share | weekly_debrief snapshot | Coach-shareable debrief view |
| `/settings` | Settings Hub | — | Navigation links to sub-pages |
| `/settings/race` | Race Settings | profile, race_profiles | RaceProfileList, countdown form |
| `/settings/athlete-context` | Athlete Context | athlete_context snapshot, profile | AthleteContextForm |
| `/settings/integrations` | Integrations | activity_uploads, completed_activities, links, sessions | ConnectedServices, ActivityUploadsPanel, StravaConnectionCard, SyncHistory |
| `/settings/locale` | Locale | profile locale/units/timezone | Language, units, timezone selectors |

#### Auth Pages (public)

| Route | Purpose |
|-------|---------|
| `/auth/sign-in` | Email/password + magic link sign-in |
| `/auth/sign-up` | Account creation |
| `/auth/forgot-password` | Password reset request |
| `/auth/update-password` | Password update |
| `/auth/callback` | OAuth/reset callback handler |

#### API Routes (30+)

Key API routes by domain:

- **Coach:** `POST /api/coach/chat` (streaming), `/api/coach/adaptation`, `/api/coach/weekly-brief-refresh`, `/api/coach/review-backfill`
- **Sessions:** `/api/session-feels`, `/api/session-verdicts`, `/api/sessions/[id]/review/regenerate`
- **Uploads:** `/api/uploads/activities` (upload), `/api/uploads/activities/[id]/attach` (link to session)
- **Training:** `/api/training-score`, `/api/intensity-profiles`, `/api/discipline-balance`, `/api/training-load/backfill`
- **Weekly:** `/api/weekly-debrief/refresh`, `/api/weekly-debrief/feedback`, `/api/weekly-debrief/week-ahead`
- **Transitions:** `/api/week-transition`, `/api/morning-brief`
- **Strava:** `/api/integrations/strava/{connect,callback,disconnect,sync,settings,webhook}`
- **Seasons:** `/api/seasons`, `/api/seasons/periodize`, `/api/race-profiles`

### 2b. Navigation Architecture

**Global Navigation (4 tabs):**
- Dashboard (`/dashboard`)
- Plan (`/plan`)
- Calendar (`/calendar`)
- Coach (`/coach`) — visually de-emphasised in nav

**Defined in:** `app/(protected)/shell-nav.tsx`
- Desktop: `ShellNavRail` in left sidebar (compact icons on lg, full labels on xl)
- Mobile: `MobileBottomTabs` fixed bottom bar, 4-column grid

**Global Header:** `app/(protected)/global-header.tsx`
- Logo, race countdown badge, "Ask tri.ai" CTA button → `/coach`, AccountMenu

**Notable navigation gaps:**
- No tab for Debrief (`/debrief`) — accessed only via WeeklyDebriefCard on Dashboard
- No tab for Session Review (`/sessions/[id]`) — accessed only via Calendar session cards or Dashboard links
- No tab for Settings — accessed only via AccountMenu dropdown
- No breadcrumbs on any page
- No "back" navigation from Session Review to Calendar or Dashboard
- Coach is de-emphasised (`deemphasized: true` in navItems) with lower opacity

### 2c. Component Reuse Map

**Cross-surface components:**
- `TransitionBriefingCard` — appears on both Dashboard and Coach page
- `DebriefRefreshButton` — appears on Dashboard (WeeklyDebriefCard) and Debrief page
- `DetailsAccordion` — appears on Session Review and Debrief pages
- `getDisciplineMeta()` / `getSessionDisplayName()` — utility functions used everywhere

**Surface-specific components (no reuse):**
- `FeelCaptureBanner` — only on Session Review
- `SessionVerdictCard` — only on Session Review
- `SessionComparisonCard` — only on Session Review
- `CoachBriefingCard` — only on Coach page
- `WeekCalendar` — only on Calendar page
- `PlanEditor` — only on Plan page
- `TrainingScoreCard` — only on Dashboard
- `ShareSummaryButton` / `ShareCardModal` — only on Debrief page

### 2d. Data Flow Map

#### Flow 1: Activity Upload → Session Verdict → Adaptation

```
FIT/TCX Upload or Strava Sync
    ↓
activity-parser.ts → ParsedActivity
    ↓
activity-matching.ts → score against planned sessions (≥0.85 auto-link)
    ↓
completed_activities (INSERT) + session_activity_links (INSERT)
    ↓
session-execution.ts → buildExecutionEvidence()
    ↓
session-diagnosis.ts → ComponentScores (intentMatch, pacing, completion, recovery)
    ↓
execution-review.ts → generateCoachVerdict() → PersistedExecutionReview
    ↓
session_verdicts (UPSERT) + sessions.execution_result (UPDATE)
    ↓
[NO AUTOMATIC FORWARD NAVIGATION]
Athlete must manually navigate to /sessions/[id] to see verdict
```

**Critical gap:** After upload, the athlete lands back on `/settings/integrations` (for manual upload) or gets no notification (for Strava sync). There is no guided path to the verdict.

#### Flow 2: Feel Capture → Verdict Enrichment

```
Athlete navigates to /sessions/[sessionId]
    ↓
FeelCaptureBanner renders (if no existing feel)
    ↓
Athlete taps feel (1-5 scale) + optional secondary attributes
    ↓
POST /api/session-feels → session_feels (INSERT)
    ↓
[Feel data is available to execution-review but NOT automatically re-processed]
[Verdict card on same page may already be rendered with stale data]
```

**Gap:** Feel capture and verdict are on the same page but not linked in real-time. The verdict doesn't automatically refresh when feel is captured.

#### Flow 3: Session Verdict → Training Score → Multi-Week Comparison

```
session_verdicts (from execution-review.ts)
    ↓
training/scoring.ts → Execution Quality dimension (40% of composite)
    ↓
session-comparison.ts → compare to prior similar sessions → Progression Signal (30%)
    ↓
discipline-balance.ts → Balance Score (30%)
    ↓
training_scores (UPSERT) → composite 0-100
    ↓
Displayed on Dashboard via TrainingScoreCard (current week only)
```

**Gap:** Training Score is only visible on the Dashboard. Not shown on Session Review (where the athlete just completed work) or Calendar (where the athlete plans work).

#### Flow 4: Adaptation Rationale → Calendar → Coach

```
adaptation-rules.ts evaluates triggers (missed session, fatigue, etc.)
    ↓
adaptation_rationales (INSERT with trigger_type, rationale_text, changes_summary)
    ↓
Calendar page fetches pending rationales (top 5)
    ↓
CoachNoteCards renders above WeekCalendar
    ↓
"Got it" button → PATCH /api/adaptation-rationales (acknowledge)
"Let's discuss" → /coach (no pre-loaded context about the rationale)
```

**Gap:** "Let's discuss" link goes to `/coach` without passing the rationale context. The Coach page doesn't know which rationale the athlete wants to discuss.

#### Flow 5: Morning Brief → Dashboard → Pending Actions

```
training/morning-brief.ts → generates brief with session_preview, readiness_context, pending_actions[]
    ↓
morning_briefs (UPSERT)
    ↓
[CURRENTLY DISABLED on Dashboard — MorningBriefCard import is commented out]
```

**Gap:** The Morning Brief generation code exists and works, but the UI component is commented out on the Dashboard. This entire intelligence layer is invisible to the athlete.

#### Flow 6: Discipline Balance → Plan → Rebalancing Recommendation

```
discipline-balance.ts → WeeklyDisciplineBalance (actual vs planned per sport)
    ↓
discipline-tradeoff.ts → rebalancing_recommendations (INSERT)
    ↓
Plan surface: RebalancingCard renders recommendations
    ↓
"Discuss with Coach" → /coach?context=rebalancing&sport={sport}
```

**Note:** This flow works well. The Coach deep-link includes context. However, the RebalancingCard is only on the Plan page — not visible from Dashboard or Calendar where the athlete makes daily decisions.

#### Flow 7: Season/Block Structure → Plan → Calendar → Dashboard

```
seasons + training_blocks → periodised plan structure
    ↓
Plan page: SeasonTimeline, BlockOverview, BlockContextCard
    ↓
Calendar page: NO block context shown (only sessions)
    ↓
Dashboard: Block label shown in WeekNavigator (if available)
```

**Gap:** The Calendar — where athletes make daily execution decisions — has no block context. The athlete can't see "I'm in Build Week 3 of 4" from the Calendar. They must go to Plan for that context.

### 2e. Database Tables Referenced

**37 user-facing tables** with RLS on all. Key tables by domain:

- **Planning:** training_plans, training_weeks, sessions, training_blocks, seasons, season_races
- **Execution:** completed_activities, activity_uploads, session_activity_links, completed_sessions (legacy)
- **Evaluation:** session_verdicts, session_feels, session_comparisons, session_intensity_profiles
- **Fitness:** session_load, daily_load, athlete_fitness, athlete_ftp_history
- **Analysis:** training_scores, weekly_intensity_summaries, discipline_balance_snapshots, rebalancing_recommendations
- **Coaching:** ai_conversations, ai_messages, coach_plan_change_proposals, adaptation_rationales, adaptations
- **Briefing:** weekly_debriefs, week_transition_briefings, morning_briefs
- **Profile:** profiles, athlete_context, athlete_checkins, athlete_observed_patterns, race_profiles
- **Integration:** external_account_connections, external_sync_log

---

*Continue to Part 2: Moment-by-Moment Analysis (Moments 1-5)*
