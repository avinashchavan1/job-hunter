-- Job Hunter web: tables live in the shared project's public schema with a jh_ prefix
-- (same convention as the project's other apps). Nothing outside jh_* is touched,
-- except storage policies scoped to the jh-resumes bucket.
begin;

-- ---------------------------------------------------------------- members (allow-list)

create table if not exists public.jh_members (
  email text primary key check (email = lower(email)),
  is_admin boolean not null default false,
  added_at timestamptz not null default now()
);

create or replace function public.jh_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jh_members m where m.email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function public.jh_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jh_members m where m.email = lower(coalesce(auth.jwt() ->> 'email', '')) and m.is_admin)
$$;

revoke all on function public.jh_is_member() from public, anon;
revoke all on function public.jh_is_admin() from public, anon;
grant execute on function public.jh_is_member() to authenticated;
grant execute on function public.jh_is_admin() to authenticated;

-- ---------------------------------------------------------------- data

create table if not exists public.jh_profiles (
  id bigint generated always as identity primary key,
  slug text unique not null,
  name text not null,
  resume_path text,                 -- object key in the jh-resumes bucket
  profile jsonb,                    -- AI-read resume
  prefs jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  gmail_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.jh_jobs (
  id text primary key,
  title text, company text, location text, salary text,
  url text, description text, source text, posted_at text, external_id text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.jh_profile_jobs (
  profile_id bigint not null references public.jh_profiles(id) on delete cascade,
  job_id text not null references public.jh_jobs(id) on delete cascade,
  found_at timestamptz not null default now(),
  sources text not null default '',
  filter_reason text,
  primary key (profile_id, job_id)
);
create index if not exists jh_profile_jobs_job on public.jh_profile_jobs(job_id);

create table if not exists public.jh_scores (
  profile_id bigint not null references public.jh_profiles(id) on delete cascade,
  job_id text not null references public.jh_jobs(id) on delete cascade,
  score integer,
  reasons jsonb,
  red_flags jsonb,
  cover_note text,
  model text,
  scored_at timestamptz not null default now(),
  primary key (profile_id, job_id)
);
create index if not exists jh_scores_job on public.jh_scores(job_id);

create table if not exists public.jh_applications (
  profile_id bigint not null references public.jh_profiles(id) on delete cascade,
  job_id text not null references public.jh_jobs(id) on delete cascade,
  status text not null default 'new',
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (profile_id, job_id)
);
create index if not exists jh_applications_job on public.jh_applications(job_id);

create table if not exists public.jh_runs (
  id bigint generated always as identity primary key,
  profile_id bigint references public.jh_profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  stats jsonb,
  alerts jsonb,
  log text not null default ''
);
create index if not exists jh_runs_profile on public.jh_runs(profile_id, started_at desc);

create table if not exists public.jh_kv (k text primary key, v jsonb);

create table if not exists public.jh_settings (
  id smallint primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.jh_settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------- security: members only, never anon

do $$
declare t text;
begin
  foreach t in array array['jh_profiles','jh_jobs','jh_profile_jobs','jh_scores','jh_applications','jh_runs','jh_kv','jh_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists jh_members_all on public.%I', t);
    execute format('create policy jh_members_all on public.%I for all to authenticated using (public.jh_is_member()) with check (public.jh_is_member())', t);
  end loop;
end $$;

alter table public.jh_members enable row level security;
revoke all on public.jh_members from anon;
grant select, insert, update, delete on public.jh_members to authenticated;
drop policy if exists jh_members_read on public.jh_members;
create policy jh_members_read on public.jh_members for select to authenticated using (public.jh_is_member());
drop policy if exists jh_members_admin on public.jh_members;
create policy jh_members_admin on public.jh_members for all to authenticated using (public.jh_is_admin()) with check (public.jh_is_admin());

-- ---------------------------------------------------------------- resumes bucket (private)

insert into storage.buckets (id, name, public, file_size_limit)
values ('jh-resumes', 'jh-resumes', false, 10485760)
on conflict (id) do nothing;

drop policy if exists jh_resumes_members on storage.objects;
create policy jh_resumes_members on storage.objects for all to authenticated
  using (bucket_id = 'jh-resumes' and public.jh_is_member())
  with check (bucket_id = 'jh-resumes' and public.jh_is_member());

commit;
