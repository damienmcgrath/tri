# tri.ai UX Flow Analysis & Architecture Audit

## Part 3: Moment-by-Moment Analysis — Moments 6–10

---

## Moment 6: "Something Changed — I Need to Adjust"

**Trigger:** Life event (travel, illness, schedule change) that affects training availability
**Need:** Communicate the constraint, understand how the plan adapts, confirm the new plan

### Current Flow

```
Option A: Tell the Coach
  Navigate to /coach → type "I'm travelling Thursday-Saturday, can't train"
      ↓
  Coach processes via tools (get_upcoming_sessions, get_athlete_snapshot)
      ↓
  Coach responds with proposed changes
      ↓
  If Coach uses create_plan_change_proposal → coach_plan_change_proposals (INSERT)
      ↓
  Athlete acknowledges in chat
      ↓
  [Coach cannot directly modify sessions — proposals need manual application]
  Navigate to /calendar → manually apply changes OR wait for adaptation processing
```

```
Option B: Modify Calendar directly
  Navigate to /calendar → find the session to move/skip
      ↓
  WeekCalendar offers: "Mark skipped" action (via markSkippedAction server action)
  WeekCalendar offers: "Move to" action (via moveSessionAction server action)
      ↓
  Session is marked skipped or moved
      ↓
  adaptation-rules.ts may detect the trigger (missed session, consecutive skips)
      ↓
  adaptation_rationales (INSERT) if trigger fires
      ↓
  Next Calendar load: CoachNoteCard appears with rationale
      ↓
  [No immediate feedback — athlete doesn't know if adaptation is pending]
```

**Transition count:** 1-2 surface changes
**Estimated taps:** 4-8

### Friction Points

1. **The Coach cannot directly modify the plan.** The `create_plan_change_proposal` tool in `lib/coach/tools.ts` creates a *proposal* in `coach_plan_change_proposals`, but there's no automated pathway from proposal to applied change. The athlete must manually implement changes on the Calendar. The Coach is an advisor, not an executor.

2. **Calendar modifications are mechanical, not intelligent.** The `moveSessionAction` and `markSkippedAction` server actions in `calendar/actions.ts` move/skip sessions but don't trigger immediate adaptation analysis. The athlete marks Thursday as skipped, but doesn't see "here's what this means for your week" until the next page load when `adaptation-rules.ts` may (or may not) fire.

3. **No "schedule change" wizard.** There's no flow for "I have a constraint from X to Y date." The athlete must individually move or skip each affected session. A more intelligent flow would be: "Tell me the constraint → show me the proposed rebalanced week → confirm."

4. **Both paths work but neither is satisfying.** Option A (Coach) gives good advice but can't execute it. Option B (Calendar) can execute but doesn't give coaching rationale. The ideal is a hybrid: communicate constraint → see AI-proposed rebalanced plan → confirm with one tap → see rationale.

### Missing Connections

- Coach proposals should have an "Apply this change" action that modifies the Calendar
- Calendar skip/move actions should trigger immediate adaptation feedback (not deferred)
- A "Schedule change" entry point on the Calendar could ask "What days are affected?" and propose rebalancing
- The Dashboard should surface "plan was modified" signals when adaptations are applied

### Severity: **High**

Schedule changes are a frequent real-life occurrence for amateur athletes. The current two-path approach (Coach advisor OR Calendar manual) creates a gap where intelligence and execution are on different surfaces. The athlete either gets smart advice they can't easily act on, or takes action without smart guidance.

---

## Moment 7: Exploring a Training Question

**Trigger:** Athlete has a specific question ("Should I do my long ride Saturday or Sunday?", "Why has my run pace plateaued?", "Am I swimming enough?")
**Need:** A grounded, data-rich answer

### Current Flow

