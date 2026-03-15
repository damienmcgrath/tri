# tri.ai Product Spec v2 — Implementation Plan

## Context

tri.ai is a triathlon coaching app (Next.js 14, Supabase, OpenAI, Tailwind) with 6 core surfaces: Dashboard, Calendar, Plan, Coach, Session Review, Weekly Debrief. The product spec v2 (`docs/tri_ai_product_spec_v2.md`) defines foundation improvements and new features across 3 phases. This plan maps that spec to concrete implementation tasks against the current codebase.

**Key gaps confirmed by exploration:** No `macro-context.ts`, `adaptation-rules.ts`, `session-comparison.ts`, `trends.ts`, or `ambient-signals.ts` exist yet. No `adaptations` or `session_feels` tables. No `/api/coach/adaptation/` or `/api/weekly-debrief/week-ahead/` routes.

---

## Phase 1: Foundation Improvements (Weeks 1-2)

### 1.1 Macro-arc context library
**Create** `lib/training/macro-context.ts`
- Export `getMacroContext(supabase, athleteId): Promise<MacroContext>`
- Derives block position by grouping consecutive `training_weeks` with same `focus` value
- Computes: `raceName`, `raceDate`, `daysToRace`, `currentBlock`, `blockWeek`, `blockTotalWeeks`, `cumulativeVolumeByDiscipline` (swim/bike/run with planned/actual/deltaPct)
- Reuse `inferPhase` pattern from `lib/athlete-context.ts` (lines 103-114)
- Query `training_weeks` + `sessions` + `profiles` (race info)
- **Test:** `lib/training/macro-context.test.ts` — unit tests for block grouping and volume computation

### 1.2 Surface macro-arc in debrief header (depends on 1.1)
**Modify** `app/(protected)/debrief/page.tsx`
- Call `getMacroContext` in the page's data fetch (parallel with existing queries)
- Add a context bar above the hero: "Week 3 of 6 — Build Phase — Warsaw 70.3 in 84 days"
- Add cumulative volume note: "Bike volume: on track (−4%) | Run volume: 15% behind plan"
- Use existing `.label` + `.debrief-kicker` CSS classes

### 1.3 Surface macro-arc in coach briefing (depends on 1.1)
**Modify** `lib/coach/tool-handlers.ts`
- In `get_athlete_snapshot` handler, also call `getMacroContext` and include in returned object
- Coach AI will see block position and cumulative volume alongside athlete snapshot

**Modify** `lib/coach/instructions.ts`
- Add instruction: "Reference the athlete's training block position naturally — one sentence in briefings"

### 1.4 Dashboard simplification — 3-zone layout
**Modify** `app/(protected)/dashboard/page.tsx` (945 lines — highest-touch file)

Current state: two-column grid with progress card, "what matters now" card, debrief card, plus separate contextual items (attention/focus cards). Too many competing elements.

Target 3-zone layout:
- **Zone 1 (Weekly Progress):** Keep existing left-column progress article (completion %, progress bar, day chips, completed/remaining/missed). Remove redundant sport-breakdown grid.
- **Zone 2 (What Matters Now):** Merge contextual items (attention + focus cards, currently separate articles at lines ~907-942) INTO the right-column "what matters now" card as sub-sections.
- **Zone 3 (Weekly Narrative):** Keep `WeeklyDebriefCard` as the third section. Add inline `executiveSummary` teaser from debrief facts.

Key change: collapse the 4-5 card layout into exactly 3 distinct zones.

### 1.5 Information deduplication audit (depends on 1.4)
Cross-surface review to enforce canonical locations per the spec's table (Section 5C):
- Weekly completion stats: canonical on Dashboard Zone 1, reference-only in Debrief stat row
- Weekly narrative headline: canonical in Debrief, Dashboard Zone 3 shows headline + link only
- "What matters right now": canonical on Dashboard Zone 2 only
- Session execution details: canonical in Session Review, coach references by linking
- Modify: `dashboard/page.tsx`, `debrief/page.tsx`, `lib/weekly-debrief.ts` (narrative generation prompt)

