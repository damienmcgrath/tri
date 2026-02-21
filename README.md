# TriCoach AI 2.0 — Product Requirements Document

## Local development quickstart

### 1) Install dependencies

```bash
npm ci
```

### 2) Configure environment variables

Create `.env.local` in the repo root and copy values from `.env.example`.

Required to run app auth + data flows:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` (preferred)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy fallback)

Optional for upcoming features:

- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `WEATHER_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### 3) Run Supabase migrations

Use either the Supabase dashboard SQL editor or the CLI against your project.

If using CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

This provisions `training_plans`, `planned_sessions`, `completed_sessions`, and `ingestion_events` with RLS policies used by the app.

### 4) Enable Supabase email/password auth

In your Supabase project:

- Go to **Authentication → Providers → Email**
- Enable email/password sign-in
- (Optional) disable email confirmation during local development for faster onboarding

### 5) Run checks

```bash
npm run lint
npm run typecheck
npm run build
```

### 6) Start local app

```bash
npm run dev
```

Open `http://localhost:3000`.

### Notes

- Protected routes (`/dashboard`, `/plan`, `/calendar`, `/coach`) require an authenticated user.
- Garmin manual TCX upload now lives under **Settings → Integrations** as a temporary bridge until direct Garmin API sync.

## 📌 Overview
TriCoach AI is a web-based training companion for amateur triathletes. It automates personalized training-plan management by integrating with Garmin Connect, analyzing workout data, and offering an AI coach for plan adaptation and guidance.

The product is designed first for solo athletes who want expert-level coaching support without the ongoing cost of a human coach, with a path to broader user adoption over time.

---

## 🎯 Goals
- Provide athletes with a smart, interactive training-plan experience.
- Automatically track and compare completed Garmin workouts against a planned schedule.
- Allow users to chat with an AI coach for plan adjustments, questions, and advice.
- Visualize performance trends and recovery metrics.
- Enable faster, data-informed training decisions.

---

## 🧑‍🎯 Target Users
- Amateur triathletes training for Sprint, Olympic, 70.3, or Ironman races.
- Self-coached athletes or athletes looking to reduce coaching costs.
- Initial launch: single-user focused (founder usage), then expand to broader users.
- Future expansion: single-sport athletes (runners, cyclists, swimmers).

---

## 🧩 MVP Scope (Core Features)

### 1) Training Plan Management
- Manually upload or create a multi-week triathlon training plan.
- View the plan by week and sport.
- Edit planned sessions (type, duration, intensity, notes).
- Include a workout template library with common sessions by sport.

### 2) Garmin Connect Integration
- Sync completed workouts via Garmin Health API.
- Match completed sessions to planned sessions by date and sport.
- Show completion status per session (completed, missed, over/under target).
- Add automated data validation for inconsistent Garmin data (HR spikes, GPS drops).

### 3) AI Coach Chat
- Chat interface powered by OpenAI GPT-4o.
- Support:
  - Rescheduling and moving sessions.
  - Adjusting plans based on missed sessions, fatigue, or schedule changes.
  - Answering common triathlon coaching questions.
- Add prompt-layer guardrails for consistent coaching style.
- Add response caching for common questions to reduce API cost.

### 4) PB + FTP Tracker
- Store and visualize key performance markers:
  - 5K and 10K run PBs.
  - 20-minute power and FTP tests.
  - Swim time-trial benchmarks.
- Highlight newly achieved PBs.
- Add automated PB detection from Garmin data.

### 5) Performance Trends
- Chart weekly training volume by sport.
- Compare planned vs completed training load.
- Visualize FTP changes over time.
- Include recovery metrics overlays.

### 6) Recovery Tracking
- Daily check-in for:
  - Sleep quality and duration.
  - Perceived fatigue (1–5).
  - Muscle soreness areas.
- Show trends and workout correlation.
- Generate AI recommendations based on recovery status.

### 7) Weather Integration
- Integrate weather API for athlete training locations.
- Suggest indoor alternatives when outdoor conditions are poor.
- Trigger proactive weather-based schedule adjustment notifications.

---

