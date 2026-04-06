# tri.ai UX Flow Analysis & Architecture Audit

## Part 2: Moment-by-Moment Analysis — Moments 1–5

---

## Moment 1: Morning Check-In

**Trigger:** Athlete opens app first thing in the morning
**Need:** Understand today's session (purpose, intensity, focus), recovery status, any adaptations made overnight, week progress, any pending actions

### Current Flow

```
Open app → /dashboard (default landing)
    ↓
See: Week progress card (completion %, hours left, daily chips)
See: "What matters right now" card (today's pending sessions)
See: Transition Briefing card (Mon/Tue only)
See: Training Score card (composite 0-100)
See: Weekly Debrief card (if end of week)
See: Trend cards (rolling averages)
    ↓
To see session PURPOSE: tap "Open session" → /calendar?focus={id} → read session card
To see session DETAIL: tap session card → /sessions/[id] → read full review page
To see ADAPTATION context: scroll Calendar for CoachNoteCards (if any pending rationales)
To see RECOVERY status: not directly visible (TSB/readiness not shown on Dashboard)
```

**Transition count:** 1-3 surface changes (Dashboard → Calendar → Session Review)
**Estimated taps to full understanding:** 4-8

### Friction Points

1. **Today's session shows name and duration but NOT purpose or intent category.** The Dashboard "What matters right now" card renders `getSessionDisplayName(session)` and `session.duration_minutes` — but the `intent_category` and `session_role` fields are available in the data and not displayed. The athlete sees "Easy Run" and "45 min" but not "Recovery — protect tomorrow's key session."

2. **Morning Brief is disabled.** The `MorningBriefCard` import is commented out at `dashboard/page.tsx:21`. The `getOrGenerateMorningBrief` function exists in `lib/training/morning-brief.ts` and generates exactly what the athlete needs: session preview, readiness context, week context, and pending actions. But it's not rendered. The `DashboardMorningBrief` async component is commented out at lines 838-842.

3. **Recovery/readiness status is invisible.** The fitness model (`lib/training/fitness-model.ts`) computes CTL, ATL, TSB, and readiness state ("fresh"/"absorbing"/"fatigued"/"overreaching") — but this data only appears in the Coach's tool responses (`get_training_load`). The Dashboard has no readiness indicator.

4. **Transition Briefing only shows Mon/Tue.** The `showTransitionBriefing` flag at `dashboard/page.tsx:485` checks `todayDayOfWeek === 0 || 1 || 2` (Sun/Mon/Tue). On Wednesday-Saturday mornings, there is no briefing card at all. The athlete gets the same static week progress layout every day.

5. **Adaptation rationales are on Calendar, not Dashboard.** If the Adaptation Engine modified the plan overnight, the rationale appears as a `CoachNoteCard` on the Calendar page — not on the Dashboard where the athlete lands first. The athlete won't know something changed unless they navigate to Calendar.

### Missing Connections

- Readiness state (TSB) should be visible on Dashboard
- Session intent/purpose should be on the "What matters right now" card
- Pending adaptation rationales should surface on Dashboard (not just Calendar)
- Morning Brief should be re-enabled or replaced with equivalent contextual content

### Severity: **Critical**

