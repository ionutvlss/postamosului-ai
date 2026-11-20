-- PostaMoșului AI · Etapa 4: conectarea conturilor și publicarea automată.
-- Idempotent: workflow-ul de deploy îl rulează la fiecare push.

-- TikTok devine platformă suportată peste tot.
alter table public.social_accounts drop constraint if exists social_accounts_platform_check;
alter table public.social_accounts add constraint social_accounts_platform_check check (platform in ('facebook','instagram','youtube','tiktok'));
alter table public.posts drop constraint if exists posts_platform_check;
alter table public.posts add constraint posts_platform_check check (platform in ('facebook','instagram','youtube','tiktok'));
alter table public.content_variants drop constraint if exists content_variants_platform_check;
alter table public.content_variants add constraint content_variants_platform_check check (platform in ('facebook','instagram','youtube','tiktok'));
alter table public.publishing_schedules drop constraint if exists publishing_schedules_platform_check;
alter table public.publishing_schedules add constraint publishing_schedules_platform_check check (platform in ('facebook','instagram','youtube','tiktok'));

-- Stare intermediară cât timp o platformă procesează clipul.
alter type public.post_status add value if not exists 'publishing';

alter table public.posts add column if not exists last_error text;
alter table public.posts add column if not exists attempts integer not null default 0;
alter table public.posts add column if not exists external_url text;

-- Tokenurile stau separat, fără nicio politică RLS: doar Edge Functions (service role) le pot citi.
create table if not exists public.social_tokens (
  account_id uuid primary key references public.social_accounts(id) on delete cascade,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.social_tokens enable row level security;
revoke all on public.social_tokens from anon, authenticated;

create table if not exists public.oauth_states (
  state text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('meta','youtube','tiktok')),
  return_to text not null,
  code_verifier text,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

-- Secret generat în baza de date pentru apelurile cron → publish-due.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'publisher_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'publisher_cron_secret');
  end if;
end $$;

create or replace function public.check_publisher_secret(candidate text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'publisher_cron_secret' and decrypted_secret = candidate
  );
$$;
revoke all on function public.check_publisher_secret(text) from public, anon, authenticated;
grant execute on function public.check_publisher_secret(text) to service_role;

create or replace function public.trigger_publisher()
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  base_url text;
  cron_secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'publisher_cron_secret';
  if base_url is null or cron_secret is null then return; end if;
  perform net.http_post(
    url := base_url || '/functions/v1/publish-due',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end $$;
revoke all on function public.trigger_publisher() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('postamosului-publish-due') where exists (select 1 from cron.job where jobname = 'postamosului-publish-due');
  perform cron.schedule('postamosului-publish-due', '*/5 * * * *', 'select public.trigger_publisher()');
end $$;

-- Funcțiile de pe server (service_role) au nevoie de acces complet la tabelele aplicației.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Comentarii: răspunsuri cu AI (etapa 5).
alter table public.comment_threads drop constraint if exists comment_threads_platform_check;
alter table public.comment_threads add constraint comment_threads_platform_check check (platform in ('facebook','instagram','youtube','tiktok'));
alter table public.comment_threads add column if not exists post_id uuid references public.posts(id) on delete set null;
alter table public.comment_threads add column if not exists last_error text;
alter table public.automation_settings add column if not exists comments_mode text not null default 'approve';
alter table public.automation_settings drop constraint if exists automation_settings_comments_mode_check;
alter table public.automation_settings add constraint automation_settings_comments_mode_check check (comments_mode in ('off','approve','auto_safe'));

create or replace function public.trigger_comments_sync()
returns void language plpgsql security definer set search_path = public, vault as $$
declare base_url text; cron_secret text;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'publisher_cron_secret';
  if base_url is null or cron_secret is null then return; end if;
  perform net.http_post(url := base_url || '/functions/v1/comments-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cron_secret), body := '{}'::jsonb, timeout_milliseconds := 5000);
end $$;
revoke all on function public.trigger_comments_sync() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('postamosului-comments-sync') where exists (select 1 from cron.job where jobname = 'postamosului-comments-sync');
  perform cron.schedule('postamosului-comments-sync', '*/10 * * * *', 'select public.trigger_comments_sync()');
end $$;
