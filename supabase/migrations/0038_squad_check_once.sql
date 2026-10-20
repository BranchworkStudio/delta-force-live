-- The read boundary, asked once per query instead of once per row.
--
-- Every policy and board view asked shares_group(openid) of each row, and Postgres cannot hoist a
-- function that takes the row's own column: with 8 players the 30-day squad list spent 0.9 s on
-- it, and the cost grows with every player in the database, not with the squad being read — at
-- roughly 70 players "30 days" would have hit the 8 s statement timeout for everybody.
-- `openid in (select my_squad())` is the same question turned around: work out who I may see,
-- once, and let each row be a hash lookup against that. Same rows, about a hundredth of the time.

-- Me, and everybody on a board with me. Definer for the same reason as shares_group: a policy on
-- group_members cannot read group_members. Null openid (anon) yields nobody.
create or replace function public.my_squad() returns setof text
language sql stable security definer set search_path = '' as $$
  select public.my_openid() where public.my_openid() is not null
  union
  select b.openid from public.group_members a
  join public.group_members b on b.group_id = a.group_id
  where a.openid = public.my_openid()
$$;
comment on function public.my_squad() is
  'The read boundary as a set: yourself and anyone on a board with you. Use as openid in (select my_squad()).';
revoke execute on function public.my_squad() from anon, public;
grant execute on function public.my_squad() to authenticated;

-- ---------- the tables ----------
alter policy matches_shared on public.matches using (openid in (select public.my_squad()));
alter policy match_details_shared on public.match_details using (openid in (select public.my_squad()));
alter policy red_drops_shared on public.red_drops using (openid in (select public.my_squad()));
alter policy rank_samples_shared on public.rank_samples using (openid in (select public.my_squad()));
alter policy carry_out_week_shared on public.carry_out_week using (openid in (select public.my_squad()));
alter policy event_collection_shared on public.event_collection using (openid in (select public.my_squad()));
alter policy red_collection_shared on public.red_collection using (openid in (select public.my_squad()));
alter policy red_collection_summary_shared on public.red_collection_summary using (openid in (select public.my_squad()));

-- ---------- the definer views, which carry the predicate themselves ----------
create or replace view public.public_players with (security_invoker = false) as
  select openid, nickname, avatar, level, token_ok, last_poll_at, created_at, token_seen_since, on_squad, is_admin
  from public.players
  where openid in (select public.my_squad());

create or replace view public.public_sessions with (security_invoker = false) as
  select openid, connected_at, updated_at, last_ok_at, last_error is not null as has_error
  from public.player_sessions
  where openid in (select public.my_squad());

create or replace view public.match_latency with (security_invoker = false) as
  select openid, report_type, room_id, match_time, finished_at, first_seen_at,
         extract(epoch from first_seen_at - coalesce(finished_at, match_time))::integer as latency_seconds
  from public.matches
  where first_seen_at > (match_time + '00:00:01'::interval) and openid in (select public.my_squad());

create or replace view public.player_rank with (security_invoker = false) as
  select openid, report_type,
         ((raw -> 'rank_data') ->> 'current_rank_score')::integer as rank_score,
         ((raw -> 'rank_data') ->> 'highest_rank')::integer as highest_rank,
         ((raw -> 'rank_data') ->> 'highest_rank_season_id')::integer as highest_rank_season_id,
         ((raw -> 'summary_data') ->> 'total_match_count')::integer as total_match_count,
         fetched_at
  from public.player_stats
  where openid in (select public.my_squad());

create or replace view public.match_members with (security_invoker = false) as
  select d.openid, d.report_type, d.room_id, m.match_time, m.map_id,
    (mem.value ->> 'is_self')::boolean as is_self,
    mem.value ->> 'nickname' as nickname,
    mem.value ->> 'operator_id' as operator_id,
    nullif(mem.value ->> 'result', '')::integer as result,
    nullif(mem.value ->> 'is_leave', '')::integer as is_leave,
    case when d.report_type = 2 then nullif(mem.value ->> 'kill', '')::integer
         else nullif(mem.value ->> 'kill_count', '')::integer end as kill_count,
    case when d.report_type = 2 then nullif(mem.value ->> 'kill', '')::integer
         else nullif(mem.value ->> 'kill_operator', '')::integer end as kill_operator,
    case when d.report_type = 2 then 0
         else nullif(mem.value ->> 'kill_other', '')::integer end as kill_other,
    nullif(mem.value ->> 'kill', '')::integer as kill_raw,
    nullif(mem.value ->> 'death', '')::integer as death,
    nullif(mem.value ->> 'assist', '')::integer as assist,
    nullif(mem.value ->> 'rescue', '')::integer as rescue,
    nullif(mem.value ->> 'rescue_count', '')::integer as rescue_count,
    nullif(mem.value ->> 'revive', '')::integer as revive,
    nullif(mem.value ->> 'carry_out_value', '')::bigint as carry_out_value,
    nullif(mem.value ->> 'survival_duration', '')::numeric as survival_min,
    nullif(mem.value ->> 'combat_duration', '')::numeric as combat_min,
    nullif(mem.value ->> 'score', '')::integer as score,
    nullif(mem.value ->> 'rank_score', '')::integer as rank_score,
    case when (mem.value ->> 'finish_time') ~ '^[0-9]+$'
         then to_timestamp((mem.value ->> 'finish_time')::bigint::double precision) end as finish_time
  from public.match_details d
  join public.matches m on m.openid = d.openid and m.report_type = d.report_type and m.room_id = d.room_id
  cross join lateral jsonb_array_elements(d.raw -> 'members') mem(value)
  where d.openid in (select public.my_squad());

-- The board's "something new" signal also has to move when a match's detail lands: the kill split
-- and the squad list arrive a run or two after the match itself about one time in a hundred.
create or replace view public.latest_match with (security_invoker = true) as
  select distinct on (openid, report_type) openid, report_type, match_time,
         kill_operator is null as pending                              -- appended: no detail yet
  from public.matches
  order by openid, report_type, match_time desc;