## 📦 Out of Scope (MVP)
- Multi-user/team support (future roadmap).
- Dedicated mobile app (responsive web only for MVP).
- Advanced analytics modeling (CTL/ATL/TSB).
- Race-specific taper plan generator.
- Nutrition and weight tracking.
- Social sharing features.

---

## 🔌 Integrations
- **Garmin Health API**: pull completed workouts.
- **OpenAI GPT-4o**: chat-based coaching and adaptation support.
- **Supabase**: authentication, PostgreSQL, storage, serverless functions.
- **Weather API**: local conditions and workout adjustment inputs.

---

## 🧱 Proposed Tech Stack
- **Frontend**: Next.js 14, Tailwind CSS, shadcn/ui.
- **Backend/Data**: Supabase (PostgreSQL, Auth, Edge Functions).
- **AI**: OpenAI GPT-4o API.
- **Deployment**: Vercel.
- **Caching**: Redis (AI response caching and high-frequency reads).

---

## ✅ Recommended Stack for Fast + Cheap Launch (based on React/TypeScript experience)
- **App framework**: Next.js (App Router) on Vercel.
- **UI**: Tailwind CSS + shadcn/ui.
- **Database/Auth/Storage**: Supabase (Postgres + Auth + Storage).
- **Background jobs**: Trigger.dev or Supabase scheduled Edge Functions.
- **AI**: OpenAI API (`gpt-4o-mini` for most chats, `gpt-4o` only for harder coaching reasoning).
- **Caching/rate limiting**: Upstash Redis (start with generous free tier).
- **Observability**: Sentry + PostHog (free tiers).

### Why this is the best fit for speed + low cost
1. **Minimal infrastructure overhead**: no custom server ops needed early.
2. **TypeScript end-to-end**: fastest dev loop with your existing React skills.
3. **Cheap to start**: all major services have free/low-cost entry tiers.
4. **Easy to scale incrementally**: you can add queues/workers only when usage grows.

### Suggested cost controls from day one
- Default AI requests to `gpt-4o-mini`; escalate to `gpt-4o` only when needed.
- Cache repeated AI questions and Garmin-derived summaries.
- Use on-demand data refresh over frequent polling where possible.
- Keep Garmin raw files in low-cost object storage; normalize only required fields.

---

## 🛠️ Week 1 Build Checklist (start coding immediately)

### Day 1 — Project Scaffold
- [ ] Create Next.js 14 app with TypeScript and App Router.
- [ ] Install Tailwind CSS + shadcn/ui base components.
- [ ] Configure ESLint/Prettier + strict TypeScript settings.
- [ ] Set up environment variable handling for local/dev/prod.

### Day 2 — Supabase Foundation
- [ ] Create Supabase project and connect app.
- [ ] Enable auth (email + OAuth provider if needed).
- [ ] Create initial tables:
  - `users`
  - `training_plans`
  - `planned_sessions`
  - `completed_sessions`
  - `recovery_logs`
- [ ] Add Row Level Security (RLS) policies for user-owned data.

### Day 3 — Core App Shell
- [ ] Build app shell (sidebar/top nav) with protected routes.
- [ ] Create pages: Dashboard, Plan, Calendar, AI Coach.
- [ ] Add onboarding form for athlete profile and race goal.

### Day 4 — Plan Management MVP
- [ ] Implement training plan CRUD (create/edit/delete/list).
- [ ] Add planned session editor (sport, date, duration, intensity, notes).
- [ ] Create weekly plan view grouped by sport.

### Day 5 — Garmin Integration Stub
- [ ] Implement Garmin connect/disconnect flow placeholder.
- [ ] Build ingestion endpoint/interface for incoming workout payloads.
- [ ] Store normalized sample workout records into `completed_sessions`.
- [ ] Add basic deduplication key strategy (`user_id + garmin_id`).

### Day 6 — Dashboard v1
- [ ] Show planned vs completed sessions for current week.
- [ ] Add weekly training volume summary by sport.
- [ ] Add simple completion-status indicators (completed/missed/partial).