```
Option A: Via Coach tab
  Tap "Coach" in bottom nav (or "Ask tri.ai" in header)
      ↓
  /coach page loads with:
    - TransitionBriefingCard (if pending, Mon/Tue)
    - CoachBriefingCard (weekly execution summary)
    - WeeklyCheckinCard + Coaching profile card
    - CoachChat interface at bottom of page
      ↓
  Type question in chat input
      ↓
  Coach calls tools: get_recent_sessions, get_training_load, get_athlete_snapshot, etc.
      ↓
  Coach responds with grounded answer including citations, metrics, proposed changes
      ↓
  If Coach references a session → citation chip with session name
  If Coach proposes a change → ProposedChangeCard inline
  [Citation chips do NOT link to session pages — they're display-only]
```

```
Option B: From Calendar adaptation rationale
  Calendar → CoachNoteCard → "Let's discuss" → /coach
      ↓
  [Lands on Coach page with no context about which rationale]
  Must re-explain what they want to discuss
```

```
Option C: From Plan rebalancing card
  Plan → RebalancingCard → "Discuss with Coach"
      ↓
  → /coach?context=rebalancing&sport={sport}
      ↓
  [Coach page CAN receive this context via searchParams]
  Coach opens with rebalancing context pre-loaded
```

**Transition count:** 1 surface change (any → Coach)
**Estimated taps to answer:** 3-5 (if Coach answers well)

### Friction Points

1. **The Coach is accessible but not omnipresent.** The "Ask tri.ai" button in the GlobalHeader links to `/coach`. The Coach tab in the nav is visually de-emphasised (`deemphasized: true` at `shell-nav.tsx:10`). From any surface, it's 1 tap to reach the Coach. This is adequate but not proactive — the Coach doesn't suggest "ask me about this."

2. **Citation chips don't link through.** When the Coach references a session verdict or activity data in its response, the `citation-chip.tsx` component renders a chip with the session name — but the component doesn't include an `href` or `Link`. The athlete can't tap a citation to see the source data. This breaks the grounding promise.

3. **Context is lost on navigation to Coach.** From the Calendar's "Let's discuss" link, the athlete arrives at `/coach` with no pre-loaded context. The `CoachChat` component accepts an `initialPrompt` prop via `searchParams?.prompt`, but the Calendar's "Let's discuss" link doesn't pass the rationale text as a prompt. The Plan's "Discuss with Coach" does pass `context=rebalancing&sport={sport}`, which is better.

4. **No contextual Coach triggers on most surfaces.** The Session Review page has no "Ask about this session" button. The Dashboard Training Score card has no "Explain my score" button. The Debrief has no "Discuss this week" button. These would be natural entry points that pre-load context.

5. **The Coach page has heavy preamble.** Before the chat input, the Coach page renders: TransitionBriefingCard, CoachBriefingCard, WeeklyCheckinCard, and Coaching profile card. On mobile, the chat input is below the fold. The athlete asking a quick question must scroll past briefing content to reach the chat.

### Missing Connections

- Citation chips should link to `/sessions/[id]` or `/activities/[id]`
- "Let's discuss" on Calendar should pass rationale context as `prompt` searchParam
- Session Review, Dashboard score, and Debrief should have "Ask Coach" buttons with pre-loaded context
- A floating/slide-up Coach panel (like Intercom) would eliminate the full-page navigation

### Severity: **Medium**

The Coach works well once you're in it. The tools are well-designed (`get_recent_sessions`, `get_training_load`, etc. in `lib/coach/tool-handlers.ts`), and the system prompt in `lib/coach/instructions.ts` produces grounded, practical answers. The friction is in getting to the Coach with the right context, and in tapping through from Coach answers to source data.

---

## Moment 8: Season and Race Planning

**Trigger:** Athlete signs up for a new race, wants to add it to the season, or wants to review their race calendar
**Need:** Add/modify races, see the impact on training blocks, understand periodisation

### Current Flow

```
To ADD A RACE:
  AccountMenu → Settings → /settings/race
      ↓
  RaceProfileList shows existing races
  "Add race" form → POST /api/race-profiles
      ↓
  Race saved to race_profiles table
      ↓
  [No automatic impact on training plan]
  [No periodisation update]
  Athlete must separately trigger periodisation via Coach or /api/seasons/periodize
```

