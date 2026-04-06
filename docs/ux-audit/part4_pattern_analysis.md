# tri.ai UX Flow Analysis & Architecture Audit

## Part 4: Cross-Moment Pattern Analysis

---

## 4a. Surface Load Imbalance

### Dashboard: Overloaded (7+ jobs)

The Dashboard currently serves:
1. Week volume progress (completion %, hours)
2. Today's session preview
3. Contextual signals (missed sessions, discipline gaps, execution patterns)
4. Training Score display
5. Transition Briefing (Mon/Tue only)
6. Weekly Debrief card (end of week)
7. Week Ahead preview (Sun/Mon only)
8. Trend cards

The Dashboard tries to be the answer to every moment (morning check-in, mid-week check, Monday transition, end-of-week reflection) by showing all content simultaneously. The result is a long scrolling page where time-sensitive content (transition briefing) competes with persistent content (week progress) and conditional content (debrief card).

**Diagnosis:** The Dashboard should be the single source of truth, but it needs to *prioritise* based on context rather than showing everything at once.

### Calendar: Correctly Loaded but Missing Context

The Calendar serves its primary job well (weekly session view with status) but lacks:
- Block/phase context (Build Week 3 of 4)
- Session purpose/intent inline
- Adaptation rationale inline with affected sessions
- Race markers

It's a schedule view when it should be an *execution command center*.

### Plan: Correctly Loaded for Strategy

The Plan surface appropriately handles:
- Multi-week structure (weeks, sessions, editing)
- Season timeline (blocks, races)
- Discipline balance (distribution chart, rebalancing)
- Intensity profiles

This is the right home for strategic decisions. The issue is that none of this context flows down to Calendar or Dashboard.

### Coach: Underutilised as a Surface

The Coach page renders briefing cards, execution summaries, athlete context, and a chat interface. The briefing content overlaps with Dashboard (TransitionBriefingCard appears on both). The chat interface is the core value, but it's buried below 4 cards on the page.

The Coach should be more of a *utility* (accessible from anywhere) than a *destination* (a dedicated tab you visit).

### Session Review: Pass-Through Surface

Athletes arrive at `/sessions/[id]` to see a verdict and capture a feel, then leave. There is no return path. It serves one job (post-session review) and serves it well, but it's a dead-end. The average time on this surface is likely very short.

### Weekly Debrief: Correctly Scoped

The Debrief page is well-scoped: comprehensive week synthesis with narrative, metrics, evidence, and sharing. It serves one moment (end-of-week reflection) thoroughly. The only issue is the lack of forward connection to next week.

### Settings/Integrations: Activity Upload is Misplaced

Activity upload lives in `/settings/integrations`, which is semantically a configuration surface. Upload is a high-frequency action (after every workout) buried in a low-frequency surface (settings). Strava sync mitigates this for connected users, but manual upload athletes are penalised.

---

## 4b. Data Fragmentation Map

### Single-question answers requiring 2+ surfaces

| Question | Data Sources | Surfaces Required | Frequency |
|----------|-------------|-------------------|-----------|
| "How did today's session go vs. what was planned?" | session (Plan), execution_result (Session Review), completed_activity metrics (Activity Details) | Calendar + Session Review + possibly Activity Details | **Daily** |
| "Am I on track this week, considering quality not just volume?" | completion % (Dashboard), execution quality (Training Score on Dashboard, but collapsed), discipline balance (Plan only), intensity mix (Plan only) | Dashboard + Plan | **2-3x/week** |
| "What is my session today and why?" | session name/duration (Dashboard/Calendar), intent_category + target (Session Review/Plan), block context (Plan), adaptation rationale (Calendar) | Dashboard + Calendar + Plan | **Daily** |
| "How does this week compare to last week?" | current week metrics (Dashboard), prior week debrief (Debrief), multi-week trends (Trend cards on Dashboard, partially) | Dashboard + Debrief | **Weekly** |
| "Should I adjust my plan because I'm feeling off?" | readiness/TSB (Coach tool only), recent execution (Coach briefing), this week's plan (Calendar) | Coach + Calendar | **Occasional** |
| "What's my balance across swim/bike/run?" | discipline balance snapshot (Plan), weekly load by sport (Calendar/Dashboard), rebalancing recommendations (Plan) | Plan + Dashboard | **Weekly** |
| "What changed in my plan and why?" | adaptation rationales (Calendar), coach proposals (Coach), session history (Plan) | Calendar + Coach + Plan | **After adaptations** |

