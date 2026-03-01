alter table public.session_activity_links
  add column if not exists confirmation_status text
    check (confirmation_status in ('suggested','confirmed','rejected'))
    default 'confirmed',
  add column if not exists matched_by uuid references auth.users(id) on delete set null,
  add column if not exists matched_at timestamptz,
  add column if not exists match_method text
    check (match_method in ('tolerance_auto','coach_confirmed','athlete_confirmed','manual_override','unmatched'));

update public.session_activity_links
set confirmation_status = coalesce(confirmation_status, 'confirmed'),
    matched_at = coalesce(matched_at, created_at),
    match_method = coalesce(match_method, case when link_type = 'auto' then 'tolerance_auto' else 'manual_override' end)
where confirmation_status is null
   or match_method is null;

alter table public.session_activity_links
  alter column confirmation_status set not null;

create index if not exists session_activity_links_confirmation_idx
  on public.session_activity_links(user_id, confirmation_status, created_at desc);

create index if not exists session_activity_links_match_method_idx
  on public.session_activity_links(user_id, match_method, created_at desc);
