# tri.ai UX Flow Analysis & Architecture Audit

## Part 5: Redesign Proposals & Prioritised Roadmap

---

## 5a. Hypothesis Evaluations

### Hypothesis A: The Dashboard Should Be a Context-Aware Smart Router

**Proposal:** Instead of static content, the Dashboard shows different primary content based on the athlete's current moment.

**Evaluation: PASS — with constraints**

**Does the codebase support this?** Yes. The Dashboard already has conditional rendering based on time:
- `showTransitionBriefing` (Mon/Tue) at `dashboard/page.tsx:485`
- `showWeekAheadCard` (Sun/Mon) at `dashboard/page.tsx:482`
- `showWeeklyDebriefCard` (current week) at `dashboard/page.tsx:478`
- Three different "Today" card states: pending sessions, completed today, no sessions

The data needed for all moment-states is already fetched in the Dashboard's server component. The `todayIso`, `isCurrentWeek`, `todayDayOfWeek`, and session states are all available.

**What would need to change:**

1. Add a `getDashboardMoment()` function that detects the athlete's current state:
   - `just_uploaded` — a completed_activity was created in the last 30 minutes with no feel captured
   - `monday_transition` — it's Monday (or Sunday evening), debrief ready
   - `mid_week_check` — Wed-Fri, has active sessions
   - `end_of_week` — Saturday, high completion %
   - `rest_day` — no sessions today
   - `default` — fallback to current layout

2. Reorder/prioritise the existing cards based on the detected moment rather than showing all simultaneously. The cards already exist; only their visibility and ordering changes.

3. For `just_uploaded`: need to detect recent unreviewed uploads. The `completed_activities` data is already fetched. Check for activities with `created_at` in the last 30 minutes that lack a verdict.

**Risks:**
- Athletes may find a non-static layout confusing initially. Mitigation: keep the core structure (week progress + today) stable, only change the *secondary* content area.
- Edge cases in moment detection (multiple states overlapping). Mitigation: define clear priority order.

**Effort: Medium (2-3 days)**

The infrastructure is there. This is primarily a re-ordering and conditional rendering change in `dashboard/page.tsx`, not a data model change.

---

### Hypothesis B: The Calendar Should Absorb Plan Context

**Proposal:** Every session card on the Calendar includes purpose statement, block context, intensity classification, and adaptation rationale. The Plan surface becomes purely strategic.

**Evaluation: PASS**

**Does the codebase support this?** Yes. The Calendar already fetches `intent_category`, `session_role`, and `execution_result` from the sessions table (line 119 of `calendar/page.tsx`). The `CalendarSession` type in `week-calendar.tsx` already has `intentCategory`, `role`, `source`, and `executionResult` fields. They're just not displayed prominently.

**What would need to change:**

1. **Session cards expand to show intent.** In `week-calendar.tsx`, each session card currently shows sport icon, name, duration, and status. Add: intent category label (e.g., "Aerobic Base"), role badge ("Key"/"Supporting"/"Recovery"), and target zones (from `sessions.target`).

2. **Block context in weekly header.** The Calendar page needs to fetch `training_weeks.focus` for the current week and display "Build Week 3" in the header above the day columns. This requires one additional query to `training_weeks`.

3. **Inline adaptation rationale.** Currently `CoachNoteCards` render as a separate section above the calendar. Move the rationale inline: if a session has an associated `adaptation_rationale`, show a small "Adapted" badge on the card with expandable rationale text. This requires joining `adaptation_rationales.affected_sessions` to the calendar session list.

4. **Keep Plan as strategy-only.** The Plan surface (`plan-editor.tsx`) retains: multi-week overview, season timeline, discipline balance, intensity profiles, session editing. Remove the need for athletes to visit Plan for daily execution context.

**Risks:**
- Session cards become taller on Calendar, reducing the number visible without scrolling. Mitigation: use progressive disclosure (show intent/role as small pills, expand on tap).
- The Plan/Calendar distinction blurs. Mitigation: the distinction is clear — Plan is "what's the multi-week shape?", Calendar is "what do I do this week?" Block context on Calendar reinforces this.

