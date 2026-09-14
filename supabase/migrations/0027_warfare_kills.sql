-- Warfare kills. HQ reports them in fields we were not reading.
--
-- The two modes share one member object and use disjoint halves of it. In Operations HQ fills
-- `kill_count` / `kill_operator` / `kill_other` and leaves `kill`, `death` and `assist` at zero;
-- in Warfare it does the exact opposite — `kill: 13, death: 8, assist: 16` next to a `kill_count`
-- of 0. We only ever read the Operations half, so every Warfare match on the board said 0 kills
-- while the scoreboard in game said 13. The list endpoint is no help either: its Warfare rows
-- carry `kill_count: 0` as well, so the detail is the only place the number exists at all.
--
-- The split is normalised here rather than left to the page, because "kills" has to mean one
-- thing for the board to add it up. In Warfare there is no AI to kill — every kill is another
-- player — so a Warfare row reports all of its kills as operator kills and zero as AI, which is
-- the fact rather than a convenience. `kill_raw` keeps HQ's own field beside it for anyone
-- reading the view directly.
--
-- `combat_min` joins `survival_min` for the same reason: HQ fills `survival_duration` in
-- Operations and `combat_duration` in Warfare, and the board had only the first, so its
-- "avg alive" cell was blank for every Warfare match.
--
-- To undo: restore the view body from 0019.

drop view if exists public.match_members;
create view public.match_members
with (security_invoker = false) as
  select d.openid, d.report_type, d.room_id, m.match_time, m.map_id,
         (mem->>'is_self')::boolean                 as is_self,
         mem->>'nickname'                           as nickname,
         mem->>'operator_id'                        as operator_id,
         nullif(mem->>'result','')::int             as result,
         nullif(mem->>'is_leave','')::int           as is_leave,
         case when d.report_type = 2 then nullif(mem->>'kill','')::int
              else nullif(mem->>'kill_count','')::int end    as kill_count,
         case when d.report_type = 2 then nullif(mem->>'kill','')::int
              else nullif(mem->>'kill_operator','')::int end as kill_operator,
         case when d.report_type = 2 then 0
              else nullif(mem->>'kill_other','')::int end    as kill_other,
         nullif(mem->>'kill','')::int               as kill_raw,
         nullif(mem->>'death','')::int              as death,
         nullif(mem->>'assist','')::int             as assist,
         nullif(mem->>'rescue','')::int             as rescue,
         nullif(mem->>'rescue_count','')::int       as rescue_count,
         nullif(mem->>'revive','')::int             as revive,
         nullif(mem->>'carry_out_value','')::bigint as carry_out_value,
         nullif(mem->>'survival_duration','')::numeric as survival_min,
         nullif(mem->>'combat_duration','')::numeric   as combat_min,
         nullif(mem->>'score','')::int              as score,
         nullif(mem->>'rank_score','')::int         as rank_score,
         case when mem->>'finish_time' ~ '^[0-9]+$' then to_timestamp((mem->>'finish_time')::bigint) end as finish_time
  from public.match_details d
  join public.matches m on m.openid = d.openid and m.report_type = d.report_type and m.room_id = d.room_id
  cross join lateral jsonb_array_elements(d.raw->'members') mem
  where public.shares_group(d.openid);

-- As 0021 left it: anon reads nothing in this schema.
revoke all on public.match_members from anon, public;
grant select on public.match_members to authenticated;

-- Every Warfare match already collected has its detail stored, so the numbers are recoverable
-- without asking HQ again. The poller writes these three on new details from now on.
update public.matches m
   set kill_count    = (me->>'kill')::int,
       kill_operator = (me->>'kill')::int,
       kill_other    = 0
  from public.match_details d
  cross join lateral (
    select x from jsonb_array_elements(d.raw->'members') x
     where (x->>'is_self')::text in ('true','1') limit 1
  ) s(me)
 where d.openid = m.openid and d.report_type = m.report_type and d.room_id = m.room_id
   and m.report_type = 2 and me ? 'kill';
