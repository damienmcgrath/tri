-- Add locale, units, timezone, and week-start-day preferences to profiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS units text NOT NULL DEFAULT 'metric',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS week_start_day integer NOT NULL DEFAULT 1;

-- Constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_units_check'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_units_check
      CHECK (units IN ('metric', 'imperial'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_week_start_day_check'
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_week_start_day_check
      CHECK (week_start_day BETWEEN 0 AND 6);
  END IF;
END $$;
