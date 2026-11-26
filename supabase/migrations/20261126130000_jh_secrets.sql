-- API keys for the server functions. No policies + no grants: only the service role (server) can read or write.
begin;
create table if not exists public.jh_secrets (
  k text primary key,
  v text not null,
  updated_at timestamptz not null default now()
);
alter table public.jh_secrets enable row level security;
revoke all on public.jh_secrets from anon, authenticated;
commit;
