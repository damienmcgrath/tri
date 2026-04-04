-- Enhance session_feels with 5-point overall feel scale and secondary subjective inputs
-- Keeps existing rpe column for backward compatibility

ALTER TABLE public.session_feels
  ADD COLUMN IF NOT EXISTS overall_feel SMALLINT CHECK (overall_feel BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS energy_level TEXT CHECK (energy_level IN ('low', 'normal', 'high')),
  ADD COLUMN IF NOT EXISTS legs_feel TEXT CHECK (legs_feel IN ('heavy', 'normal', 'fresh')),
  ADD COLUMN IF NOT EXISTS motivation TEXT CHECK (motivation IN ('struggled', 'neutral', 'fired_up')),
  ADD COLUMN IF NOT EXISTS sleep_quality TEXT CHECK (sleep_quality IN ('poor', 'ok', 'great')),
  ADD COLUMN IF NOT EXISTS life_stress TEXT CHECK (life_stress IN ('high', 'normal', 'low')),
  ADD COLUMN IF NOT EXISTS prompt_shown_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_time_ms INT;

-- Relax rpe NOT NULL since new flow uses overall_feel instead
ALTER TABLE public.session_feels ALTER COLUMN rpe DROP NOT NULL;

-- Expand note limit from 200 to 280 characters
ALTER TABLE public.session_feels DROP CONSTRAINT IF EXISTS session_feels_note_check;
ALTER TABLE public.session_feels ADD CONSTRAINT session_feels_note_check CHECK (char_length(note) <= 280);