### Most Fragmented Data (appears on wrong surface or no surface)

1. **Session intent/purpose** — Stored in `sessions.intent_category` and `sessions.target`. Available in the data fetch on Calendar and Dashboard, but NOT displayed prominently on either. Only fully visible on Session Review and Plan.

2. **Readiness state (TSB)** — Computed by `lib/training/fitness-model.ts`, used by Coach tools (`get_training_load`), feeds into morning-brief generation. NOT visible on any user-facing surface. The athlete never sees "you're fresh" or "you're fatigued."

3. **Discipline balance** — Computed by `lib/training/discipline-balance.ts`. Displayed ONLY on Plan surface. Not on Dashboard or Calendar where daily decisions happen.

4. **Adaptation rationale** — Stored in `adaptation_rationales` table. Displayed ONLY on Calendar (CoachNoteCards). Not on Dashboard (where athlete lands first) or Session Review (where the affected session is reviewed).

5. **Block context** — Stored in `training_weeks.focus` and `training_blocks`. Displayed on Plan (BlockOverview, SeasonTimeline) and Dashboard WeekNavigator (block label). NOT on Calendar weekly headers.

---

## 4c. Navigation Dead Ends

### Session Review → ???

After viewing the verdict and capturing feel on `/sessions/[sessionId]`, the athlete has:
- Browser back button
- Global nav tabs (Dashboard/Plan/Calendar/Coach)
- **No contextual "next" action**

Missing: "Back to Calendar" link, "View next session" link, "See week impact" CTA, "Ask Coach about this" button.

### Debrief → ???

After reading the weekly debrief on `/debrief?weekStart=...`, the athlete has:
- "Share" button (opens modal, not navigation)
- "Feedback" card (stays on page)
- Adjacent week navigation (not prominent)
- Global nav tabs

Missing: "View next week's plan" link, "Open this week's Calendar" link, "Discuss with Coach" button.

### Activity Details → ???

After viewing raw activity data on `/activities/[activityId]`, the athlete has:
- ActivityLinkingCard (to assign to planned session)
- Global nav tabs

Missing: Link to the matched session's review page, "Back to uploads" link.

### Post-Upload → ???

After uploading on `/settings/integrations`, the athlete sees the upload status table but has:
- No "View matched session" link
- No redirect to Session Review
- Must manually navigate to Calendar or Session Review

### Coach Conversation End → ???

After receiving a Coach answer, the athlete can:
- Ask a follow-up
- Start a new conversation
- Use global nav

Missing: Contextual links based on the Coach's response (e.g., if Coach discussed a session, link to that session).

---

## 4d. Moment Gaps — Unserved Athlete Needs

### Gap 1: "I'm injured and need to take a week off"

**Current:** No dedicated flow. Athlete must tell the Coach (who can advise but not execute), then manually skip each session on the Calendar one by one. No "pause plan" mechanism.

**Should exist:** A "Pause training" action on the Calendar or Dashboard that: marks all upcoming sessions as skipped for X days, generates an adaptation rationale, and adjusts the return-to-training plan.

### Gap 2: "My race is in 3 days — what should I be doing?"

**Current:** The Dashboard header shows "X days" to race. The Plan shows a Taper block (if one exists). But there's no race-week specific guidance. The Morning Brief (if it were enabled) could provide this, but it's disabled.

**Should exist:** A race-week mode on the Dashboard: "Race in 3 days. Today: easy shakeout. Key focus: hydration, sleep, nothing new." The Coach tools have the data to generate this.

### Gap 3: "I just had a terrible session — I need reassurance"

**Current:** The Session Verdict card shows "Missed intent" with an objective assessment. The Feel Capture captures their emotional state. But there's no empathetic response or forward-looking reassurance.

**Should exist:** When a verdict is "missed" and the feel is 1-2 (Terrible/Hard), the Session Review should include a "One session doesn't define a week" coaching cue and a link to the Coach for discussion. The system prompt in `lib/coach/instructions.ts` already includes supportive personality traits — this just needs to be surfaced automatically.

### Gap 4: "I want to compare this month to last month"

**Current:** No monthly or multi-week comparison view. `session_comparisons` compares individual sessions to prior similar sessions. `training_scores` has `score_delta_28d` but it's a single number. The Debrief is weekly.

