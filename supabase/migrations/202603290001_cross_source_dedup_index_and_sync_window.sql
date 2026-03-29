-- Cross-source deduplication index: efficiently find activities by user, sport, and start time
CREATE INDEX IF NOT EXISTS idx_completed_activities_cross_source
  ON completed_activities (user_id, sport_type, start_time_utc);

-- Configurable sync window per connection (default 7 days, 1–90 range)
ALTER TABLE external_account_connections
  ADD COLUMN IF NOT EXISTS sync_window_days integer DEFAULT 7
  CHECK (sync_window_days BETWEEN 1 AND 90);

-- Sync result metadata (imported/skipped/error counts)
ALTER TABLE external_account_connections
  ADD COLUMN IF NOT EXISTS last_sync_metadata jsonb DEFAULT NULL;
