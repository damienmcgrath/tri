# Coach Conversation Persistence (Responses API)

## Overview

The coaching backend persists conversation continuity in Supabase and uses OpenAI Responses API `previous_response_id` chaining for multi-turn context.

This is intentionally simple:

- Conversation identity is our UUID (`ai_conversations.id`), owned by one athlete/user.
- OpenAI continuity is tracked server-side with `ai_conversations.last_response_id`.
- Each turn stores auditing metadata in `ai_messages`.

## Stored identifiers

### `ai_conversations`

- `id`: stable conversation UUID exposed to client.
- `last_response_id`: latest OpenAI response id returned for the conversation.

### `ai_messages`

Per message row (user + assistant rows per turn):

- `response_id`: OpenAI response id for assistant turns (nullable on user turns).
- `previous_response_id`: chain pointer used when creating the next model response.
- `model`: model name used for that turn.

## New conversation flow

1. Client sends `POST /api/coach/chat` with `{ message }` (optionally `conversationId: null`).
2. Backend creates `ai_conversations` row.
3. Backend calls Responses API **without** `previous_response_id`.
4. Backend stores turn rows in `ai_messages` and writes assistant `response_id` to `ai_conversations.last_response_id`.
5. Backend returns `conversationId` and `responseId` to client.

## Continued conversation flow

1. Client sends `POST /api/coach/chat` with `{ message, conversationId }`.
2. Backend verifies ownership (`user_id` + `athlete_id`) for the conversation.
3. Backend reads `ai_conversations.last_response_id` and passes it as `previous_response_id`.
4. Backend stores the new turn metadata and updates `last_response_id`.

## Why instructions are re-sent each turn

The backend always sends `COACH_SYSTEM_INSTRUCTIONS` on each Responses API call (including tool-loop follow-ups).

Reason: continuity IDs chain model state, but production safety/behavior policy should be explicit and deterministic per call. Re-sending instructions ensures coach behavior does not drift and remains auditable.

## Client contract

- Start new thread: omit `conversationId` (or send `null`).
- Continue thread: send existing `conversationId`.
- Persist `conversationId` returned from API for future turns.
- `responseId` is returned as a server-generated continuity/debug identifier; the client does not need to send OpenAI ids back.


## Streaming contract (`POST /api/coach/chat`)

`POST /api/coach/chat` now responds with `text/event-stream` (SSE) for successful authenticated requests.

Event sequence:

1. `message_start`
   - payload: `{ conversationId }`
   - emitted immediately once server resolves/creates conversation ownership context.
2. `message_delta`
   - payload: `{ chunk }`
   - emitted progressively as assistant text tokens/chunks are received from the Responses API streaming call.
3. `message_complete`
   - payload: `{ conversationId, responseId, structured }`
   - emitted after server-side tool loop + formatting + persistence completes.
   - `structured` is the stable JSON object (headline/answer/insights/actions/warnings) used for deterministic UI state and auditing.
4. `error` (terminal)
   - payload: `{ error }`
   - emitted only if the streaming pipeline fails after SSE has started.

### Important security behavior in streaming mode

- OpenAI calls remain server-side only.
- Tool calls remain server-side only; clients never execute tools.
- Tool handlers still run with auth-scoped `ctx` (`userId` + `athleteId`) from `resolveCoachAuthContext`.
- Conversation ownership checks are unchanged before any model/tool work.
- Proposal-only write safeguards remain unchanged because tool handlers are unchanged.
- `ai_messages` persistence and `ai_conversations.last_response_id` updates still happen before `message_complete` is emitted.

### Client implementation notes

- Render an assistant placeholder as soon as request starts.
- Append `message_delta.chunk` to that message.
- On `message_complete`, replace/finalize visible assistant text using `structured.answer` and persist `conversationId` for the thread.
- On `error`, keep already-streamed partial text visible and surface the error state.
