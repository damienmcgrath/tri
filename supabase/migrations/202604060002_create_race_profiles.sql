-- Race profiles: individual race targets with priority and discipline distribution.
CREATE TABLE IF NOT EXISTS public.race_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,

  name text NOT NULL,
  date date NOT NULL,
  distance_type text NOT NULL CHECK (distance_type IN ('sprint', 'olympic', '70.3', 'ironman', 'custom')),
  priority text NOT NULL DEFAULT 'A' CHECK (priority IN ('A', 'B', 'C')),

  -- Course characteristics (optional)
  course_profile jsonb DEFAULT '{}'::jsonb,
  -- { swim_distance_m, bike_distance_km, run_distance_km, bike_elevation_m, course_type, expected_conditions }

  -- Ideal training distribution for this athlete + race (computed or manual)
  ideal_discipline_distribution jsonb DEFAULT NULL,
  -- { swim: 0.15, bike: 0.42, run: 0.33, strength: 0.10 }

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(user_id, name, date)
);

CREATE INDEX IF NOT EXISTS idx_race_profiles_user ON public.race_profiles(user_id, date);

-- RLS
ALTER TABLE public.race_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY race_profiles_select ON public.race_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY race_profiles_insert ON public.race_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY race_profiles_update ON public.race_profiles
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY race_profiles_delete ON public.race_profiles
  FOR DELETE USING (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_race_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER race_profiles_updated_at
  BEFORE UPDATE ON public.race_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_race_profiles_updated_at();
