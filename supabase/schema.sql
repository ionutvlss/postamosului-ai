-- PostaMoșului AI · schema inițială
create extension if not exists "pgcrypto";

create type public.app_role as enum ('admin');
create type public.post_status as enum ('draft', 'pending_approval', 'scheduled', 'published', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.app_role not null default 'admin',
  created_at timestamptz not null default now()
);

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','youtube')),
  account_name text,
  external_account_id text,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  status text not null default 'disconnected',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, platform)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','youtube')),
  title text not null,
  body text,
  hashtags text[],
  media_id uuid references public.media_assets(id) on delete set null,
  status public.post_status not null default 'draft',
  scheduled_for timestamptz,
  published_at timestamptz,
  external_post_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.automation_settings (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  approval_required boolean not null default true,
  weekly_summary boolean not null default true,
  brand_voice text,
  timezone text not null default 'Europe/Bucharest',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.social_accounts enable row level security;
alter table public.media_assets enable row level security;
alter table public.posts enable row level security;
alter table public.automation_settings enable row level security;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create policy "admins can read own profile" on public.profiles for select using (id = auth.uid() and public.is_admin());
create policy "admins manage social accounts" on public.social_accounts for all using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());
create policy "admins manage media" on public.media_assets for all using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());
create policy "admins manage posts" on public.posts for all using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());
create policy "admins manage settings" on public.automation_settings for all using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());

insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict (id) do nothing;
create policy "admins upload media" on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.is_admin() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admins read media" on storage.objects for select to authenticated using (bucket_id = 'media' and public.is_admin() and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admins delete media" on storage.objects for delete to authenticated using (bucket_id = 'media' and public.is_admin() and (storage.foldername(name))[1] = auth.uid()::text);
