-- The gold items HQ lists come from a different surface than the reds. GetRedDropRecordList
-- returns grade 6 and nothing else — HQ calls it with exactly our six params and applies no
-- grade filter of its own, so that is the endpoint's whole answer. The golds live in
-- GetAssetWeekCalendar, which reports the *current week* as a rollup: one row per item with its
-- unit value and how many were carried out. No timestamp, no map. So this is stored as what it
-- is — a week's tally, keyed by the week HQ says it belongs to — rather than folded into
-- red_drops, where every row is a dated drop.
create table if not exists public.carry_out_week (
  openid text not null references public.players(openid) on delete cascade,
  week_start timestamptz not null,
  item_id text not null,
  item_value bigint,
  carry_out_count integer,
  fetched_at timestamptz not null default now(),
  primary key (openid, week_start, item_id)
);

create index if not exists carry_out_week_recent on public.carry_out_week (week_start desc, item_value desc);

alter table public.carry_out_week enable row level security;
drop policy if exists "anon read carry_out_week" on public.carry_out_week;
create policy "anon read carry_out_week" on public.carry_out_week for select to anon, authenticated using (true);
grant select on public.carry_out_week to anon, authenticated;
