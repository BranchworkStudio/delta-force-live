-- HQ reports three kill numbers per member: kill_count = kill_operator + kill_other.
-- Operator kills are other players; kill_other is AI. Only the first belongs in a K/D, so the
-- board needs them apart. The match list row carries the total alone, so both come from the
-- detail payload and are copied onto `matches` when the poller stores that detail.
alter table public.matches
  add column if not exists kill_operator integer,
  add column if not exists kill_other integer;

update public.matches m
set kill_operator = s.ko, kill_other = s.ko_other
from (
  select d.openid, d.report_type, d.room_id,
         (mem->>'kill_operator')::int as ko,
         (mem->>'kill_other')::int as ko_other
  from public.match_details d
  cross join lateral jsonb_array_elements(d.raw->'members') mem
  where (mem->>'is_self')::boolean
) s
where m.openid = s.openid and m.report_type = s.report_type and m.room_id = s.room_id;
