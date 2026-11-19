-- PostaMoșului AI · Etapa 2: automatizare editorială
-- Rulează după schema.sql. Scriptul este gândit să poată fi rerulat.

create table if not exists public.content_variants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','youtube')),
  title text,
  body text,
  hashtags text[],
  ai_model text,
  generation_prompt text,
  approval_status text not null default 'draft' check (approval_status in ('draft','pending_approval','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.publishing_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram','youtube')),
  posts_per_day integer not null default 2 check (posts_per_day between 0 and 5),
  slots jsonb not null default '["10:00", "19:00"]'::jsonb,
  enabled boolean not null default false,
  require_approval boolean not null default true,
  timezone text not null default 'Europe/Bucharest',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, platform)
);

create table if not exists public.group_candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  external_group_id text,
  group_name text not null,
  group_url text,
  category text,
  member_count integer,
  relevance_score numeric(5,2),
  activity_score numeric(5,2),
  language text default 'ro',
  status text not null default 'discovered' check (status in ('discovered','shortlisted','excluded','manual_review')),
  last_checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(owner_id, external_group_id)
);

create table if not exists public.group_outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.group_candidates(id) on delete cascade,
  media_id uuid references public.media_assets(id) on delete set null,
  body text not null,
  hashtags text[],
  ai_model text,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','posted','rejected','failed')),
  scheduled_for timestamptz,
  posted_at timestamptz,
  external_post_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comment_threads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','youtube')),
  external_comment_id text not null,
  external_post_id text,
  author_name text,
  comment_body text,
  sentiment text,
  reply_draft text,
  reply_status text not null default 'unreviewed' check (reply_status in ('unreviewed','approved','sent','ignored','failed')),
  replied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, platform, external_comment_id)
);

alter table public.content_variants enable row level security;
alter table public.publishing_schedules enable row level security;
alter table public.group_candidates enable row level security;
alter table public.group_outreach_drafts enable row level security;
alter table public.comment_threads enable row level security;

grant select, insert, update, delete on public.content_variants, public.publishing_schedules, public.group_candidates, public.group_outreach_drafts, public.comment_threads to authenticated;

do $$ begin
  create policy "admins manage content variants" on public.content_variants for all to authenticated using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins manage publishing schedules" on public.publishing_schedules for all to authenticated using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins manage group candidates" on public.group_candidates for all to authenticated using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins manage group outreach drafts" on public.group_outreach_drafts for all to authenticated using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins manage comment threads" on public.comment_threads for all to authenticated using (owner_id = auth.uid() and public.is_admin()) with check (owner_id = auth.uid() and public.is_admin());
exception when duplicate_object then null; end $$;
