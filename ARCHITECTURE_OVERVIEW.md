# TriCoach AI — Architecture Overview

This document gives a practical, high-level view of the current system architecture and data flow.

## System diagram

```mermaid
flowchart TB
  U["User Browser"]

  subgraph NextApp["Next.js 14 App Router"]
    MW["Middleware\nAuth gate + security headers"]
    UI["Protected UI Routes\n/dashboard /plan /calendar /coach /settings /activities"]
    SA["Server Actions\nplan/calendar/dashboard/activity ops"]
    API1["/api/coach/chat"]
    API2["/api/uploads/activities"]
    API3["/api/uploads/activities/:id"]
    API4["/api/uploads/activities/:id/attach"]
    API5["/api/health"]
  end

  subgraph DomainLib["Domain + Service Libraries"]
    Coach["lib/coach/*\nPrompting, tools, audit, auth context"]
    Workouts["lib/workouts/*\nFIT/TCX parsing + matching"]
    Sec["lib/security/*\norigin + in-memory rate limit"]
    Train["lib/training/*\nsession naming, week metrics"]
    SB["lib/supabase/*\nrequest-scoped clients"]
    OA["lib/openai.ts\nmodel/client selection"]
  end

  subgraph Data["Supabase"]
    Auth["Supabase Auth"]
    DB[("Postgres + RLS")]
  end

  subgraph AI["OpenAI Responses API"]
    LLM["gpt-5-mini / gpt-5.4"]
  end

  U --> MW --> UI
  UI --> SA --> SB --> DB
  UI --> API1
  UI --> API2
  UI --> API3
  UI --> API4

  API1 --> Coach --> OA --> LLM
  API1 --> SB --> DB

  API2 --> Workouts
  API2 --> Sec
  API2 --> SB --> DB

  API3 --> SB --> DB
  API4 --> SB --> DB

  MW --> Auth
  SB --> Auth
```

## Layered view

- **UI layer (Next.js App Router):** Protected pages render dashboard, plan, calendar, coach, settings, and activity views.
- **API / action layer:** Server Actions and route handlers coordinate writes, ingestion, chat, and linking workflows.
- **Domain layer:**
  - `lib/coach`: coach instructions, tool schemas, tool handlers, audit logging.
  - `lib/workouts`: FIT/TCX parsing and session matching logic.
  - `lib/training`: semantics and week metrics.
  - `lib/security`: origin checks and in-memory rate limiting.
- **Data layer:** Supabase Auth + Postgres with RLS policies enforced via migrations.
- **AI layer:** OpenAI Responses API called server-side only through `lib/openai.ts`.

## Core request flows

1. **Authenticated app navigation**
   - Browser request hits middleware for protected-route auth checks and security headers.
   - Authenticated requests proceed to protected UI route handlers and server components.

2. **Activity upload + matching**
   - UI calls upload API.
   - API validates origin, rate limit, file type/size, and duplicate hash.
   - Parser extracts activity data and stores upload/activity rows.
   - Matching logic suggests and/or creates session linkage candidates.

3. **Coach chat + tools**
   - UI posts user message to `/api/coach/chat`.
   - Backend resolves auth context and loads conversation continuity.
   - OpenAI response may trigger approved tool calls.
   - Tool handlers run athlete-scoped queries/writes only.
   - Assistant response and metadata are persisted.

## Notes

- This file is intentionally Git-friendly Markdown and can be committed directly.
- A copy also exists at `docs/architecture-overview.md` for docs-folder discoverability.
