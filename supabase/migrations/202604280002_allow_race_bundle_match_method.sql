-- Race-bundled segments link to a planned race session via session_activity_links
-- with match_method = 'race_bundle'. Extend the existing CHECK to permit it.

alter table public.session_activity_links
  drop constraint if exists session_activity_links_match_method_check;

alter table public.session_activity_links
  add constraint session_activity_links_match_method_check
  check (match_method in (
    'tolerance_auto',
    'coach_confirmed',
    'athlete_confirmed',
    'manual_override',
    'unmatched',
    'race_bundle'
  ));
