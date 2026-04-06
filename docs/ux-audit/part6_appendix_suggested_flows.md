# tri.ai UX Flow Analysis & Architecture Audit

## Part 6: Appendix — Suggested Ideal Flows

For each of the 10 moments, the *ideal* flow (post-redesign) is shown alongside the current flow.

---

## Moment 1: Morning Check-In

### Current Flow (6-8 taps to full understanding)
```
Open app → Dashboard
  → See week % and hours (volume only)
  → See "What matters right now" card (session name + duration, NO intent/purpose)
  → [No readiness indicator]
  → [No Morning Brief — disabled]
  → [Adaptation rationales only on Calendar — must navigate]
  → To see session purpose → Calendar → tap session → Session Review
```

### Ideal Flow (1-2 taps)
```
Open app → Dashboard (moment-aware: "morning check-in" state)
  → Morning Brief card at top:
    "Good morning. You're feeling fresh (TSB +12). 
     Today: Easy Run, 45 min. Purpose: aerobic recovery before Thursday's key intervals.
     Keep HR below 150. This week: 62% complete, on track."
  → [If adaptation happened overnight]: inline alert
    "Your Thursday intervals moved to Friday — you skipped Wednesday's swim. See rationale."
  → Today's session card shows: name + duration + intent + target zones
  → Tap "Open session" → Calendar with session focused (intent visible on card)
```

**What changed:** Morning Brief re-enabled. Readiness state surfaced. Session intent on Dashboard card. Adaptation rationale on Dashboard (not just Calendar).

---

## Moment 2: Pre-Session Preparation

### Current Flow (5-8 taps)
```
Dashboard → tap "Open session" → Calendar → find session card
  → Card shows: sport, name, duration, status
  → [No intent, no target, no block context]
  → Tap card → Session Review page
  → See full session details with target
  → [Block context requires visiting Plan page]
  → [Adaptation rationale is a separate card above calendar, not inline]
```

### Ideal Flow (2-3 taps)
```
Dashboard → tap "Open session" → Calendar with focused session
  → Session card shows:
    "Easy Run · 45 min · Recovery session
     Target: Z2, HR 140-150
     Build Week 3 · Protecting Thursday's key intervals"
  → [If adapted]: "Adapted: moved from Wednesday. Reason: swim was skipped."
  → Tap for more detail → Session Review (with "Back to Calendar" link)
  → [No need to visit Plan for purpose/block context]
```

**What changed:** Calendar session cards include intent, target, role, block context. Adaptation rationale inline with the affected card.

---

## Moment 3: Post-Session Upload & Review

### Current Flow (8-12 taps)
```
Settings → Integrations → upload file → see status in table
  → [DEAD END — no forward navigation]
  → Manually navigate to Calendar → find session → tap → Session Review
  → See verdict card (may still be loading)
  → See feel capture banner
  → Capture feel
  → [No adaptation preview]
  → [No "what happens next" navigation]
  → Must navigate back to Dashboard or Calendar via nav tabs
```

### Ideal Flow (3-4 taps)
```
Upload file (from Dashboard upload button or Strava auto-sync)
  → Auto-redirect to /sessions/[matchedId]?postUpload=true

  Step 1: Feel Capture (full-width, prominent)
    "How did that run feel?" → tap 1-5 + optional details → Save

  Step 2: Session Verdict (appears after feel saved)
    "Your Easy Run landed: Execution Score 87 — On Target.
     You held Z2 HR throughout. Recovery intent achieved."

  Step 3: Week Impact (below verdict)
    "This week: 74% complete. Next key session: Thursday intervals.
     No adaptation needed — you're on track."

  Step 4: Forward navigation
    "Back to Dashboard" | "View next session" | "Ask Coach about this"

For Strava sync (no manual upload):
  Open app → Dashboard shows notification card:
    "New activity synced: Easy Run (45 min). How did it feel?"
    → Tap → enters same guided flow
```

