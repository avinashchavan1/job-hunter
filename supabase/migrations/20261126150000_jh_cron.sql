-- Daily job check: every 5 minutes pg_cron pokes jh-api, which decides whether anyone is due (India time).
-- The token lives in jh_secrets (server-only) and is generated here, never written in code.
begin;
insert into public.jh_secrets (k, v) values ('CRON_TOKEN', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (k) do nothing;

select cron.schedule(
  'jh-daily-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://vrhcofbhrcqthbacixpb.supabase.co/functions/v1/jh-api',
    headers := jsonb_build_object('content-type', 'application/json', 'x-jh-cron', (select v from public.jh_secrets where k = 'CRON_TOKEN')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  )
  $$
);
commit;
