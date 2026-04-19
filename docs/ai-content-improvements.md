# AI-Generated Content — Improvement Plan

_Captured 2026-04-19. Scope: the one-shot AI content shipped to athletes (session reviews, session verdicts, weekly debriefs, morning briefs, week-transition briefs). Does NOT cover the interactive coach chat._

## Current state

All generators run on `OPENAI_COACH_MODEL` (= `gpt-5-mini`), Zod-schema-enforced JSON, single attempt → deterministic fallback. `OPENAI_REASONING_MODEL` (`gpt-5.4`) is defined but unused. No prompt caching, no eval harness, no cross-generator A/B.

| Generator | File | Storage | Reasoning effort |
|---|---|---|---|
| Execution Review (`CoachVerdict`) | `lib/execution-review.ts` | `sessions.execution_result`, `session_verdicts.raw_ai_response` | `low` |
| Session Verdict | `lib/ai/prompts/session-verdict.ts` | `session_verdicts` | default |
| Weekly Debrief | `lib/weekly-debrief/narrative.ts` | `weekly_debriefs.narrative` | default |
| Morning Brief | (not yet mapped) | `morning_briefs` | — |
| Week Transition Brief | (not yet mapped) | `week_transition_briefings` | — |

## Problems (from 22 real `session_verdicts` + 5 `weekly_debriefs`)

1. **Templated feel** — 4 of 5 weekly debriefs have identical `takeaway_title: "The week had one clear strength and one clear wobble"`. Only two `coach_headline` variants across all weeks.
2. **No cross-session comparison** — reviews treat each workout in isolation.
3. **Rich DB signals never injected** — `completed_activities.environment` (weather), HR/pace zone distributions, aerobic decoupling, historical same-type sessions, rolling Z2-pace-at-HR.
4. **One-shot only** — no pattern detection across days (e.g. "fatigue ≥4 + stress 4 + CTL climbing → historically precedes illness").
5. **No physiology teaching** — prompts ban jargon but never explain mechanisms.
6. **Under-powered model choice** — `gpt-5-mini` + `effort: low` for flagship content; `gpt-5.4` unused.
7. **Feedback loop only on weekly** — `session_verdicts` has no `helpful`/`accurate` capture.
8. **Truncation bugs** — `adaptation_context` ends mid-word ("after your 10").
9. **No insight floor** — prompts require fidelity, never require a non-obvious finding. Model defaults to safe restatement.

## The 5 stages

### Stage 1 — Evaluation foundation
- 6-axis rubric (fidelity, insight-depth, specificity, teach-value, actionability, voice-variance)
- Golden set: freeze ~20 sessions + 5 weeks from prod DB, hand-written ideal outputs
- `npm run eval:coach` — runs candidate prompt, LLM-as-judge scoring, diff report
- Add `helpful`/`accurate` capture on `session_verdicts` (weekly already has it)

### Stage 2 — Inject the missing signals  ← **IN PROGRESS**
Expand `athlete-context.ts` and per-session evidence builder:
- **Historical comparables**: last 3-5 same-intent-category sessions — pace/HR/power/execution-score/date
- **Aerobic decoupling**: HR-drift-to-pace/power ratio for endurance sessions
- **Zone distributions**: `hrZoneTimeSec`/`paceZoneTimeSec` → "% time Z1/Z2/…" strings
- **Weather**: `completed_activities.environment.temperature/humidity/wind`
- **Rolling trends**: 4/8/12-week moving avg of Z2 pace-at-HR, HR-at-easy-pace
- **Cadence halves / pacing halves** (already collected, not in context)
- **Feel × performance correlation**: "when fatigue ≥4, execution score avg 68; fatigue ≤2 → 84"
- **Day-of-week performance pattern** (if consistent)
- **Consecutive-hard-day count** going into this session

### Stage 3 — Prompt surgery
- **3.1 — `nonObviousInsight` field** (all 3 schemas, 280 chars) ← **IN PROGRESS**. Must reference a signal the athlete wouldn't see by glancing at the session.
- **3.2 — `teach` field** (optional, 200 chars) — explains *why* a metric matters when session exposes it (VI spike, decoupling, negative-split failure). Rotate focus.
- **3.3 — Few-shot examples** — 2-3 per generator from golden set.
- **3.4 — Variance prompt** — pass prior 4 headlines, instruct model not to reuse phrasings.
- **3.5 — Two-pass weekly debrief**: analytic pass (`gpt-5.4`, `effort: medium`) → structured findings, then narrative pass (`gpt-5-mini`) → voice/formatting.
- **3.6 — Bump execution-review `effort: medium`** for key sessions only.

### Stage 4 — New generator: Progress Report (every 4 weeks or end-of-block)
Compares current 4wk block vs. previous: pace-at-HR by discipline, CTL trajectory, durability (late-session fade), peak performances. Uses `gpt-5.4` + `effort: medium`. Tells athlete "you're getting fitter at X, here's the evidence."

### Stage 5 — Tooling polish
- Retry with alternate prompt on schema-fail before deterministic fallback
- Prompt versioning + A/B (`ai_prompt_version` column already exists)
- Fix truncation — cap `max_output_tokens` on weekly_debrief
- OpenAI prompt caching — restructure so instructional scaffolding is cacheable prefix

## Current work — Stage 2 + Stage 3.1

**Branch:** `feat/ai-signals-insight` at `.claude/worktrees/ai-signals-insight`.

**Signals injected (priority order):**
1. Historical comparables (highest ROI)
2. `nonObviousInsight` field in `CoachVerdict`, `SessionVerdictOutput`, `WeeklyDebriefNarrative` schemas + prompts
3. Aerobic decoupling for endurance
4. Weather from `completed_activities.environment`
5. Zone distributions (HR + pace)
6. Rolling trends (4/8/12wk)
7. Consecutive-hard-day count
8. Feel × performance correlation

**Files expected to change:**
- `lib/athlete-context.ts` — add historical comparables + rolling trends + feel-performance correlation
- `lib/execution-review.ts` + `lib/execution-review-types.ts` — evidence expansion + `nonObviousInsight` field
- `lib/ai/prompts/session-verdict.ts` — context expansion + `nonObviousInsight`
- `lib/weekly-debrief/narrative.ts` + `lib/weekly-debrief/types.ts` — `nonObviousInsight` + reference new signals
- New: `lib/analytics/decoupling.ts`, `lib/analytics/historical-comparables.ts`, `lib/analytics/rolling-trends.ts`

**Success criteria for this PR:**
- Every new signal is computed from existing DB columns only (no new migrations)
- Prompts are updated to describe the new signals and must produce a `nonObviousInsight`
- Typecheck + tests pass
- Spot-check 3 DB-real sessions with the new prompt; headlines/insights differ from current prod output