**What changed:** Post-upload redirect. Guided linear flow (feel → verdict → impact). Forward navigation. Dashboard notification for Strava syncs.

---

## Moment 4: Mid-Week Check — "Am I On Track?"

### Current Flow (3-6 taps)
```
Dashboard → see completion %, status chip, contextual signals
  → [Training Score shows number, dimensions collapsed by default]
  → [No discipline balance — must go to Plan]
  → [No intensity mix — must go to Plan]
  → To see full picture: Dashboard + Plan → 2 surfaces
```

### Ideal Flow (1 tap — just open Dashboard)
```
Dashboard (moment-aware: "mid-week check" state)
  → Week progress card (unchanged — this works well)
  → Training Score with 3 dimensions visible by default:
    "Score: 78 (+3 this week)
     Execution: 85 | Progression: 72 | Balance: 74"
  → Discipline balance indicator (compact):
    "Swim: -12% | Bike: on track | Run: +5%"
  → Readiness indicator:
    "Readiness: Absorbing (TSB -8). Protect tonight's recovery session."
  → Contextual signal cards (unchanged — these work well)
```

**What changed:** Training Score expanded by default. Discipline balance on Dashboard. Readiness state visible. All on one surface.

---

## Moment 5: End-of-Week Reflection

### Current Flow (4-6 taps)
```
Dashboard → WeeklyDebriefCard (title + 3 bullets)
  → Tap "Open debrief" → /debrief page
  → Read narrative, metrics, evidence
  → Scroll to bottom for share button
  → [No forward link to next week]
```

### Ideal Flow (2-4 taps)
```
Dashboard → Enriched WeeklyDebriefCard:
  - Executive summary (1-2 sentences) visible without tap
  - Key metrics inline
  - "Share" button directly on card
  - "Open full debrief" for complete view
  → Tap "Open full debrief" → /debrief page (unchanged)
  → At bottom: "Next week" card:
    "Next week: Build Week 4. 3 key sessions. Focus: increase bike load.
     View next week's plan →"
  → Tap → Calendar for next week
```

**What changed:** Dashboard debrief card richer (summary + share). Debrief page connects forward to next week.

---

## Moment 6: "Something Changed — I Need to Adjust"

### Current Flow (4-8 taps)
```
Option A: Coach → explain constraint → Coach advises but can't execute → 
  manually apply changes on Calendar → no feedback
Option B: Calendar → skip/move sessions one by one → 
  adaptation may fire later → no immediate feedback
```

### Ideal Flow (3-5 taps)
```
Option A (enhanced): Coach → explain constraint → Coach proposes changes →
  "Apply these changes" button → changes applied to Calendar →
  Adaptation rationale auto-generated → visible on Dashboard/Calendar

Option B (enhanced): Calendar → skip session → immediate inline response:
  "Got it. Since you're skipping Wednesday's swim, I've moved
   your key bike intervals to Thursday to protect your long ride Saturday.
   [See full rationale] [Undo]"
  → Rationale visible inline on the affected session cards
```

**What changed:** Coach proposals are actionable (not just advisory). Calendar skip/move triggers immediate adaptation feedback. Rationale appears inline.

---

## Moment 7: Exploring a Training Question

### Current Flow (3-5 taps)
```
Tap "Coach" in nav or "Ask tri.ai" in header → /coach page
  → Scroll past briefing cards to reach chat
  → Type question → get answer
  → [Citations don't link to source data]
  → [No contextual entry points from other surfaces]
```

### Ideal Flow (1-3 taps)
```
From ANY surface: tap contextual "Ask Coach" button
  e.g., Session Review: "Ask about this session"
  e.g., Dashboard score: "Explain my score"
  e.g., Calendar rationale: "Let's discuss this"
  → Coach opens with pre-loaded context (via prompt param)
  → Answer includes tappable citations → link to /sessions/[id] or /activities/[id]
  → Follow-up questions in context

OR: Tap Coach in nav → chat interface prominent (briefing cards collapsed/below)
```

