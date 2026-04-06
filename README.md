# TriCoach AI

A web app for amateur triathletes that combines training plan management, Garmin activity tracking, and an AI coaching assistant.

## Overview

TriCoach AI helps self-coached triathletes manage their training with tools that would normally require a human coach:

- **Training plan management** — Create and edit multi-week plans organized by sport (swim, bike, run, strength). View plans by week or on a calendar.
- **Activity uploads** — Import Garmin `.fit` and `.tcx` files. Activities are automatically matched to planned sessions using a scoring algorithm based on time proximity, sport, duration, and distance.
- **AI coach** — Chat with an AI assistant that has full context of your plan and recent activities. It can reschedule sessions, adjust plans for missed workouts or fatigue, and answer training questions.
- **Session reviews** — AI-generated analysis comparing how you executed a workout versus what was planned.
- **Weekly debriefs** — Automated weekly summaries of training load, adherence, and recommendations.

## Technical Overview

### Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript |
| Database & Auth | Supabase (Postgres + Row Level Security + Email auth) |
| AI | OpenAI API — `gpt-5-mini` (default), `gpt-5.4` (deep reasoning) |
| Styling | Tailwind CSS, Geist fonts, dark mode |
| File Parsing | `fit-file-parser` (FIT), `fast-xml-parser` (TCX) |
| Caching | Upstash Redis (rate limiting + caching) |
| Testing | Jest + React Testing Library |
| Deployment | Vercel |

### Architecture

```
Browser → Middleware (auth gate) → Protected Routes
       → Server Actions / API Routes
       → lib/* (domain logic)
       → Supabase (Postgres + Auth + RLS) / OpenAI API
```

**Key directories:**

- `/app/(protected)/` — Auth-gated pages: dashboard, plan, calendar, coach, sessions, activities, settings
- `/app/api/` — API routes for AI chat (streaming), file uploads, session reviews, weekly debriefs
- `/app/auth/` — Sign-in/sign-up/password flows
- `/lib/` — All business logic (never imports from `/app/`)
  - `lib/workouts/` — FIT/TCX parsing and activity-to-session matching
  - `lib/coach/` — AI coach system prompt, tool definitions, and tool execution
  - `lib/athlete-context.ts` — Builds context injected into every AI request
  - `lib/security/` — Rate limiting and request validation (Zod)
- `/supabase/migrations/` — SQL migrations (apply with `supabase db push`)

### Database

Supabase Postgres with RLS on all user-owned tables. Core tables:

- `training_plans` → `training_weeks` → `sessions` (planned workouts)
- `completed_sessions` — Parsed activity files (SHA256 dedup per user)
- `activity_uploads` — Upload metadata
- `profiles` — User profile and active plan reference
- `ai_conversations` → `ai_messages` — Coach chat history
- `session_reviews`, `weekly_debriefs` — AI-generated content

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- A [Supabase](https://supabase.com) project
- An [OpenAI](https://platform.openai.com) API key

### 1. Install dependencies

```bash
npm ci
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

**Required:**

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (migrations only) |
| `OPENAI_API_KEY` | OpenAI API key |

**Optional:**

| Variable | Description |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL (rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `WEATHER_API_KEY` | Weather API key |
| `STRAVA_CLIENT_ID` | Strava integration |
| `STRAVA_CLIENT_SECRET` | Strava integration |

### 3. Set up the database

Link your Supabase project and apply migrations:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Then enable email/password auth in your Supabase dashboard under **Authentication → Providers → Email**.

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Available Scripts

```bash
npm run dev            # Start dev server (localhost:3000)
npm run build          # Production build
npm run lint           # ESLint
npm run typecheck      # TypeScript strict check
npm run test           # Run all tests
npm run test:watch     # Jest watch mode
npm run test:coverage  # Jest with coverage report
```

Run a single test file:

```bash
npx jest path/to/file.test.ts
```

### Agent Preview Mode

For local UI testing without a Supabase account, set `AGENT_PREVIEW=true` in `.env.local`, start the dev server, and visit [http://localhost:3000/dev/agent-preview](http://localhost:3000/dev/agent-preview) to seed test data and access protected routes without authentication.
