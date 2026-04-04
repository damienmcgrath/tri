-- Seasons: a named training period containing multiple races.
CREATE TABLE IF NOT EXISTS public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,

  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  primary_goal text,
  secondary_goals text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seasons_user ON public.seasons(user_id, start_date);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY seasons_select ON public.seasons FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY seasons_insert ON public.seasons FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY seasons_update ON public.seasons FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY seasons_delete ON public.seasons FOR DELETE USING (auth.uid() = user_id);

-- Junction: link races to a season.
CREATE TABLE IF NOT EXISTS public.season_races (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  race_profile_id uuid NOT NULL REFERENCES public.race_profiles(id) ON DELETE CASCADE,
  UNIQUE(season_id, race_profile_id)
);

ALTER TABLE public.season_races ENABLE ROW LEVEL SECURITY;

CREATE POLICY season_races_select ON public.season_races
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = season_id AND s.user_id = auth.uid()));
CREATE POLICY season_races_insert ON public.season_races
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = season_id AND s.user_id = auth.uid()));
CREATE POLICY season_races_delete ON public.season_races
  FOR DELETE USING (EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = season_id AND s.user_id = auth.uid()));

-- Training blocks: formal periodization structure.
CREATE TABLE IF NOT EXISTS public.training_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid REFERENCES public.seasons(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.training_plans(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name text NOT NULL,
  block_type text NOT NULL CHECK (block_type IN ('Base', 'Build', 'Peak', 'Taper', 'Race', 'Recovery', 'Transition')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  target_race_id uuid REFERENCES public.race_profiles(id) ON DELETE SET NULL,

  -- Training parameters for this block
  emphasis jsonb DEFAULT '{}'::jsonb,
  -- { swim: "develop", bike: "maintain", run: "peak", primary_focus: "threshold development" }

  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_blocks_user ON public.training_blocks(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_training_blocks_season ON public.training_blocks(season_id, sort_order);

ALTER TABLE public.training_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_blocks_select ON public.training_blocks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY training_blocks_insert ON public.training_blocks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY training_blocks_update ON public.training_blocks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY training_blocks_delete ON public.training_blocks FOR DELETE USING (auth.uid() = user_id);
