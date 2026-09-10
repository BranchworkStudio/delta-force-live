-- The career red wall, from GetDahongCollection. The drop record list the board already reads is
-- capped — it holds the latest 50 rows and nothing older — so it cannot say how much has been
-- found over an account's whole life. This endpoint can: one entry per red *type* ever found with
-- how many of each, and HQ's own career totals alongside.
--
-- Per-type value, name, image and source maps are not in this payload and are not stored here:
-- they come from the official basic_info collection table the page already loads, which is also
-- where the 103-type denominator comes from (grade 6 and is_collectible).
create table if not exists public.red_collection (
  openid text not null references public.players(openid) on delete cascade,
  item_id text not null,
  owned_count integer,
  is_new boolean,
  fetched_at timestamptz not null default now(),
  primary key (openid, item_id)
);

alter table public.red_collection enable row level security;
drop policy if exists "anon read red_collection" on public.red_collection;
create policy "anon read red_collection" on public.red_collection for select to anon, authenticated using (true);
grant select on public.red_collection to anon, authenticated;

-- HQ's own career totals, kept rather than re-derived: its value figure is the authoritative one
-- for a single player, and a total summed from our side would quietly disagree with what HQ shows.
create table if not exists public.red_collection_summary (
  openid text primary key references public.players(openid) on delete cascade,
  type_count integer,
  total_count integer,
  total_value bigint,
  weekly_count integer,
  fetched_at timestamptz not null default now()
);

alter table public.red_collection_summary enable row level security;
drop policy if exists "anon read red_collection_summary" on public.red_collection_summary;
create policy "anon read red_collection_summary" on public.red_collection_summary for select to anon, authenticated using (true);
grant select on public.red_collection_summary to anon, authenticated;
