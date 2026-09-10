alter table public.matches add column if not exists finished_at timestamptz;
alter table public.matches add column if not exists match_duration_min numeric;

update public.matches m set
  finished_at = to_timestamp((sel->>'finish_time')::bigint),
  match_duration_min = nullif(d.raw->>'match_duration','')::numeric
from public.match_details d, jsonb_array_elements(d.raw->'members') sel
where d.openid = m.openid and d.report_type = m.report_type and d.room_id = m.room_id
  and (sel->>'is_self') = 'true' and (sel->>'finish_time') ~ '^[0-9]+$';

drop view if exists public.match_latency;
create view public.match_latency
with (security_invoker = false) as
  select openid, report_type, room_id, match_time, finished_at, first_seen_at,
         extract(epoch from (first_seen_at - coalesce(finished_at, match_time)))::int as latency_seconds
  from public.matches
  where first_seen_at > match_time + interval '1 second';
grant select on public.match_latency to anon, authenticated;