```
To VIEW SEASON STRUCTURE:
  Navigate to /plan
      ↓
  PlanEditor renders week-by-week view
  SeasonTimeline shows blocks as colored segments (if seasons/blocks exist)
  BlockOverview shows weekly breakdown
      ↓
  [Season timeline requires seasons + training_blocks data to exist]
  [Not automatically generated from race_profiles]
```

```
To SEE RACE CONTEXT FROM CALENDAR:
  /calendar shows weekly sessions
      ↓
  [No race markers on Calendar]
  [No "Race in X weeks" indicator per week]
  [Must go to /plan → SeasonTimeline to see race positioning]
```

**Transition count:** 2-3 surface changes (Settings → Plan → Calendar)
**Estimated taps:** 6-10

### Friction Points

1. **Race management is in Settings, separated from planning.** Adding a race is in `/settings/race`, but seeing its impact on training is in `/plan`. The athlete adds a B-race and then must navigate to the Plan to understand how it affects their blocks.

2. **No automatic periodisation cascade.** Adding a race to `race_profiles` doesn't trigger automatic training block generation. The `season-engine.ts` module and `/api/seasons/periodize` endpoint exist, but they're not automatically invoked when a race is added. The athlete must explicitly request periodisation through the Coach or Plan builder.

3. **Calendar has no race context.** The `WeekCalendar` component doesn't show race markers or proximity. The `SeasonTimeline` with race diamond badges exists on the Plan page but not on the Calendar. An athlete 3 weeks out from a race doesn't see "Race in 3 weeks" on their weekly Calendar view.

4. **Dashboard race countdown is header-only.** The `GlobalHeader` shows "Race Name • X days" in the top bar, but this is just a single primary race from `profiles.race_name/race_date`. Multi-race season awareness isn't in the header or Dashboard.

5. **The Plan/Season view is strategic, which is correct.** The `SeasonTimeline` and `BlockOverview` on the Plan page are well-designed for seeing the big picture. This is the right home for season-level thinking. The issue is that race context doesn't flow down to the Calendar and Dashboard where daily decisions happen.

### Missing Connections

- Adding a race should prompt: "Want me to adjust your training blocks?"
- Calendar should show race markers and "X weeks to [race]" per week
- Dashboard should show multi-race awareness (not just single race countdown)
- Plan → Calendar connection: block context should flow to weekly Calendar headers

### Severity: **Medium**

Season planning is a lower-frequency moment (athletes add races every few months). The tools exist but the flow is fragmented. The biggest impact would be flowing race context down to Calendar and Dashboard.

---

## Moment 9: Monday Morning Transition

**Trigger:** New week starts
**Need:** Close out last week (debrief), understand this week (plan, focus, key sessions), see transitional briefing

### Current Flow

```
Open app Monday morning → /dashboard
    ↓
See: TransitionBriefingCard (if generated — shows Mon/Tue)
  - Contains: last_week_takeaway, this_week_focus, adaptation_context
  - Actions: "Dismiss" button
    ↓
See: WeeklyDebriefCard
  - If last week has artifact: shows title + fact bullets + "Open debrief"
  - If last week ready but no artifact: "Your week is ready to review" + "Open debrief"
    ↓
See: WeekAheadCard (shows Sun/Mon only)
  - Contains: week phase, planned minutes, key session count, daily load shape
    ↓
See: Regular Dashboard content (week progress, today's session, training score)
    ↓
To see LAST WEEK'S FULL DEBRIEF: tap "Open debrief" → /debrief
To see THIS WEEK'S PLAN DETAIL: tap "View plan" → /calendar
To see KEY SESSIONS: scroll Dashboard or go to Calendar
```

**Transition count:** 1-2 surface changes (Dashboard → Debrief, or Dashboard → Calendar)
**Estimated taps from "open app" to "understand my week":** 2-4

### Friction Points

1. **The Monday morning components are good but fragmented.** The Dashboard shows 3 distinct cards: TransitionBriefingCard (last week → this week bridge), WeeklyDebriefCard (last week review), and WeekAheadCard (next week preview). These are the right pieces of content, but they're separate cards competing for scroll space — not a unified "Monday morning" experience.