**What changed:** Contextual entry points on every surface. Citations are tappable links. Chat input is above the fold on Coach page.

---

## Moment 8: Season and Race Planning

### Current Flow (6-10 taps)
```
AccountMenu → Settings → Race → add race → saved
  → [No automatic plan impact]
  → Navigate to Plan → see season timeline (if blocks exist)
  → [Calendar has no race markers]
```

### Ideal Flow (3-5 taps)
```
Settings → Race → add race → prompt:
  "Want me to adjust your training blocks for this race?"
  → Yes → AI generates periodisation → shows preview → confirm
  → Calendar now shows: "Race: [name] in 8 weeks" in weekly header
  → Dashboard shows: multi-race awareness in countdown area
```

**What changed:** Race addition triggers periodisation prompt. Race markers on Calendar. Multi-race Dashboard awareness.

---

## Moment 9: Monday Morning Transition

### Current Flow (2-4 taps)
```
Open app → Dashboard
  → See 3 separate cards: Transition Briefing + Debrief Card + Week Ahead
  → Must mentally stitch together the narrative
  → Transition Briefing only Mon/Tue
  → Week Ahead only Sun/Mon
```

### Ideal Flow (1-2 taps)
```
Open app Monday → Dashboard (moment-aware: "monday transition" state)
  → Unified transition card (sequential):
    "Last week: 88% complete. You nailed all 3 key sessions.
     Carry forward: your easy runs drifted 5% too hard — cap HR better this week.
     
     This week: Build Week 4. 8h15m planned. 3 key sessions.
     Focus: Long ride Saturday is the week's centerpiece.
     
     Today: Easy Run, 45 min. Keep it genuinely easy."
  → "Open full debrief" link | "View this week's plan" link
  → Below: regular Dashboard content (week progress, score, etc.)
```

**What changed:** Three cards unified into one sequential narrative. Available every Monday (not time-limited). Forward links to debrief and Calendar.

---

## Moment 10: Sharing Progress

### Current Flow (4-6 taps)
```
Dashboard → tap "Open debrief" → /debrief → scroll to bottom → tap "Share"
  → Modal: choose format → preview → download/share
```

### Ideal Flow (2-3 taps)
```
Dashboard → enriched debrief card has "Share" button directly
  → Tap → Modal: choose format → preview → download/share
  
OR: Session Review → "Share this achievement" button
  → Modal: session-specific share card → download/share
```

**What changed:** Share accessible from Dashboard (not just Debrief page). Session-level sharing available.

---

## Summary: Tap Count Comparison

| Moment | Current Taps | Ideal Taps | Reduction |
|--------|-------------|------------|-----------|
| M1: Morning Check-In | 6-8 | 1-2 | **-75%** |
| M2: Pre-Session Prep | 5-8 | 2-3 | **-60%** |
| M3: Post-Session Upload | 8-12 | 3-4 | **-67%** |
| M4: Mid-Week Check | 3-6 | 1 | **-70%** |
| M5: End-of-Week Reflection | 4-6 | 2-4 | **-40%** |
| M6: Schedule Change | 4-8 | 3-5 | **-40%** |
| M7: Training Question | 3-5 | 1-3 | **-40%** |
| M8: Race Planning | 6-10 | 3-5 | **-50%** |
| M9: Monday Transition | 2-4 | 1-2 | **-50%** |
| M10: Sharing | 4-6 | 2-3 | **-50%** |

**Average tap reduction: ~55%**

The redesign doesn't add features. It doesn't change the data model. It doesn't remove surfaces. It relocates intelligence from where the system produces it to where the athlete needs it. Every proposal preserves the existing components and data flows — the change is in routing, ordering, and cross-linking.

The north star: **"Does this make the app feel more like passive intelligence and less like active burden?"**

Every tap removed is a moment where the app anticipated what the athlete needed instead of making them go find it.

---

*End of tri.ai UX Flow Analysis & Architecture Audit*
