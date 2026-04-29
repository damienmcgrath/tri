-- Phase 1B: Race review AI Layers 1 (Verdict) + 2 (Race Story).
--
-- Extends race_reviews with structured JSON columns for the new two-layer
-- output, deterministic per-leg status labels, the gated emotional frame,
-- the cross-discipline insight (the moat), pre-computed pacing-arc series
-- for the unified visualization, and tone-violation telemetry from the
-- post-generation guard.
--
-- All new columns are nullable / safely defaulted so existing rows generated
-- by the Phase 1A pipeline remain valid; the generator populates legacy
-- columns alongside the new shape until the legacy fields are dropped in a
-- later phase.

ALTER TABLE public.race_reviews
  ADD COLUMN IF NOT EXISTS verdict jsonb,
  ADD COLUMN IF NOT EXISTS race_story jsonb,
  ADD COLUMN IF NOT EXISTS leg_status jsonb,
  ADD COLUMN IF NOT EXISTS emotional_frame text,
  ADD COLUMN IF NOT EXISTS cross_discipline_insight text,
  ADD COLUMN IF NOT EXISTS pacing_arc_data jsonb,
  ADD COLUMN IF NOT EXISTS tone_violations jsonb NOT NULL DEFAULT '[]'::jsonb;