2. **The flow is parallel, not sequential.** The ideal Monday flow is sequential: "Here's how last week went → Here's what carries forward → Here's this week's focus → Here's today's session." Instead, the Dashboard shows all of these simultaneously as separate cards that the athlete must mentally stitch together.

3. **TransitionBriefingCard duplicates between Dashboard and Coach.** The same `TransitionBriefingCard` component appears on both the Dashboard (`dashboard/page.tsx:846`) and the Coach page (`coach/page.tsx:291`). If the athlete visits both, they see the same content twice. If they dismiss it on Coach, it may still show on Dashboard (or vice versa — the `dismissed_at` field should prevent this, but it's a shared state).

4. **WeekAheadCard only shows Sunday/Monday.** The `showWeekAheadCard` flag at `dashboard/page.tsx:482` limits this to `todayDayOfWeek === 0 || 1`. By Tuesday, the "what's this week look like?" preview is gone. If the athlete doesn't check on Monday, they miss it entirely.

5. **Morning Brief would solve this but is disabled.** The `morning-brief.ts` module generates exactly the right content: session_preview, readiness_context, week_context, and pending_actions. It's designed for this moment. But `MorningBriefCard` is commented out.

### Missing Connections

- A unified "Monday transition" flow: debrief summary → carry-forward → this week's shape → today's session
- WeekAheadCard should be available all week (not just Sun/Mon)
- Morning Brief should be re-enabled or integrated into the Dashboard layout
- The transition briefing should link to specific sessions it mentions

### Severity: **High**

Monday morning is the third-highest-frequency moment (weekly). The components exist and are well-built, but they're presented as independent cards rather than a guided transition flow. The athlete has to read 3 cards and mentally compose the narrative. A sequential "close last week → open this week" flow would be significantly more satisfying.

---

## Moment 10: Sharing Progress

**Trigger:** End of a good week, milestone, or regular sharing habit
**Need:** Generate and share a beautiful summary

### Current Flow

```
Navigate to /debrief?weekStart={weekStart}
    ↓
Scroll to bottom of debrief page
    ↓
Tap "Share" button (ShareSummaryButton)
    ↓
ShareCardModal opens as portal:
  - Format selector: Story (9:16) / Feed (4:5) / Square (1:1)
  - Toggle: Show/hide name on card
  - Preview image (debounced 300ms via /api/og/weekly-summary)
  - "Download" or "Share" button
    ↓
Download: creates Blob → downloads PNG
Share: uses navigator.share() API (mobile) → fallback to download
```

**Transition count:** 1-2 surface changes (Dashboard → Debrief → Share modal)
**Estimated taps from "I want to share" to "shared":** 4-6

### Friction Points

1. **Sharing requires navigating to the Debrief.** The Dashboard's `WeeklyDebriefCard` shows fact bullets but has no share action. The athlete must tap "Open debrief" → scroll to bottom → tap "Share." If the share button were on the Dashboard debrief card, it would save 2-3 taps.

2. **Only weekly summaries are shareable.** There's no mechanism to share a single session achievement ("I nailed my tempo run — execution score 95"), a milestone ("First 100km bike this season"), or a training score update. The `ShareCardModal` is designed exclusively for the weekly OG image.

3. **The OG image endpoint is well-built.** The `/api/og/weekly-summary/route.tsx` generates attractive share cards. The format selection (Story/Feed/Square) is thoughtful for social media use cases. This is a solid foundation that could be extended.

4. **Share discovery is low.** The share button is at the bottom of the Debrief page, after metrics, narrative, evidence, and feedback sections. On mobile, it requires significant scrolling. It should be in the page header or sticky.

### Missing Connections

- Share button should appear on Dashboard debrief card (not just Debrief page)
- Session-level sharing: share a verdict/achievement from Session Review
- Training Score milestone sharing: "I hit 80 for the first time"
- The share button should be in the Debrief page header (not below the fold)

### Severity: **Low**

Sharing is a nice-to-have engagement feature, not a core training need. The current flow works but requires too many taps. The biggest opportunity is extending sharing beyond weekly summaries to individual session achievements.

---

*Continue to Part 4: Cross-Moment Pattern Analysis*