### 1.6 Coach thread cleanup and grouping
**Modify** `app/(protected)/coach/page.tsx` + `app/(protected)/coach/components/coach-chat.tsx`
- Group threads by week using `created_at` (derive Monday start with `getMonday` from `week-context.ts`)
- Show max 5 threads in "This week", 3 in "Last week", "Older" collapsed with count badge
- Auto-generate thread titles from first user message (truncate 40 chars) — stored in `ai_conversations.title`
- Add "..." menu per thread with Delete option

**Optional migration:** `supabase/migrations/YYYYMMDD_add_conversation_archived_at.sql` — add `archived_at timestamptz` to `ai_conversations`

---

## Phase 2: New Features — Core (Weeks 3-5)

### 2.1 Migration: `session_feels` table
**Create** `supabase/migrations/YYYYMMDD_add_session_feels.sql`
- Schema per spec Section 6C: `id`, `user_id`, `session_id` (unique), `rpe` (1-10), `note`, `was_prompted`, `created_at`
- RLS: `user_id = auth.uid()` for all operations
- Index on `(user_id, session_id)`

### 2.2 Migration: `adaptations` table
**Create** `supabase/migrations/YYYYMMDD_add_adaptations.sql`
- Schema per spec Section 6B: `id`, `athlete_id`, `user_id`, `week_id`, `trigger_type`, `trigger_session_id`, `options` (jsonb), `selected_option`, `status`, `model_used`, `created_at`, `applied_at`
- RLS: `athlete_id = auth.uid()`
- Index on `(athlete_id, week_id, status)`

### 2.3 Post-session feel capture — RPE banner (depends on 2.1)
**Create** `app/(protected)/sessions/[sessionId]/components/feel-capture-banner.tsx`
- Client component: RPE 1-10 selector + optional note (200 chars) + Save/Skip
- Appears once per session, dismissed permanently on Save or Skip
- Pattern: follow `weekly-checkin-card.tsx` inline card style

**Create** `app/api/session-feels/route.ts`
- POST: Zod-validated upsert to `session_feels`, follows `app/api/athlete-checkin/route.ts` pattern

**Modify** `app/(protected)/sessions/[sessionId]/page.tsx`
- Query `session_feels` for this session in page data fetch
- Render `FeelCaptureBanner` at top of completed session reviews when no feel exists

### 2.4 Session comparison library
**Create** `lib/training/session-comparison.ts`
- Export `getSessionComparison(supabase, sessionId, athleteId): Promise<SessionComparison | null>`
- Match by `sessions.type` + `sessions.sport` first, fallback to sport + similar duration (±20%)
- Compare metrics per sport (from `metrics_v2` JSONB): run (avgHr, avgPaceSecPerKm, duration), bike (avgPower, normalizedPower, avgHr), swim (avgPacePer100mSec, avgSwolf)
- Return: `{ metric, current, previous, delta, direction, previousDate }[]` + previous session date
- Reuse `parsePersistedExecutionReview` from `lib/execution-review.ts` for execution scores

### 2.5 Session comparison UI card (depends on 2.4)
**Create** `app/(protected)/sessions/[sessionId]/components/session-comparison-card.tsx`
- "Compared to last time" card with metric deltas (green/red arrows)
- Uses `.surface` card pattern with `.stat` and `.stat--success`/`.stat--warning` classes

**Modify** `app/(protected)/sessions/[sessionId]/page.tsx`
- Call `getSessionComparison` in page data fetch
- Render comparison card below execution review when data exists

### 2.6 Adaptation rules engine (depends on 2.2)
**Create** `lib/training/adaptation-rules.ts`
- Export `evaluateAdaptationTriggers(weekSessions, checkIn, macroCtx): AdaptationTrigger[]`
- Deterministic rules (no AI):
  - Never add volume to a day with a key session
  - Never suggest >2 sessions/day
  - Never suggest training on a planned rest day without opt-in
  - Key sessions protected — move before cut
  - Recovery/optional sessions dropped first
  - If <2 days remain, don't redistribute — carry insight forward
- Export `buildAdaptationOptions(trigger, remainingSessions, constraints): AdaptationOption[]`
- Each option: what changes, what stays, projected completion %, key session impact