### Day 7 — AI Coach v1 + Hardening
- [ ] Build chat UI and server action/API route.
- [ ] Add coaching system prompt + guardrails.
- [ ] Default model to `gpt-4o-mini`.
- [ ] Add Redis caching for repeated prompts/questions.
- [ ] Add error tracking (Sentry) and product analytics (PostHog).

### Week 1 Definition of Done
- [ ] User can sign in, create a plan, and view weekly sessions.
- [ ] System can store completed sessions through ingestion endpoint (even before full Garmin production integration).
- [ ] Dashboard compares planned vs completed for the week.
- [ ] User can chat with AI coach and receive plan-adjustment guidance.

---

## 🗂️ Data Model (High-Level)

### User
- `id`, `email`, `garmin_token`, `preferences`, `locations`

### TrainingPlan
- `id`, `user_id`, `name`, `start_date`, `duration_weeks`

### PlannedSession
- `id`, `plan_id`, `date`, `sport`, `type`, `duration`, `notes`, `template_id`

### CompletedSession
- `id`, `user_id`, `garmin_id`, `date`, `sport`, `metrics` (pace/hr/power)

### PersonalBest
- `id`, `user_id`, `metric`, `value`, `date`

### FTPTest
- `id`, `user_id`, `power`, `date`

### WorkoutTemplate
- `id`, `name`, `sport`, `description`, `target_metrics`

### RecoveryLog
- `id`, `user_id`, `date`, `sleep_hours`, `fatigue_level`, `soreness_areas`

### AIConversation
- `id`, `user_id`, `messages`, `summary`, `plan_changes`

---

## 🚀 Implementation Plan

### Phase 1 (Weeks 1–2)
- Basic auth setup.
- Training plan creation/import.
- Garmin connection + initial sync.
- Simple plan-vs-actual visualization.

### Phase 2 (Weeks 3–4)
- Enhanced Garmin integration and matching quality.
- Basic AI coach for plan adjustments.
- Workout template library.
- PB and FTP tracking.

### Phase 3 (Weeks 5–6)
- Recovery tracking.
- Weather integration.
- Performance trends visualization.
- AI coaching enhancements.

### Polish (Week 7)
- UI refinement.
- Testing and bug fixes.
- Performance optimization.

---

## 📈 Success Metrics

### Personal Use Metrics
- Training adherence rate (% planned sessions completed).
- % sessions adjusted via AI coach.
- Number of detected PBs per month.
- Training-to-recovery ratio quality.

### Growth Metrics
- % of users syncing Garmin data weekly.
- Average AI chat sessions per user per week.
- 4-week retention.
- Average weekly time spent in app.

---

## 🚀 Roadmap (Post-MVP)

### Near-Term
- Multi-user support with tiered pricing.
- Mobile companion app.
- Enhanced analytics (CTL/ATL/TSB).
- Nutrition tracking integration.

### Mid-Term
- Coach collaboration workspace.
- Race-specific taper planning.
- Community features (shared workouts, challenges).
- Additional integrations (Wahoo, Polar, etc.).

### Long-Term
- AI video analysis for technique improvement.
- Race prediction modeling.
- White-label solution for professional coaches.
- Expanded sports beyond triathlon.

---

## 💰 Monetization (Draft)
- **Free tier**: basic plan tracking + limited Garmin sync.
- **Premium ($10–15/month)**: full AI coaching, unlimited history, advanced analytics.
- **Coach tier ($30–50/month)**: multi-athlete tooling for professional coaches.

---

## 🔑 Critical Success Factors
- Garmin API reliability and data quality.
- AI coach usefulness, trust, and recommendation quality.
- Simple, intuitive UX for non-technical athletes.
- Strong performance and reliable sync behavior.
- Clear differentiation versus established training platforms.

## TCX Import MVP (Temporary Garmin Bridge)
- Upload Garmin `.tcx` exports from the Dashboard.
- The app parses activities and stores normalized records in `completed_sessions`.
- Imports are idempotent via `user_id + garmin_id` and logged in `ingestion_events`.
- This path is intentionally adapter-based so Garmin Health API payloads can later map into the same normalized model.
