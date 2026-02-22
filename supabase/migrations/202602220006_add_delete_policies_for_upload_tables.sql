drop policy if exists "activity_uploads_delete_own" on public.activity_uploads;
create policy "activity_uploads_delete_own"
on public.activity_uploads
for delete
using (auth.uid() = user_id);

drop policy if exists "completed_activities_delete_own" on public.completed_activities;
create policy "completed_activities_delete_own"
on public.completed_activities
for delete
using (auth.uid() = user_id);