### 2.7 Adaptation AI enrichment + API (depends on 2.6, 1.1)
**Create** `app/api/coach/adaptation/route.ts`
- POST: runs `evaluateAdaptationTriggers` for deterministic assessment
- Sends to OpenAI (`gpt-5.4` deep model) with athlete context + macro context for 2-3 natural language adaptation options
- Persists to `adaptations` table
- Returns enriched suggestions
- Rate limited via Upstash
- Pattern: follows `app/api/weekly-debrief/refresh/route.ts`

**Risk mitigation:** Show deterministic suggestions immediately; AI enrichment loads asynchronously.

### 2.8 Adaptation UI on calendar (depends on 2.7)
**Modify** `app/(protected)/calendar/page.tsx`
- Query pending adaptations for current week
- Pass to `WeekCalendar` as props

**Modify** `app/(protected)/calendar/components/week-calendar.tsx`
- Banner at top: "Your week has shifted. Would you like adaptation suggestions?"
- Side panel/modal with 2-3 options showing changes, rationale, projected impact
- Accept/Dismiss buttons

**Modify** `app/(protected)/calendar/actions.ts`
- `acceptAdaptationAction`: update target sessions, mark adaptation `status = 'applied'`
- `dismissAdaptationAction`: mark `status = 'dismissed'`

### 2.9 Week Ahead preview (depends on 1.1)
**Create** `lib/training/week-preview.ts`
- Export `generateWeekPreview(supabase, athleteId, weekStart): Promise<WeekPreview>`
- Data assembly: planned volume, key sessions, sport distribution, macro context, carry-forward from previous debrief
- Reuse: `computeWeekMinuteTotals`, `getKeySessionsRemaining` from `lib/training/week-metrics.ts`

**Create** `app/api/weekly-debrief/week-ahead/route.ts`
- POST: calls `generateWeekPreview`, optional short AI narrative (1-2 sentences)

**Create** `app/(protected)/dashboard/components/week-ahead-card.tsx`
- Server component shown on Sunday/Monday: volume total, key sessions, carry-forward, phase context

**Modify** `app/(protected)/dashboard/page.tsx`
- Conditionally render `WeekAheadCard` on Sunday/Monday

### 2.10 Check-in data integration into AI prompts
**Modify** `lib/coach/instructions.ts`
- Add coaching heuristics: "When check-in fatigue >= 4, recommend protecting recovery. When confidence is low, adopt more supportive tone."

**Modify** `lib/weekly-debrief.ts`
- Include check-in data (from `athlete_checkins`) in debrief AI prompt when available for that week
- Reference in narrative: "You reported high stress this week..."

---

## Phase 3: Enhancement (Weeks 6-8)

### 3.1 Shareable weekly summary card
**Create** `app/(protected)/debrief/components/share-summary-button.tsx`
- Client component using browser Canvas API to render 1080x1920 (story) and 1080x1080 (square) variants
- Dark background (`#0a0a0b`), lime accent (`#beff00`), sport-colored stacked bar chart, tri.ai wordmark
- Content from `weekly_debriefs.facts` JSONB: week number, completion, daily volume, debrief headline, race countdown
- Downloads as PNG via `canvas.toBlob()` + download link

**Modify** `app/(protected)/debrief/page.tsx`
- Add "Share this week" button in debrief header when artifact exists

### 3.2 Multi-week trend detection (4+ weeks)
**Create** `lib/training/trends.ts`
- Export `detectTrends(supabase, athleteId, weekCount = 6): Promise<WeeklyTrend[]>`
- Consistent direction over 3+ data points = trend
- Improvement: lower HR at same/faster pace, higher power at same HR, faster pace at same RPE
- Concern: rising HR at same pace, declining power, increasing RPE for same workload
- Returns: `{ metric, direction, dataPoints, detail, confidence }[]`

### 3.3 Trends in debrief and session review (depends on 3.2, 2.5)
**Modify** `app/(protected)/debrief/page.tsx`
- Add "Trends" section with 1-3 notable trends (after carry-forward section)

