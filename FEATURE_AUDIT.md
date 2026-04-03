# TriCoach AI Feature Audit

_Last updated: April 2026_

---

## 1. Foundation and platform

- [x] Next.js 14 App Router scaffold with TypeScript and Tailwind CSS
- [x] Supabase browser/server clients, middleware auth gate, protected route layout
- [x] Email/password sign-up, sign-in, and password-reset flows (Supabase Auth)
- [x] Dark mode throughout (Geist Sans + Geist Mono, semantic color tokens)
- [x] RLS enforced on all user-owned tables
- [x] Rate limiting on all LLM-calling API routes
- [x] Zod validation on all action/API payloads
- [x] Agent Preview mode for local UI testing without a live Supabase account

---

## 2. Training plan management

- [x] Create, edit, and delete training plans
- [x] Add, edit, and delete planned sessions within a plan
- [x] Plan builder UI with week-grouped session view and plan switching
- [x] Plan change proposals from AI coach with approve/dismiss UI
- [ ] Plan builder templates (sprint tri, Olympic, half-iron presets)

---

## 3. Workout ingestion and activity matching

- [x] FIT and TCX file upload with server-side parsing
- [x] SHA256 dedup per user (`completed_sessions.source_hash`)
- [x] Activity-to-session auto-matching (score ≥ 0.85 to auto-link; ≥ 0.15 margin over second-best)
- [x] Manual linking UI for uploads that fall below the auto-match threshold
- [x] Strava OAuth connect, webhook sync, and cross-source dedup
- [ ] Garmin Health API live sync (manual FIT/TCX upload only; no live Garmin sync)

---

## 4. Dashboard

- [x] Weekly progress (planned vs. completed minutes per sport)
- [x] Daily state chips
- [x] Contextual attention and focus items
- [x] Race countdown
- [x] Week-ahead preview card

---

## 5. Calendar

- [x] Week view with session cards
- [x] Drag-and-drop rescheduling
- [x] Adaptation suggestions surfaced inline

---

## 6. AI Coach

- [x] Streaming chat interface (`/coach`) with conversation history
- [x] OpenAI streaming via `POST /api/coach/chat` (model configurable via `OPENAI_MODEL`)
- [x] System prompt with coaching tone and safety/medical guardrails (`lib/coach/instructions.ts`)
- [x] Athlete context injected into every request (profile, active plan, recent activities)
- [x] Coach memory via `athlete_observed_patterns`
- [x] 10 tools: `get_athlete_snapshot`, `get_recent_sessions`, `get_upcoming_sessions`, `get_week_progress`, `get_weekly_brief`, `get_activity_details`, `get_training_load`, `create_plan_change_proposal`, `suggest_alternative_workout`, `save_coach_note`
- [x] Plan change proposals with approve/dismiss UI

---

## 7. Session and execution tracking

- [x] Planned-session ↔ completed-session linkage
- [x] AI-generated execution reviews (completed vs. planned analysis) — `lib/execution-review.ts`
- [x] AI-generated session review narratives stored in `session_reviews`
- [x] Sessions marked as extra (outside plan)

---

## 8. Performance analytics

- [x] Training load model: TSS, CTL/ATL/TSB, readiness score, ramp rate
- [x] Fatigue detection (cross-discipline and discipline-specific)
- [x] Performance trends: run HR, run pace, bike power, swim pace, strength duration
- [x] FTP tracking: history, manual entry, used in TSS calculations
- [x] Adaptation engine: trigger evaluation and option generation

---

## 9. Recovery and check-ins

- [x] Weekly check-in (fatigue, sleep, soreness, stress, confidence)
- [x] Weekly debrief with AI-generated insights (`lib/weekly-debrief.ts`)
- [ ] Daily recovery check-in UI with 7-day trend card (API exists; no daily entry form or trend display yet)

---

## 10. Athlete settings

- [x] Experience level, limiters, constraints, and coaching preference
- [x] Strava integration management (connect/disconnect, sync status)

---

## 11. Operational and observability

- [x] Rate limiting on LLM routes
- [ ] Structured error telemetry (Sentry/Datadog not yet integrated)
- [ ] Training data export (CSV/PDF)
- [ ] Dark/light mode toggle (dark mode only)
- [ ] Push/email notifications for upcoming sessions

---

## 12. Next opportunities (prioritized)

1. **Daily recovery check-in UI + 7-day trend card** — backend already exists; completing the UI closes the recovery feedback loop for the coach and adaptation engine.
2. **Plan builder templates** — sprint tri, Olympic, and half-iron presets would lower onboarding friction for new users.
3. **Garmin Health API live sync** — removes the manual FIT/TCX upload step for Garmin users; Strava sync is already a reference implementation.
4. **Training data export (CSV/PDF)** — frequently requested; unblocks users who want records outside the app.
5. **Structured error telemetry** — Sentry or equivalent; needed before any meaningful production traffic.
6. **Dark/light mode toggle** — low effort, commonly expected.
7. **Push/email notifications for upcoming sessions** — increases engagement and adherence.