**Should exist:** A "Macro view" on the Plan or Dashboard showing 4-week rolling trends: volume, execution quality, discipline balance, training score trajectory. Some of this data exists in `weekly_intensity_summaries` and `training_scores` but isn't rendered in a multi-week view.

### Gap 5: "I want to see all my completed sessions, not just this week"

**Current:** The Calendar shows one week at a time. Session Review shows one session. The Dashboard shows this week's progress. There's no session history/log view.

**Should exist:** A searchable/filterable session history showing all completed sessions with verdicts, sorted by recency. Could live on a new surface or as a tab on the Calendar.

---

## 4e. Proactive vs. Reactive Balance

The product philosophy states: **"passive intelligence over active burden."** Here's how each piece of intelligence scores:

### Proactive (information waits for the athlete) ✓

| Intelligence | Where It Surfaces | Proactive? |
|-------------|-------------------|------------|
| Week completion % | Dashboard | ✓ Yes — always visible |
| Today's sessions | Dashboard | ✓ Yes — always visible |
| Status chip (On track/Behind/At risk) | Dashboard | ✓ Yes — always visible |
| Contextual signals (missed key session, discipline gap) | Dashboard | ✓ Yes — appears automatically |
| Diagnosis-aware signals (easy drift, recovery quality) | Dashboard | ✓ Yes — triggers on pattern detection |
| Transition Briefing | Dashboard (Mon/Tue) | ✓ Yes — appears on correct days |
| Week Ahead preview | Dashboard (Sun/Mon) | ✓ Yes — but limited to 2 days |
| Weekly Debrief readiness | Dashboard | ✓ Yes — shows when ready |
| Adaptation rationales | Calendar | ✓ Yes — appears as CoachNoteCards |
| Training Score | Dashboard | ✓ Yes — always visible (current week) |
| Trend cards | Dashboard | ✓ Yes — always visible |

### Reactive (athlete must go find it) ✗

| Intelligence | Where It Lives | Reactive? |
|-------------|---------------|-----------|
| Session intent/purpose | Session Review, Plan | ✗ Athlete must navigate there |
| Feel Capture prompt | Session Review | ✗ Only appears when athlete visits session page |
| Session Verdict | Session Review | ✗ Athlete must navigate after upload |
| Adaptation signal/preview | Session Review (text only) | ✗ Buried in verdict, no forward link |
| Readiness state (TSB) | Coach tools only | ✗ Not visible on ANY surface |
| Discipline balance | Plan only | ✗ Athlete must visit Plan |
| Rebalancing recommendations | Plan only | ✗ Athlete must visit Plan |
| Block context | Plan, Dashboard header | ✗ Not on Calendar where sessions are executed |
| Race proximity | Header only (single race) | ✗ No multi-race awareness |
| Morning Brief | DISABLED | ✗ Not visible at all |
| Session comparison to prior | Session Review only | ✗ Athlete must visit session page |
| Intensity profile/zone distribution | Plan only | ✗ Athlete must visit Plan |
| Monthly/multi-week trends | Partial (Trend cards) | ✗ No comprehensive view |

### Proactive-Reactive Score: ~50/50

Approximately half of the app's intelligence is proactively surfaced (mostly volume/status metrics on the Dashboard), and half requires the athlete to know where to look (mostly qualitative/coaching intelligence on Plan, Session Review, and Coach).

**The pattern:** Quantitative data (hours, percentages, counts) is proactive. Qualitative data (purpose, readiness, balance, adaptation reasoning) is reactive. This is the wrong split. Athletes need qualitative coaching intelligence proactively — that's what "passive intelligence" means.

### What Should Be Proactively Surfaced But Currently Isn't

1. **Readiness state** — "You're fresh, push today's key session" or "You're fatigued, consider backing off." Currently only in Coach tool responses.

2. **Session purpose** — "Today's Easy Run: keep HR below 150, protect Thursday's intervals." Currently requires visiting Session Review or Plan.

3. **Post-upload verdict** — "Your tempo run landed: execution score 87, on target." Currently requires navigating to Session Review after upload.

4. **Discipline balance alert** — "You're 15% behind on swim this week." Currently only on Plan's DisciplineDistributionChart.

5. **Adaptation preview** — "Based on your missed session, I've moved Thursday's intervals to Saturday." Currently only as a CoachNoteCard on Calendar.

6. **Morning Brief** — Already built, already generates exactly the right content. Just disabled.

---

*Continue to Part 5: Redesign Proposals & Roadmap*
