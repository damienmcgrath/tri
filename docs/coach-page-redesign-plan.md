# Coach Page Redesign Plan

## Summary
Redesign the `/coach` page as a structural UX improvement, not a surface polish pass. The goal is to make the page feel clearly organized around one primary task, talking to the coach, while keeping the existing capabilities: briefing context, conversation history, weekly check-in, and coaching profile.

The redesign should preserve current data flows and APIs, but change hierarchy, layout, copy emphasis, and interaction framing so the page is easier to scan, easier to start using, and more obviously useful on first load.

## Key Changes
### 1. Reframe the page around a primary chat workspace
- Make the central chat workspace the dominant visual area on desktop.
- Keep the existing conversation history, but collapse or narrow the left conversation rail when there is only one conversation.
- Move `New conversation` and the active conversation header into a tighter top bar for the chat pane so the main message area starts higher.
- Promote the message composer into a larger, more obvious input block with stronger contrast, more padding, and clearer focus state.
- Keep the quick-prompt chips, but visually subordinate them to the composer and group them as `Suggested asks` rather than making them compete with the input itself.
- Preserve current conversation behaviors: load, rename, delete, send, and stream responses.

### 2. Turn the briefing into a compact decision panel
- Replace the current broad top `Coach Briefing` treatment with a tighter summary band above the chat.
- The band should contain:
  - one headline
  - one short supporting sentence
  - one primary recommended action
  - one secondary contextual action
  - one compact status row for uploaded / linked / reviewed / pending counts
- Remove duplicated explanatory text where the briefing and chat intro currently repeat similar ideas.
- Keep athlete-context edit access visible, but demote it to a small secondary control rather than a competing top-level CTA.
- Preserve the current briefing logic and data sources; only presentation and prioritization change.

### 3. Move context modules into a persistent support column
- On desktop, place `WeeklyCheckinCard` and the coaching profile/context card in a right-side support column aligned with the chat workspace.
- Keep the right column sticky within reasonable bounds so recovery/context signals remain visible while chatting.
- On mobile/tablet, stack the support modules below the chat in this order:
  - briefing summary
  - chat
  - weekly check-in
  - coaching profile
- Preserve the current weekly check-in modal flow and athlete-context state, but make the collapsed check-in card more legible and more actionable from its summary state.

### 4. Strengthen visual hierarchy and reduce flatness
- Increase contrast between:
  - page background
  - primary chat surface
  - support surfaces
  - chips / metadata / labels
- Reduce overuse of tiny uppercase labels; keep them only where they genuinely help section separation.
- Increase the visual weight of section titles and active state indicators.
- Give the main chat area and briefing band distinct surface treatments so they no longer blend into a single dark slab.
- Tighten dead space in the conversation rail and above the chat thread so more useful content sits above the fold.
- Keep the current visual system family intact; this is an evolution of the existing product language, not a totally new art direction.

### 5. Simplify first-use and low-data states
- For sparse data cases, make the empty/early state answer three questions immediately:
  - what Coach can already do
  - what signal is still building
  - what the user should ask next
- Convert passive explanatory paragraphs into explicit guided actions.
- Show one recommended first prompt when there is little review data, instead of relying on several equally weighted chips.
- Ensure the page remains useful when there are:
  - zero conversations
  - one conversation
  - reviewed sessions available
  - only uploaded/linked sessions available
  - incomplete athlete context

## Implementation Notes
- Concentrate the redesign inside the existing coach surface:
  - `app/(protected)/coach/page.tsx`
  - `app/(protected)/coach/coach-chat.tsx`
  - `app/(protected)/coach/weekly-checkin-card.tsx`
- Keep current server-side data loading and chat API contracts unchanged unless a presentation issue cannot be solved without a small derived-view-model refactor.
- Prefer extracting small presentation subcomponents from `coach-chat.tsx` if needed, especially for:
  - briefing summary band
  - conversation rail
  - chat header
  - composer / suggested prompts block
- No backend/schema changes are planned.
- No changes to conversation persistence semantics are planned.
- No changes to weekly check-in API shape are planned.
- The preview-mode workflow should continue to render the redesigned page cleanly.

## Test Plan
- Desktop visual verification:
  - chat is visibly primary above the fold
  - briefing is compact and actionable
  - support column stays readable and does not overpower chat
- Mobile visual verification:
  - modules stack in the intended order
  - composer stays prominent
  - suggestion chips wrap cleanly
  - support cards do not create excessive scroll before the input
- Behavioral checks:
  - create conversation
  - switch conversation
  - rename conversation
  - delete conversation
  - send a message
  - view low-data state
  - open and save weekly check-in
- Sparse/edge-state checks:
  - no conversations
  - single conversation
  - multiple conversations
  - pending review count > 0
  - no reviewed sessions
  - incomplete athlete context
- Regression checks:
  - no changes to existing `/api/coach/chat` request/response behavior
  - no breakage to weekly check-in save flow
  - preview mode still reaches `/coach` successfully

## Assumptions
- Chosen direction: structural redesign, not just visual polish.
- Existing coach functionality remains in scope; the work is UX/layout/interaction framing, not feature removal.
- The conversation rail remains part of the product, but may collapse or shrink when it adds little value.
- The right answer is `chat-first within the same page`, not splitting the feature into separate routes.
- The implementation should stay within the current design language, with stronger hierarchy and clarity rather than a wholly new brand treatment.
