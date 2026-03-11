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
