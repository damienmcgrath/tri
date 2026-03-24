alter table public.completed_activities
  add column if not exists moving_duration_sec integer,
  add column if not exists elapsed_duration_sec integer,
  add column if not exists pool_length_m numeric(6,2),
  add column if not exists laps_count integer,
  add column if not exists avg_pace_per_100m_sec integer,
  add column if not exists best_pace_per_100m_sec integer,
  add column if not exists avg_stroke_rate_spm integer,
  add column if not exists avg_swolf integer,
  add column if not exists avg_cadence integer,
  add column if not exists max_hr integer,
  add column if not exists max_power integer,
  add column if not exists elevation_gain_m integer,
  add column if not exists elevation_loss_m integer,
  add column if not exists activity_type_raw text,
  add column if not exists activity_subtype_raw text,
  add column if not exists activity_vendor text,
  add column if not exists metrics_v2 jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'completed_activities_moving_duration_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_moving_duration_nonnegative check (moving_duration_sec is null or moving_duration_sec >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_elapsed_duration_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_elapsed_duration_nonnegative check (elapsed_duration_sec is null or elapsed_duration_sec >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_pool_length_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_pool_length_nonnegative check (pool_length_m is null or pool_length_m >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_laps_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_laps_nonnegative check (laps_count is null or laps_count >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_avg_pace_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_avg_pace_nonnegative check (avg_pace_per_100m_sec is null or avg_pace_per_100m_sec >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_best_pace_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_best_pace_nonnegative check (best_pace_per_100m_sec is null or best_pace_per_100m_sec >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_avg_stroke_rate_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_avg_stroke_rate_nonnegative check (avg_stroke_rate_spm is null or avg_stroke_rate_spm >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_avg_swolf_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_avg_swolf_nonnegative check (avg_swolf is null or avg_swolf >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_avg_cadence_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_avg_cadence_nonnegative check (avg_cadence is null or avg_cadence >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_max_hr_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_max_hr_nonnegative check (max_hr is null or max_hr >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_max_power_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_max_power_nonnegative check (max_power is null or max_power >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_elevation_gain_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_elevation_gain_nonnegative check (elevation_gain_m is null or elevation_gain_m >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'completed_activities_elevation_loss_nonnegative' and conrelid = 'public.completed_activities'::regclass) then
    alter table public.completed_activities add constraint completed_activities_elevation_loss_nonnegative check (elevation_loss_m is null or elevation_loss_m >= 0);
  end if;
end $$;