**Effort: Medium (2-3 days)**

Mostly component changes in `week-calendar.tsx` plus one additional data fetch.

---

### Hypothesis C: The Weekly Debrief Should Be a Dashboard State, Not a Separate Surface

**Proposal:** The debrief is accessible as a Dashboard view — "Today" (default) | "This Week" (mid-week check) | "Last Week" (debrief).

**Evaluation: PARTIAL PASS**

The idea of Dashboard tabs has merit, but the full Debrief is too rich for a Dashboard section. The Debrief page renders: macro context, 3-6 metric cards, multi-paragraph narrative, evidence cards, feedback form, and share button. Embedding all of this in the Dashboard would make it extremely long.

**Better approach:** Keep the Debrief as a dedicated page, but:
1. Make the Dashboard's `WeeklyDebriefCard` richer — show the executive summary, key metrics, and share button directly (not just fact bullets). This eliminates the need to open the Debrief for a quick review.
2. Add "This Week" and "Last Week" tabs to the Dashboard header (alongside `WeekNavigator`) so the athlete can switch temporal context without leaving the Dashboard.
3. When viewing "Last Week" on the Dashboard, promote the debrief card to the top.

**What would need to change:**
- Expand `WeeklyDebriefCard` to include the executive summary from `artifact.narrative.executiveSummary` and a share button.
- The `WeekNavigator` already supports week switching. Make the UX more tab-like.

**Risks:** Minimal. This is an incremental enhancement.

**Effort: Small (< 1 day)**

---

### Hypothesis D: Session Review Needs a Post-Upload Guided Flow

**Proposal:** After FIT upload or Strava sync, the app enters a linear flow: Upload Confirmation → Feel Capture → Session Verdict → Adaptation Preview → "Back to Dashboard."

**Evaluation: PASS — this is the highest-impact change**

**Does the current upload mechanism support this?**

For manual uploads: The `POST /api/uploads/activities` endpoint returns the created activity ID and matched session ID (if auto-matched). The redirect after upload could go to `/sessions/[matchedSessionId]` instead of staying on the integrations page.

For Strava sync: The webhook pipeline writes to `completed_activities` and `session_activity_links`. The Dashboard could detect a recently-synced, unreviewed session and surface it as a notification card.

**What would need to change:**

1. **Post-upload redirect.** After successful upload in `ActivityUploadsPanel` or `TcxUploadForm`, if the activity was auto-matched (confidence ≥ 0.85), redirect to `/sessions/[matchedSessionId]?postUpload=true`.

2. **Guided flow on Session Review.** When `searchParams.postUpload=true`:
   - Step 1: Show Feel Capture prominently (full-width, above the fold)
   - Step 2: After feel is saved, show Session Verdict card
   - Step 3: Below verdict, show "Impact on your week" card (adaptation signal + remaining key sessions)
   - Step 4: CTA: "Back to Dashboard" or "View Calendar"

3. **Dashboard notification for Strava syncs.** Add a "New activity synced" card at the top of the Dashboard when a `completed_activity` exists with `created_at` in the last 2 hours and no `session_feels` entry. Link to `/sessions/[id]?postUpload=true`.

4. **Unmatched upload handling.** If the upload wasn't auto-matched, redirect to `/activities/[activityId]` with the `ActivityLinkingCard` to manually assign.

**Risks:**
- The guided flow feels forced if the athlete just wants to check the Dashboard. Mitigation: make it a notification/card, not a mandatory redirect. The athlete can dismiss it.
- Verdict generation is async and may not be ready immediately. Mitigation: show a "Generating verdict..." loading state, or defer the verdict step.

**Effort: Medium (2-3 days)**

Requires changes to upload flow (redirect logic), Session Review page (postUpload mode), and Dashboard (notification card). No data model changes.

---

### Hypothesis E: The Coach Needs Ambient Entry Points

**Proposal:** In addition to the Coach tab, add contextual "Ask about this" triggers on every surface that open the Coach with pre-loaded context.

**Evaluation: PASS**

