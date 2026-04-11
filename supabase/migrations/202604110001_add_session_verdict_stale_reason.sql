-- Stale reason for session verdicts.
--
-- When upstream inputs change after a verdict was generated (most notably a
-- session feel captured after the fact), we mark the verdict stale so the UI
-- can surface a "refresh available" chip. Regeneration clears the flag.
--
-- Values:
--   'feel_updated'        — athlete captured/updated a session_feels row
--   'activity_rematched'  — the linked completed_activity_id changed
--   'plan_edited'         — the planned session target/duration was edited
--   'prompt_version_bump' — the SESSION_VERDICT_PROMPT_VERSION was bumped
--
-- NULL = fresh.

ALTER TABLE public.session_verdicts
  ADD COLUMN IF NOT EXISTS stale_reason TEXT
    CHECK (stale_reason IN ('feel_updated', 'activity_rematched', 'plan_edited', 'prompt_version_bump'));
