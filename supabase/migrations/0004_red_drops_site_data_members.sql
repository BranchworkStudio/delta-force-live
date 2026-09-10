create table if not exists public.red_drops (
  openid           text not null references public.players(openid) on delete cascade,
  collection_id    text not null,
  map_id           int,
  unlock_time      timestamptz not null,
  value            bigint,
  collection_count int,
  first_seen_at    timestamptz not null default now(),
  raw              jsonb,
  primary key (openid, collection_id, unlock_time)
);
create index if not exists red_drops_time_idx on public.red_drops (unlock_time desc);
alter table public.red_drops enable row level security;
drop policy if exists "anon read red_drops" on public.red_drops;
create policy "anon read red_drops" on public.red_drops for select to anon, authenticated using (true);
grant select on public.red_drops to anon, authenticated;

create table if not exists public.site_data (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.site_data enable row level security;
drop policy if exists "anon read site_data" on public.site_data;
create policy "anon read site_data" on public.site_data for select to anon, authenticated using (true);
grant select on public.site_data to anon, authenticated;

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
  cross join lateral jsonb_array_elements(d.raw->'members') mem;
grant select on public.match_members to anon, authenticated;