**The infrastructure already exists.** The Coach page accepts `searchParams.prompt` (used in `coach/page.tsx:259`). The `CoachChat` component accepts `initialPrompt` as a prop. The Plan's `RebalancingCard` already deep-links with `?context=rebalancing&sport={sport}`.

**What would need to change:**

1. **Session Review:** Add "Ask Coach about this session" button that links to `/coach?prompt=Tell me about my ${sessionName} on ${date}. The verdict was ${verdictStatus}.`

2. **Dashboard Training Score:** Add "Explain my score" link on `TrainingScoreCard` that links to `/coach?prompt=Explain my training score of ${compositeScore}. What's driving it?`

3. **Calendar Adaptation Cards:** Update "Let's discuss" link in `CoachNoteCards` to include the rationale text: `/coach?prompt=I want to discuss this adaptation: ${rationaleText}`

4. **Debrief:** Add "Discuss this week with Coach" button that links to `/coach?prompt=Let's discuss my week of ${weekStart}. Summary: ${executiveSummary}`

5. **(Future) Slide-up Coach panel.** Instead of full-page navigation, open a bottom sheet/slide-up panel with the Coach chat. This keeps the athlete on their current surface. Implementation: a client-side `CoachPanel` component rendered in the protected layout, toggled by a FAB or contextual button.

**Should both exist (dedicated surface + ambient panel)?** Yes. The dedicated Coach page provides the full experience with briefing cards, conversation history, and diagnosed sessions. The ambient panel provides quick Q&A without losing context. The panel can link to "Open full Coach" for deeper exploration.

**Risks:**
- A floating Coach panel adds complexity to the layout and may interfere with scroll on mobile. Mitigation: implement as a bottom sheet that covers 70% of the screen, similar to mobile map apps.
- Pre-loaded prompts may feel robotic. Mitigation: use natural language prompts and let the Coach respond conversationally.

**Effort: Phase 1 (deep links) — Small (< 1 day). Phase 2 (slide-up panel) — Large (3-5 days).**

---

## 5b. Detailed Specifications for Approved Proposals

### Proposal 1: Post-Upload Guided Flow (Hypothesis D)

**What changes:**

| Component | Current | Proposed |
|-----------|---------|----------|
| `ActivityUploadsPanel` | Shows upload status table, no navigation | After successful upload + auto-match: redirect to `/sessions/[id]?postUpload=true` |
| `TcxUploadForm` | Shows success message, stays on page | After success: redirect to matched session |
| `sessions/[sessionId]/page.tsx` | Static page with feel + verdict + comparison | When `postUpload=true`: guided linear flow with feel-first, then verdict, then impact |
| `dashboard/page.tsx` | No upload awareness | Add `RecentUploadCard` for Strava-synced activities within 2 hours |

**New component: `RecentUploadCard`**
- Checks: `completed_activities` with `created_at > now - 2h` AND no entry in `session_feels`
- Renders: "You completed [session name] — how did it feel?" with link to `/sessions/[id]?postUpload=true`
- Dismissable (stores dismissal in sessionStorage)

**What stays:**
- Session Review page layout (feel banner + verdict card + comparison card)
- Feel Capture component (no changes to the form itself)
- Session Verdict Card (no changes to the verdict display)
- All data models unchanged

**Migration path:**
1. Add `postUpload` searchParam handling to `sessions/[sessionId]/page.tsx` — reorder components when flag is set
2. Add redirect logic to upload success handlers
3. Add `RecentUploadCard` to Dashboard
4. Test with Strava webhook flow

### Proposal 2: Context-Aware Dashboard (Hypothesis A)

**What changes:**

| Component | Current | Proposed |
|-----------|---------|----------|
| `dashboard/page.tsx` | All cards shown simultaneously | Add `getDashboardMoment()` to detect state, reorder/prioritise cards |
| Transition Briefing | Shows Mon/Tue only | Always show on Mon, expandable on Tue |
| Morning Brief | DISABLED (commented out) | Re-enable with fresh implementation |
| Week Ahead | Shows Sun/Mon only | Available all week via "This Week" view |
| Training Score | Shows current week only | Always show, add 3-dimension breakdown visible by default |

