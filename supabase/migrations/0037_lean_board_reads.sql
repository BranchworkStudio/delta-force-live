-- Two reads the board used to make by downloading far more than it needed, every 30 seconds.
-- Both run as the caller (security invoker), so the shares_group policies on matches and
-- rank_samples still decide what a session sees.

-- "The last raid was 3 d ago": one row per player and mode, instead of the latest 200 matches.
create or replace view public.latest_match
with (security_invoker = true) as
  select distinct on (openid, report_type) openid, report_type, match_time
  from public.matches
  order by openid, report_type, match_time desc;

revoke all on public.latest_match from anon, authenticated;
grant select on public.latest_match to authenticated;

-- The standing in force when a range opened: each player's last sample at or before p_since.
-- The board reads the samples inside the range separately, so it no longer needs the whole history.
create or replace function public.rank_baseline(p_mode int, p_since timestamptz)
returns setof public.rank_samples
language sql stable security invoker set search_path = public as $$
  select distinct on (openid) *
  from public.rank_samples
  where report_type = p_mode and taken_at <= p_since
  order by openid, taken_at desc
$$;

revoke execute on function public.rank_baseline(int, timestamptz) from public, anon;
grant execute on function public.rank_baseline(int, timestamptz) to authenticated;
