alter table public.completed_activities
  drop constraint if exists completed_activities_upload_id_fkey;

alter table public.completed_activities
  add constraint completed_activities_upload_id_fkey
  foreign key (upload_id)
  references public.activity_uploads(id)
  on delete cascade;