The morning check-in is the highest-frequency athlete moment. The Dashboard provides quantity metrics (% complete, hours left) but not quality guidance (what to focus on, how you're recovering, what changed). The athlete gets a scorecard when they need a briefing.

---

## Moment 2: Pre-Session Preparation

**Trigger:** Athlete is about to start training (15-30 minutes before)
**Need:** Know exactly what to do, why they're doing it, target metrics, and any modifications from the original plan

### Current Flow

```
From Dashboard: tap "Open session" → /calendar?focus={sessionId}
    ↓
Calendar page loads, scrolls to focused session card
    ↓
Session card shows: sport icon, session name, duration, status chip, 
    execution score band (if completed), key badge, role label
    ↓
To see FULL SESSION DETAIL: tap card → /sessions/[id]
    ↓
Session Review page shows: sport, type, date, duration, target, 
    notes, execution result (if completed), feel capture, verdict
    ↓
To see PURPOSE from plan: must go to /plan and find the session
To see BLOCK CONTEXT: must go to /plan → find the week → read block focus
To see ADAPTATION RATIONALE: must check CoachNoteCards on Calendar
```

**Transition count:** 2-3 surface changes (Dashboard → Calendar → Session Review, possibly → Plan)
**Estimated taps to full understanding:** 5-8

### Friction Points

1. **Calendar session cards lack purpose context.** The `WeekCalendar` component (`calendar/week-calendar.tsx`) renders session cards with sport, name, duration, and status — but NOT the `intent_category`, `target`, or block context. The data IS fetched (the Calendar page queries `intent_category, session_role` at line 119) but the WeekCalendar component doesn't display it prominently. There's a `role` field in `CalendarSession` but it's used only for a small label, not for explaining the session's purpose.

2. **No "session briefing" view.** There is no dedicated pre-session screen that says: "This is an Easy Run. The purpose is aerobic base maintenance. Target: Z2 heart rate, 140-150 bpm. You're in Build Week 3. Keep this genuinely easy to protect Thursday's key intervals." That synthesis requires visiting 3 surfaces (Calendar for the session, Plan for the block context, Session Review for any prior similar session comparisons).

3. **Adaptation rationale is disconnected from the session it modified.** If the Adaptation Engine moved or modified a session, the rationale appears in `CoachNoteCards` at the top of the Calendar — not inline with the session card. The athlete might not connect the rationale to the specific session.

4. **The "target" field from the Plan is only visible on Session Review.** The `sessions.target` column (e.g., "Z2 low", "3x10 @ FTP") is displayed on the Session Review page but not on the Calendar card. Pre-session, the athlete needs this most.

### Missing Connections

- Session intent, target zones, and block context should be on the Calendar session card
- Adaptation rationale should be inline with the affected session (not just a top-of-page card)
- A "session briefing" view would eliminate the need to visit multiple surfaces
- Prior similar session comparison could be shown pre-session ("Last time you did this: ...")

### Severity: **High**

The athlete can get the basic information (what session, how long) from the Calendar, but the *coaching intelligence* (why this session, what to focus on, what changed) requires navigating to multiple surfaces. The pre-session moment should feel like a coach handing you a workout card — instead it feels like checking a schedule.

---

## Moment 3: Post-Session Upload & Review

**Trigger:** Athlete uploads a FIT file after training (or Strava syncs automatically)
**Need:** See how the session went, capture how they felt, understand what it means for upcoming training

### Current Flow — Manual Upload

```
Navigate to /settings/integrations
    ↓
ActivityUploadsPanel → select FIT/TCX file → upload
    ↓
POST /api/uploads/activities → parse → auto-match attempt
    ↓
Upload appears in ActivityUploadsPanel with status
    ↓
[DEAD END — no forward navigation to verdict]
    ↓
Athlete must manually navigate to:
  Option A: /sessions/[sessionId] (if they know which session was matched)
  Option B: /calendar → find the session → tap it
  Option C: /activities/[activityId] → see raw data
```

### Current Flow — Strava Sync

```
Strava webhook fires → /api/integrations/strava/webhook
    ↓
ingestion-service.ts processes activity
    ↓
completed_activities INSERT + session_activity_links INSERT
    ↓
session-execution.ts generates verdict
    ↓
[NO USER NOTIFICATION — athlete doesn't know sync happened]
    ↓
Athlete opens app later → Dashboard shows updated completion %
    ↓
To see verdict: must navigate to /sessions/[id] or /calendar → tap session
```

### Once on Session Review (`/sessions/[sessionId]`)

```
Session Review page renders:
    ↓
1. Session header (sport, type, date, duration)
2. FeelCaptureBanner (if no existing feel) — inline on same page
3. SessionVerdictCard (loads async via API, may take seconds)
4. SessionComparisonCard (comparison to prior similar session)
5. Execution details accordion
    ↓
[END — no "what happens next" navigation]
[No link to Dashboard, Calendar, or upcoming sessions]
[No adaptation preview showing impact on rest of week]
```

**Transition count:** 3-5 surface changes (Settings → Session Review → Dashboard/Calendar)
**Estimated taps from upload to understanding:** 8-12

### Friction Points

1. **Upload is buried in Settings.** The primary upload mechanism is in `/settings/integrations`, which is 3 taps deep from the Dashboard (AccountMenu → Settings → Integrations). The `TcxUploadForm` also exists on the Dashboard page component file but it's not prominently surfaced. For Strava users, there's no upload step — but there's also no notification.

2. **No post-upload guided flow.** After upload completes, the athlete stays on the Integrations page looking at a table of upload statuses. There is no "View your session" link, no modal, no redirect. The `ActivityUploadsPanel` shows upload status (parsed/matched/error) but doesn't link forward to the matched session's review.

3. **Feel Capture is reactive, not proactive.** The `FeelCaptureBanner` only renders when the athlete navigates to `/sessions/[id]`. It's not surfaced post-upload. If the athlete uploads and goes back to the Dashboard (natural behavior), they never see the feel capture prompt until they independently decide to visit Session Review.

4. **Session Verdict Card loads asynchronously.** `SessionVerdictCard` at `sessions/[sessionId]/components/session-verdict-card.tsx` fetches the verdict on mount. If the execution review hasn't been generated yet, the card shows a loading state. The athlete may arrive before the AI has finished processing.

5. **No adaptation preview.** The Session Verdict shows an `adaptation_signal` field and an `adaptation_type` (proceed/flag_review/modify/redistribute), but these are displayed as text labels — not as actionable previews of what will change. The athlete reads "Modification suggested" but doesn't know what modification.

6. **Session Review is a dead end.** After viewing the verdict and capturing their feel, there is no forward navigation. No "Back to Calendar" breadcrumb. No "View upcoming sessions" link. No "See how this affects your week" CTA. The athlete must use the nav tabs to leave.

### Missing Connections

- Upload should redirect to the matched session's review page
- Feel Capture should be prompted immediately post-upload (not requiring navigation)
- Verdict should include forward links: "See impact on week" → Dashboard, "View next session" → Calendar
- Adaptation signal should link to Calendar (where the adaptation is shown) or expand inline to show what changes
- For Strava sync, Dashboard should show a "New activity synced" notification with link

### Severity: **Critical**

Post-session is the second-highest-engagement moment. The athlete is motivated, curious, and time-boxed (they just worked out and want a quick debrief). The current flow requires too many taps and too much navigation knowledge. The ideal flow is linear: upload → feel → verdict → implications → done.

---

## Moment 4: Mid-Week Check — "Am I On Track?"

**Trigger:** Wednesday/Thursday, athlete wants to assess the week so far
**Need:** Overall week progress, score trajectory, any concerning trends, remaining key sessions

### Current Flow

```
Open app → /dashboard
    ↓
See: Week progress card (completion %, hours remaining, daily chips)
See: "What matters right now" or "Today is done" card
See: Contextual signals (attention items, focus items) — if applicable
See: Training Score card (composite 0-100 with 7d delta)
    ↓
To see DISCIPLINE BALANCE: navigate to /plan → DisciplineDistributionChart
To see INTENSITY PROFILE: navigate to /plan → WeeklyIntensityHeader
To see SESSION-LEVEL STATUS: navigate to /calendar → scroll through week
To see DETAILED VERDICTS: navigate to /calendar → tap each session → /sessions/[id]
```

**Transition count:** 1-3 surface changes
**Estimated taps to answer "am I on track?":** 3-6

### Friction Points

1. **The Dashboard DOES answer the core question — partially.** The completion percentage, "On track"/"Slightly behind"/"At risk" status chip, and contextual signal cards (missed key session, behind by X minutes, discipline gap) are well-designed. The `getDiagnosisAwareSignal()` function at `dashboard/page.tsx:349` even detects execution patterns (easy sessions drifting too hard, recovery quality slipping). This is good.

2. **But the answer is incomplete.** The Dashboard shows volume progress but not execution quality breakdown. The Training Score card shows a single number (0-100) with a 7d delta, but doesn't break out the 3 dimensions (execution, progression, balance) by default — that requires expanding the card. The athlete can't see "your execution is strong but your balance is off" at a glance.

3. **Discipline balance lives only on Plan.** The `DisciplineDistributionChart` and `RebalancingCard` are rendered exclusively on the Plan page. If the athlete's swim/bike/run distribution is off, they won't see it on the Dashboard or Calendar. The `discipline-balance.ts` module computes this data, but only the Plan surface displays it.

4. **No mid-week synthesis.** The Weekly Debrief is designed for end-of-week (`weekly-debrief/deterministic.ts` checks readiness based on resolved sessions). There is no mid-week equivalent. The `WeeklyDebriefCard` on the Dashboard shows readiness progress ("2+ key sessions resolved to unlock") but doesn't generate a mid-week reflection.

5. **Intensity distribution invisible on Dashboard.** The `session_intensity_profiles` table and `weekly_intensity_summaries` table exist with zone distribution data, but this is only rendered in the Plan surface's `WeeklyIntensityHeader` and `IntensityBar` components. The Dashboard doesn't show whether the athlete's intensity mix is appropriate.

### Missing Connections

- Training Score breakdown should be visible by default (not behind an expand toggle)
- Discipline balance summary should appear on Dashboard (not just Plan)
- A mid-week check card could show: execution quality this week, discipline balance, remaining key sessions
- Intensity distribution (easy/hard ratio) should be surfaced on Dashboard

### Severity: **Medium**

The Dashboard does a reasonable job for the "am I on track?" question at a volume level. The friction is that qualitative answers (execution quality, balance, intensity mix) require visiting the Plan surface. This is a case where the intelligence exists but lives on the wrong surface.

---

## Moment 5: End-of-Week Reflection

**Trigger:** Sunday evening or Monday morning
**Need:** Complete week synthesis — what happened, what it means, what changes next week

### Current Flow

```
Open app → /dashboard
    ↓
See: WeeklyDebriefCard
  - If not ready: "Not enough signal yet" + progress indicators
  - If ready, no artifact: "Your week is ready to review" + "Open debrief" button
  - If artifact exists: Title, status line, 3 fact bullets, "Open debrief" button
    ↓
Tap "Open debrief" → /debrief?weekStart={weekStart}
    ↓
Debrief page renders:
  - Macro context arc line ("Week 8 of 16 · Build Phase · Race in 52 days")
  - Core metrics grid (volume, TSS, completion, key sessions, etc.)
  - AI narrative (executive summary, highlights, observations, carry-forward)
  - Evidence cards (linked sessions and activities)
  - Share button (opens ShareCardModal with format selection)
  - Feedback card (helpful? accurate?)
  - Refresh button (if stale)
    ↓
[No forward link to next week's plan or Calendar]
[No connection to Week Ahead card (which lives on Dashboard)]
```

**Transition count:** 1 surface change (Dashboard → Debrief)
**Estimated taps to complete reflection:** 4-6

### Friction Points

1. **Discoverability is decent but timing is passive.** The `WeeklyDebriefCard` on the Dashboard promotes the debrief well. However, the debrief is only shown on the Dashboard when `isCurrentWeek` is true (line 478: `const showWeeklyDebriefCard = isCurrentWeek`). For historical weeks accessed via WeekNavigator, the debrief still shows (the `DashboardDebrief` component at line 1031 runs for all weeks), but the card variant changes.

2. **Debrief doesn't connect forward.** The Debrief page (`debrief/page.tsx`) has no "View next week's plan" button. The `carry_forward` items in the narrative tell the athlete what to focus on next week, but there's no link to the Calendar or Dashboard for the next week. The athlete reads "Protect your long ride next Sunday" but can't tap through to see next Sunday's plan.

3. **Week Ahead card is on Dashboard, not Debrief.** The `WeekAheadCard` component (`dashboard/components/week-ahead-card.tsx`) shows next week's preview (sessions, load shape, key sessions) — but it's on the Dashboard, and only appears Sunday/Monday (`showWeekAheadCard` at line 482). The natural flow would be: Debrief this week → Preview next week. Instead, both are on the Dashboard, competing for attention.

4. **Sharing is well-implemented.** The `ShareSummaryButton` → `ShareCardModal` flow is clean: format selection (Story/Feed/Square), preview via OG image route, download/share. This works. However, it's only available from the Debrief page — not from the Dashboard's debrief card or from individual session achievements.

5. **Adjacent week navigation exists but is subtle.** The Debrief page has `getAdjacentWeeklyDebriefs()` to fetch previous/next week debriefs, but the navigation to adjacent weeks is not prominent in the UI. The athlete must use the Dashboard's WeekNavigator to view prior week debriefs, which is a 2-step process (Dashboard → change week → scroll to debrief card → tap "Open debrief").

### Missing Connections

- Debrief should link forward to next week's plan/Calendar
- Week Ahead card should appear at the bottom of the Debrief page (not just Dashboard)
- Share action should be available from the Dashboard debrief card (not requiring full Debrief page visit)
- Session-level achievements should be shareable (not just weekly summaries)

### Severity: **Medium**

The end-of-week flow is the best-designed moment in the app. The WeeklyDebriefCard on Dashboard → Debrief page is a clear 1-tap flow. The debrief content is rich and well-structured. The main friction is the lack of forward connection to next week and the inability to share from the Dashboard.

---

*Continue to Part 3: Moment-by-Moment Analysis (Moments 6-10)*
