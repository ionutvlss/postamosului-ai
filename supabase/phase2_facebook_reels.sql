-- Permite programare separată pentru Facebook Reels pe Pagina PostaMoșului.
alter table public.publishing_schedules drop constraint if exists publishing_schedules_platform_check;
alter table public.publishing_schedules add constraint publishing_schedules_platform_check check (platform in ('facebook','instagram','youtube'));
