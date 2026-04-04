-- Discipline balance snapshots: rolling actual vs target distribution.
CREATE TABLE IF NOT EXISTS public.discipline_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  window_days integer NOT NULL DEFAULT 21,

  -- Distribution data (as fractions of total)
  actual_distribution jsonb NOT NULL,
  -- { swim: 0.18, bike: 0.45, run: 0.30, strength: 0.07 }
  target_distribution jsonb NOT NULL,
  -- { swim: 0.15, bike: 0.42, run: 0.33 }

  target_race_id uuid REFERENCES public.race_profiles(id) ON DELETE SET NULL,

  -- Per-sport deltas in percentage points
  deltas jsonb NOT NULL,
  -- { swim: 3, bike: 3, run: -3 }

  -- Absolute hours for context
  total_hours float,
  hours_by_sport jsonb,
  -- { swim: 3.5, bike: 8.2, run: 5.1 }

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(user_id, snapshot_date, window_days)
);

CREATE INDEX IF NOT EXISTS idx_discipline_balance_user
  ON public.discipline_balance_snapshots(user_id, snapshot_date DESC);

ALTER TABLE public.discipline_balance_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY dbs_select ON public.discipline_balance_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY dbs_insert ON public.discipline_balance_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY dbs_delete ON public.discipline_balance_snapshots FOR DELETE USING (auth.uid() = user_id);

-- Rebalancing recommendations.
CREATE TABLE IF NOT EXISTS public.rebalancing_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES public.discipline_balance_snapshots(id) ON DELETE CASCADE,

  recommendation_type text NOT NULL CHECK (recommendation_type IN ('add', 'swap', 'reduce', 'maintain')),
  sport text NOT NULL,
  summary text NOT NULL,
  rationale text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'applied', 'dismissed')),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rebalancing_user
  ON public.rebalancing_recommendations(user_id, created_at DESC);

ALTER TABLE public.rebalancing_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY rr_select ON public.rebalancing_recommendations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY rr_insert ON public.rebalancing_recommendations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY rr_update ON public.rebalancing_recommendations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY rr_delete ON public.rebalancing_recommendations FOR DELETE USING (auth.uid() = user_id);
