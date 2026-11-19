-- PostaMoșului AI · permisiuni complete pentru modulele aplicației
-- Rulează după schema.sql și fazele de automatizare.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;

drop policy if exists "admins update own profile" on public.profiles;
create policy "admins update own profile" on public.profiles
for update to authenticated
using (id = auth.uid() and public.is_admin())
with check (id = auth.uid() and public.is_admin());
grant select, insert, update, delete on public.social_accounts to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;
grant select, insert, update, delete on public.posts to authenticated;
grant select, insert, update, delete on public.automation_settings to authenticated;
grant select, insert, update, delete on public.content_variants to authenticated;
grant select, insert, update, delete on public.publishing_schedules to authenticated;
grant select, insert, update, delete on public.group_candidates to authenticated;
grant select, insert, update, delete on public.group_outreach_drafts to authenticated;
grant select, insert, update, delete on public.comment_threads to authenticated;
