-- Adds resolved_intent (JSONB) and resolved_intent_source (text) to public.sessions.
--
-- Choice: sessions (the planned-workout table the coach prescribes against), not
-- completed_sessions / completed_activities / activity_uploads. Resolved intent
-- describes what the session is *meant* to accomplish — the physiological /
-- training purpose downstream verdict and review pipelines key on. session_verdicts
-- already FKs to sessions(id) and stores intended_zones / intended_metrics there;
-- resolved_intent is the upstream "what was this session for" record those
-- verdicts derive from. The four sources ('plan' = from prescribed plan,
-- 'athlete_described' = athlete clarified, 'inferred' = inferred from execution,
-- 'open' = open-ended / unspecified) all describe the planned row, including the
-- "extra" / unplanned-but-logged case where the planned session is created post-hoc.
-- Athlete-uploaded activity bytes (completed_sessions, activity_uploads) are not
-- the right host: those are post-hoc execution data, not intent.

ALTER TABLE public.sessions
  ADD COLUMN resolved_intent JSONB,
  ADD COLUMN resolved_intent_source TEXT
    CHECK (resolved_intent_source IN ('plan','athlete_described','inferred','open'));

CREATE INDEX idx_sessions_resolved_intent_source
  ON public.sessions(resolved_intent_source)
  WHERE resolved_intent IS NOT NULL;

-- RLS: public.sessions already has per-user SELECT / INSERT / UPDATE / DELETE
-- policies (auth.uid() = user_id) defined in the baseline schema. Those policies
-- gate the row, not specific columns, so the new columns are implicitly covered.
