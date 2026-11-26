-- Matches view + stats for the Today / Tracker screens. Both run with the caller's rights,
-- so row security (members only) still applies.
begin;

alter table public.jh_scores add column if not exists matched jsonb;
alter table public.jh_scores add column if not exists missing jsonb;

create or replace view public.jh_matches with (security_invoker = true) as
select j.*,
       pj.profile_id, pj.found_at, pj.sources, pj.filter_reason,
       s.score, coalesce(s.reasons, '[]'::jsonb) as reasons, coalesce(s.red_flags, '[]'::jsonb) as red_flags,
       s.cover_note, s.scored_at, coalesce(s.matched, '[]'::jsonb) as matched, coalesce(s.missing, '[]'::jsonb) as missing,
       coalesce(a.status, 'new') as status, a.notes, a.updated_at as status_at
from public.jh_profile_jobs pj
join public.jh_jobs j on j.id = pj.job_id
left join public.jh_scores s on s.profile_id = pj.profile_id and s.job_id = pj.job_id
left join public.jh_applications a on a.profile_id = pj.profile_id and a.job_id = pj.job_id;

revoke all on public.jh_matches from anon;
grant select on public.jh_matches to authenticated;

create or replace function public.jh_stats(pid bigint, since timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', (select count(*) from public.jh_profile_jobs where profile_id = pid),
    'filtered', (select count(*) from public.jh_profile_jobs where profile_id = pid and filter_reason is not null),
    'unscored', (select count(*) from public.jh_profile_jobs pj left join public.jh_scores s on s.profile_id = pj.profile_id and s.job_id = pj.job_id
                 where pj.profile_id = pid and pj.filter_reason is null and s.job_id is null),
    'scored', (select count(*) from public.jh_scores where profile_id = pid),
    'avg_score', (select coalesce(round(avg(score)::numeric, 1), 0) from public.jh_scores where profile_id = pid),
    'new_today', (select count(*) from public.jh_profile_jobs where profile_id = pid and found_at >= since),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.jh_applications where profile_id = pid group by status) x),
    'by_source', (select coalesce(jsonb_object_agg(coalesce(source, ''), n), '{}'::jsonb) from (select j.source, count(*) n from public.jh_profile_jobs pj join public.jh_jobs j on j.id = pj.job_id where pj.profile_id = pid group by j.source) y)
  )
$$;
revoke all on function public.jh_stats(bigint, timestamptz) from public, anon;
grant execute on function public.jh_stats(bigint, timestamptz) to authenticated;

commit;
