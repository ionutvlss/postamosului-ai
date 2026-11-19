-- Șterge datele aplicației, dar păstrează utilizatorul administrator și profilul lui.
-- Rulează doar dacă vrei să golești complet conținutul de test.
delete from public.comment_threads;
delete from public.group_outreach_drafts;
delete from public.group_candidates;
delete from public.content_variants;
delete from public.posts;
delete from public.publishing_schedules;
delete from public.social_accounts;
delete from public.automation_settings;
delete from public.media_assets;
delete from storage.objects where bucket_id = 'media';