**New logic: `getDashboardMoment()`**
```
Priority order:
1. just_uploaded — unreviewed activity in last 2h → promote RecentUploadCard
2. monday_transition — Mon/Tue + debrief ready → promote Transition + Debrief + Week Ahead
3. session_today — pending session today → promote "What matters right now"
4. end_of_week — Sat/Sun + high completion → promote Debrief
5. mid_week — default → show week progress + score + contextual signals
```

**What stays:**
- All existing components preserved
- Week progress card always visible
- Today's session card always visible
- Contextual signal cards (attention/focus) always visible

**Migration path:**
1. Add `getDashboardMoment()` function
2. Re-enable `MorningBriefCard` (or replace with lighter-weight equivalent)
3. Adjust card ordering based on moment state
4. Test each state manually via Agent Preview with different seed data

### Proposal 3: Calendar Context Enrichment (Hypothesis B)

**What changes:**

| Component | Current | Proposed |
|-----------|---------|----------|
| `week-calendar.tsx` session cards | Sport icon, name, duration, status | Add: intent pill, role badge, target zones, adaptation indicator |
| Calendar page header | Week navigation only | Add: block label ("Build Week 3 of 4"), phase indicator |
| `CoachNoteCards` | Rendered above calendar | Move inline: adaptation badge on affected session cards |
| Calendar data fetch | Sessions + activities + links + rationales | Add: `training_weeks.focus` for current week |

**What stays:**
- Calendar week navigation
- Session filtering (by status, by sport)
- Session actions (skip, move, mark extra, link activity)
- WeekCalendar grid layout

**Migration path:**
1. Add block context query to `calendar/page.tsx`
2. Expand session card rendering in `week-calendar.tsx`
3. Add inline adaptation indicator to session cards
4. Test with various session configurations

### Proposal 4: Ambient Coach Entry Points (Hypothesis E, Phase 1)

**What changes:**

| Surface | Change |
|---------|--------|
| Session Review (`sessions/[sessionId]/page.tsx`) | Add "Ask Coach about this session" button below verdict |
| Dashboard (`TrainingScoreCard`) | Add "Explain my score" link |
| Calendar (`CoachNoteCards`) | Update "Let's discuss" href to include rationale as `prompt` param |
| Debrief (`debrief/page.tsx`) | Add "Discuss with Coach" button in header |

**All changes are Link additions** — no new components, no data model changes, no API changes.

**Migration path:**
1. Add Link components to each surface
2. Verify Coach page handles `prompt` searchParam correctly (already implemented)
3. Test each entry point

---

## 5c. Prioritised Redesign Roadmap