**Modify** `app/(protected)/sessions/[sessionId]/components/session-comparison-card.tsx`
- Below "compared to last time", add mini trend sparkline when 4+ data points exist

### 3.4 Plan view elevation
**Modify** `app/(protected)/plan/plan-editor.tsx`
- Key session indicators: lime dot/badge on session cards where `is_key = true`
- Sport-color left border on session cards (using existing sport color constants)
- Session intent notes visible on hover (from `sessions.notes` or `sessions.intent_category`)

**Modify** `app/(protected)/plan/page.tsx`
- Add weekly load shape visualization: stacked horizontal bar chart (CSS bars, no charting library) showing planned minutes by discipline per day
- Week-over-week volume delta display: "+30 min vs last week"
- Toggle between single-week and multi-week (4-6 week condensed) view

### 3.5 Ambient check-in intelligence
**Create** `lib/training/ambient-signals.ts`
- Export `detectAmbientSignals(supabase, athleteId): Promise<AmbientSignal[]>`
- Signal sources: skip reasons, duration shortfalls, RPE trends, execution score decline, session gaps
- Each signal: `{ type, severity, label, detail, evidence[] }`
- Builds on existing `athlete_observed_patterns` table

**Modify** `lib/coach/tool-handlers.ts`
- Include ambient signals in `get_athlete_snapshot` response

**Modify** `lib/coach/instructions.ts`
- Add instructions for interpreting ambient signals

### 3.6 Execution score explanation
**Modify** `app/(protected)/sessions/[sessionId]/page.tsx`
- Add expandable "How is this scored?" section below execution score
- Show factors: duration match, intensity match, intent alignment, split consistency
- Data already available in parsed `execution_result` — use `parsePersistedExecutionReview` from `lib/execution-review.ts`
- Use `DetailsAccordion` component pattern from `app/(protected)/components/details-accordion.tsx`

---

## Dependency Graph

```
Phase 1 (parallel starts):
  1.1 macro-context ──┬── 1.2 debrief header
                      └── 1.3 coach briefing
  1.4 dashboard simplify ── 1.5 dedup audit
  1.6 coach thread cleanup (independent)

Phase 2 (after Phase 1):
  2.1 session_feels migration ── 2.3 RPE banner
  2.2 adaptations migration ── 2.6 rules ── 2.7 AI + API ── 2.8 calendar UI
  2.4 comparison lib ── 2.5 comparison UI
  1.1 ── 2.9 week preview ── dashboard card
  2.10 check-in wiring (independent)

Phase 3 (after Phase 2):
  3.1 shareable card (independent)
  3.2 trends lib ── 3.3 trends UI (also needs 2.5)
  3.4 plan elevation (independent)
  3.5 ambient signals ── coach integration
  3.6 execution explanation (independent)
```

## New Database Migrations Required

1. `YYYYMMDD_add_conversation_archived_at.sql` (Task 1.6, optional) — `archived_at` on `ai_conversations`
2. `YYYYMMDD_add_session_feels.sql` (Task 2.1) — `session_feels` table with RLS
3. `YYYYMMDD_add_adaptations.sql` (Task 2.2) — `adaptations` table with RLS

## Recommended Execution Order

| Week | Tasks | Notes |
|------|-------|-------|
| 1 | 1.1, 1.4, 1.6, 2.1, 2.2 | All independent — parallelize |
| 2 | 1.2, 1.3, 1.5, 2.4, 2.10 | Depend on week 1 outputs |
| 3 | 2.3, 2.5, 2.6, 2.9 | New feature cores |
| 4 | 2.7, 2.8, 2.10 (week ahead UI) | Feature integration |
| 5 | 3.2, 3.4, 3.5, 3.6 | Enhancement libraries + independent UI |
| 6 | 3.1, 3.3 | Enhancement integration + polish |

## Highest-Risk Items

