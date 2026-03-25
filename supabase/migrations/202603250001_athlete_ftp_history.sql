CREATE TABLE athlete_ftp_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  value       integer NOT NULL CHECK (value > 0 AND value < 2000),
  source      text NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual', 'ramp_test', 'estimated')),
  notes       text,
  recorded_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX athlete_ftp_history_athlete_id_recorded_at
  ON athlete_ftp_history (athlete_id, recorded_at DESC);

ALTER TABLE athlete_ftp_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Athletes can read their own FTP history"
  ON athlete_ftp_history FOR SELECT
  USING (athlete_id = auth.uid());

CREATE POLICY "Athletes can insert their own FTP history"
  ON athlete_ftp_history FOR INSERT
  WITH CHECK (athlete_id = auth.uid());
