-- The read boundary moves from "anyone with the site link" to "people you share a board with".
--
-- Until now every player-keyed table carried `using (true)` for `anon`: the board was private
-- in presentation only, and anyone holding the publishable key could read every row directly.
-- Hand-overs mint real sessions now (0016) and boards are real rows (0017), so the same
-- question the UI asks -- are we on a board together? -- can be asked in SQL instead.
--
-- Two shapes are used deliberately:
--   * tables keep their SELECT grant to `anon` but lose every policy that names it. A role
--     with a grant and no applicable policy reads zero rows and gets HTTP 200, so a stranger
--     sees an empty board and the site's own "Connect an account" state, not a 401 banner.
--   * views are `security_invoker = false`, which BYPASSES the RLS on the tables underneath,
--     so each one carries the predicate itself. This is the trap in the whole migration: a
--     view added later without a predicate hands out everything.

-- Am I on this board? Definer, because a policy on group_members cannot query group_members.
create or replace function public.in_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group and m.openid = public.my_openid())
$$;

-- Do this player and I share one? Yourself always counts, so a player on no board still
-- sees their own matches, and a solo invite keeps meaning what it meant.
create or replace function public.shares_group(p_openid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.my_openid() is not null and (
    p_openid = public.my_openid()
    or exists (
      select 1 from public.group_members a
      join public.group_members b on b.group_id = a.group_id
      where a.openid = public.my_openid() and b.openid = p_openid))
$$;

comment on function public.in_group(uuid) is
  'True when the caller is a member of that board. Definer: a policy on group_members may not read group_members.';
comment on function public.shares_group(text) is
  'The read boundary. True for yourself, and for anyone on a board with you. Null openid (anon) is always false.';

grant execute on function public.in_group(uuid), public.shares_group(text) to anon, authenticated;

-- ---------- the tables ----------

drop policy if exists "anon read matches" on public.matches;
create policy matches_shared on public.matches
  for select to authenticated using (public.shares_group(openid));

drop policy if exists "anon read details" on public.match_details;
create policy match_details_shared on public.match_details
  for select to authenticated using (public.shares_group(openid));

drop policy if exists "anon read red_drops" on public.red_drops;
create policy red_drops_shared on public.red_drops
  for select to authenticated using (public.shares_group(openid));

drop policy if exists "anon read rank_samples" on public.rank_samples;
create policy rank_samples_shared on public.rank_samples
  for select to authenticated using (public.shares_group(openid));

drop policy if exists "anon read carry_out_week" on public.carry_out_week;
create policy carry_out_week_shared on public.carry_out_week
  for select to authenticated using (public.shares_group(openid));

drop policy if exists "anon read red_collection" on public.red_collection;
create policy red_collection_shared on public.red_collection
  for select to authenticated using (public.shares_group(openid));

drop policy if exists "anon read red_collection_summary" on public.red_collection_summary;
create policy red_collection_summary_shared on public.red_collection_summary
  for select to authenticated using (public.shares_group(openid));

-- Board membership: only the boards you are on. Without in_group() this policy would
-- query the table it guards and recurse.
drop policy if exists group_members_readable on public.group_members;
create policy group_members_own_boards on public.group_members
  for select to authenticated using (public.in_group(group_id));

-- Daily room passwords are public knowledge on HQ, but they are part of the board, so they
-- arrive with a session like everything else rather than to any passer-by.
drop policy if exists "anon read site_data" on public.site_data;
create policy site_data_signed_in on public.site_data
  for select to authenticated using (public.my_openid() is not null);

-- ---------- the views ----------

create or replace view public.public_players
with (security_invoker = false) as
  select openid, nickname, avatar, level, token_ok, last_poll_at, created_at, token_seen_since, on_squad
  from public.players
  where public.shares_group(openid);

create or replace view public.public_sessions
with (security_invoker = false) as
  select openid, connected_at, updated_at, last_ok_at, (last_error is not null) as has_error
  from public.player_sessions
  where public.shares_group(openid);

drop view if exists public.match_latency;
create view public.match_latency
with (security_invoker = false) as
  select openid, report_type, room_id, match_time, finished_at, first_seen_at,
         extract(epoch from (first_seen_at - coalesce(finished_at, match_time)))::int as latency_seconds
  from public.matches
  where first_seen_at > match_time + interval '1 second'
    and public.shares_group(openid);
grant select on public.match_latency to anon, authenticated;

drop view if exists public.match_members;
create view public.match_members
with (security_invoker = false) as
  select d.openid, d.report_type, d.room_id, m.match_time, m.map_id,
         (mem->>'is_self')::boolean                 as is_self,
         mem->>'nickname'                           as nickname,
         mem->>'operator_id'                        as operator_id,
         nullif(mem->>'result','')::int             as result,
         nullif(mem->>'is_leave','')::int           as is_leave,
         nullif(mem->>'kill_count','')::int         as kill_count,
         nullif(mem->>'kill_operator','')::int      as kill_operator,
         nullif(mem->>'kill_other','')::int         as kill_other,
         nullif(mem->>'death','')::int              as death,
         nullif(mem->>'assist','')::int             as assist,
         nullif(mem->>'rescue','')::int             as rescue,
         nullif(mem->>'rescue_count','')::int       as rescue_count,
         nullif(mem->>'revive','')::int             as revive,
         nullif(mem->>'carry_out_value','')::bigint as carry_out_value,
         nullif(mem->>'survival_duration','')::numeric as survival_min,
         nullif(mem->>'score','')::int              as score,
         nullif(mem->>'rank_score','')::int         as rank_score,
         case when mem->>'finish_time' ~ '^[0-9]+$' then to_timestamp((mem->>'finish_time')::bigint) end as finish_time
  from public.match_details d
  join public.matches m on m.openid = d.openid and m.report_type = d.report_type and m.room_id = d.room_id
  cross join lateral jsonb_array_elements(d.raw->'members') mem
  where public.shares_group(d.openid);
grant select on public.match_members to anon, authenticated;

create or replace view public.player_rank
with (security_invoker = false) as
select
  openid,
  report_type,
  (raw->'rank_data'->>'current_rank_score')::int as rank_score,
  (raw->'rank_data'->>'highest_rank')::int       as highest_rank,
  (raw->'rank_data'->>'highest_rank_season_id')::int as highest_rank_season_id,
  (raw->'summary_data'->>'total_match_count')::int   as total_match_count,
  fetched_at
from public.player_stats
where public.shares_group(openid);

-- Board names and sizes, for the boards you are on. Codes still live in `groups` alone.
create or replace view public.public_groups
with (security_invoker = false) as
  select g.id, g.name, g.created_by, g.created_at, count(m.openid) as members
  from public.groups g
  left join public.group_members m on m.group_id = g.id
  where public.in_group(g.id)
  group by g.id, g.name, g.created_by, g.created_at;

comment on view public.public_players is
  'The roster you are allowed to see. security_invoker = false, so this predicate is the only thing standing between anon and players.';