1. **Dashboard simplification (1.4)** — 945-line server component with complex state derivation. Risk: regressions in day-chip rendering, diagnosis signals. Mitigation: extract zones into separate components before restructuring.
2. **Adaptation engine (2.6-2.8)** — Most architecturally novel feature. Calendar UI touches 800+ line client component. Mitigation: start with "missed key session" trigger only, add more incrementally.
3. **Adaptation AI latency (2.7)** — New AI call in calendar view path. Mitigation: show deterministic suggestions immediately, enrich with AI asynchronously.
4. **Macro-context API shape (1.1)** — 5 downstream consumers depend on this type. Mitigation: freeze `MacroContext` type interface before implementing consumers.
5. **Shareable card rendering (3.1)** — Canvas rendering on Vercel may need client-side approach. Mitigation: use browser Canvas API, not server-side.

## Verification

After each phase, verify:
- **Phase 1:** Dashboard loads with 3 clear zones, no duplicate information across surfaces. Debrief shows macro-arc header. Coach briefing mentions block position.
- **Phase 2:** RPE banner appears on completed session reviews. Session comparison card shows on recurring sessions. Adaptation banner appears on calendar after skipping a session. Week ahead card shows on Sunday/Monday.
- **Phase 3:** Share button generates PNG from debrief. Trends section appears in debrief after 4+ weeks. Plan view shows load shape and key session indicators.

Run `npm test` after each task. Manual verification via preview deployment for UI changes.

## Key Existing Files Reference

| File | Purpose | Lines |
|------|---------|-------|
| `app/(protected)/dashboard/page.tsx` | Dashboard — restructure to 3 zones | ~945 |
| `app/(protected)/debrief/page.tsx` | Debrief — add macro-arc, trends, share | — |
| `app/(protected)/calendar/page.tsx` | Calendar — add adaptation UI | — |
| `app/(protected)/calendar/components/week-calendar.tsx` | Week grid — adaptation banner | ~800 |
| `app/(protected)/plan/plan-editor.tsx` | Plan editor — elevation | ~688 |
| `app/(protected)/sessions/[sessionId]/page.tsx` | Session review — RPE, comparison, explanation | — |
| `app/(protected)/coach/components/coach-chat.tsx` | Coach chat — thread cleanup | — |
| `lib/athlete-context.ts` | AthleteContextSnapshot — reuse patterns | — |
| `lib/weekly-debrief.ts` | Debrief generation — check-in integration | — |
| `lib/execution-review.ts` | Execution review — reuse for comparison | ~1220 |
| `lib/training/week-metrics.ts` | Week metrics — reuse for preview | — |
| `lib/coach/tool-handlers.ts` | Coach tools — add macro-arc, ambient signals | — |
| `lib/coach/instructions.ts` | System prompt — add check-in heuristics | — |
| `app/api/coach/chat/route.ts` | Streaming SSE — reference pattern | ~627 |
| `app/api/weekly-debrief/refresh/route.ts` | Debrief API — reference pattern | — |
| `globals.css` | Design system — all component classes | ~738 |

## New Files to Create

| File | Task | Purpose |
|------|------|---------|
| `lib/training/macro-context.ts` | 1.1 | Block position + cumulative volume |
| `lib/training/macro-context.test.ts` | 1.1 | Unit tests |
| `lib/training/session-comparison.ts` | 2.4 | Session-to-session metric comparison |
| `lib/training/adaptation-rules.ts` | 2.6 | Deterministic adaptation constraints |
| `lib/training/week-preview.ts` | 2.9 | Week ahead data assembly |
| `lib/training/trends.ts` | 3.2 | Multi-week trend detection |
| `lib/training/ambient-signals.ts` | 3.5 | Behavioral signal detection |
| `app/api/session-feels/route.ts` | 2.3 | RPE capture endpoint |
| `app/api/coach/adaptation/route.ts` | 2.7 | Adaptation generation endpoint |
| `app/api/weekly-debrief/week-ahead/route.ts` | 2.9 | Week preview endpoint |
| `app/(protected)/sessions/[sessionId]/components/feel-capture-banner.tsx` | 2.3 | RPE banner component |
| `app/(protected)/sessions/[sessionId]/components/session-comparison-card.tsx` | 2.5 | Comparison card component |
| `app/(protected)/dashboard/components/week-ahead-card.tsx` | 2.9 | Week preview card |
| `app/(protected)/debrief/components/share-summary-button.tsx` | 3.1 | Shareable image generator |