| Priority | Change | Moments Improved | Effort | Risk | Description |
|----------|--------|-------------------|--------|------|-------------|
| **1** | Post-upload guided flow | M3, M1, M4 | Medium (2-3d) | Low | After upload/sync, redirect to Session Review with feel-first guided flow. Add RecentUploadCard to Dashboard for Strava syncs. Eliminates the biggest dead-end in the app. |
| **2** | Ambient Coach entry points (Phase 1) | M7, M6, M3, M5 | Small (<1d) | Low | Add "Ask Coach" deep links on Session Review, Dashboard score, Calendar rationale, and Debrief. Just Link additions with `prompt` searchParam. |
| **3** | Calendar context enrichment | M2, M1, M8 | Medium (2-3d) | Low | Add intent/role/target to Calendar session cards. Add block context to weekly header. Move adaptation rationale inline with affected sessions. |
| **4** | Re-enable Morning Brief | M1, M9, M2 | Small (1d) | Low | Un-comment `MorningBriefCard` on Dashboard. The component and generation logic already exist. May need minor updates to the card design. |
| **5** | Enrich WeeklyDebriefCard on Dashboard | M5, M9, M10 | Small (<1d) | Low | Show executive summary and share button directly on the Dashboard debrief card. Eliminates need to open full Debrief for quick review and sharing. |
| **6** | Context-aware Dashboard ordering | M1, M4, M9 | Medium (2-3d) | Medium | Implement `getDashboardMoment()` to reorder cards based on detected state. Requires careful testing of all moment states. |
| **7** | Session Review forward navigation | M3, M5, M7 | Small (<1d) | Low | Add "Back to Calendar", "View next session", "See week impact" links to Session Review. Eliminates dead-end navigation. |
| **8** | Readiness state on Dashboard | M1, M2, M4 | Small (1d) | Low | Surface TSB readiness label ("fresh"/"fatigued") on Dashboard. Data already computed by fitness-model.ts. Just needs a UI component. |
| **9** | Discipline balance on Dashboard | M4, M1 | Small (1d) | Low | Add a compact discipline balance indicator to Dashboard. Data computed by discipline-balance.ts. Currently only on Plan. |
| **10** | Coach "Let's discuss" context passing | M6, M7 | Small (<1d) | Low | Update Calendar CoachNoteCard "Let's discuss" to pass rationale text as `prompt` searchParam. One-line href change. |
| **11** | Slide-up Coach panel (Phase 2) | M7, M6, M3 | Large (3-5d) | Medium | Implement a bottom-sheet Coach panel accessible from any surface. Requires new layout component and state management. |
| **12** | Monday transition unified flow | M9 | Medium (2-3d) | Medium | Combine Transition Briefing + Debrief + Week Ahead into a sequential "Monday morning" flow on the Dashboard. |
| **13** | Race context on Calendar | M8, M2 | Small (1d) | Low | Add race markers and "X weeks to race" to Calendar weekly header. Requires fetching race_profiles data. |
| **14** | Schedule change wizard | M6 | Large (3-5d) | Medium | A "Change my schedule" modal on Calendar that takes date constraints and proposes a rebalanced week. Requires adaptation engine integration. |
| **15** | Session-level sharing | M10 | Medium (2-3d) | Low | Extend share functionality to individual session achievements/verdicts. Requires new OG image template. |

### Quick Wins (< 1 day each, ship this week)

1. Ambient Coach deep links (Priority 2)
2. Enrich Dashboard debrief card (Priority 5)
3. Session Review forward navigation (Priority 7)
4. Coach context passing fix (Priority 10)

### Medium Wins (1-3 days each, ship next sprint)

5. Post-upload guided flow (Priority 1)
6. Re-enable Morning Brief (Priority 4)
7. Calendar context enrichment (Priority 3)
8. Readiness state on Dashboard (Priority 8)
9. Discipline balance on Dashboard (Priority 9)

### Larger Initiatives (3-5 days, plan for next cycle)

10. Context-aware Dashboard (Priority 6)
11. Monday transition flow (Priority 12)
12. Slide-up Coach panel (Priority 11)
13. Schedule change wizard (Priority 14)

---

### Surface Model Recommendation

**Keep the six-surface model** — but redefine the roles:

| Surface | Current Role | Proposed Role |
|---------|-------------|---------------|
| **Dashboard** | Static week overview | **Context-aware command center** — adapts to the athlete's moment, proactively surfaces the most relevant intelligence |
| **Plan** | Week-by-week editing + strategy | **Strategy & periodisation only** — season view, block overview, discipline balance, intensity profiles. NOT for daily execution context. |
| **Calendar** | Weekly schedule view | **Execution command center** — sessions with full context (intent, target, block, adaptation), session-level actions, race markers |
| **Coach** | Briefing + chat | **Universal advisor** — accessible from everywhere via ambient entry points + dedicated deep-dive surface |
| **Session Review** | Post-session verdict | **Post-session guided flow** — feel → verdict → implications → forward navigation. NOT a dead end. |
| **Debrief** | End-of-week synthesis | **Week reflection + forward planning** — debrief + link to next week. Also accessible as rich card on Dashboard. |

No surfaces are removed. No new surfaces are added. The intelligence stays where it is. The change is in *how and when each surface is reached* and *what context it includes*.

---

*Continue to Part 6: Appendix — Suggested Flows*
