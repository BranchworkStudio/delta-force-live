-- Limited-time collection events, of which the Ahsarah card collection is the first.
--
-- `red_collection` is a table named after its event because reds are permanent — they are part of
-- the game, not part of a season. A seasonal collection is not: S7's playing cards stop existing
-- when S7 does, and S8 will bring something else with the same shape and a different name. A table
-- per event would mean a migration per season for rows that are already shaped identically, so the
-- event is a column instead. Adding next season's collection is then a poller config entry and a
-- front-end module, and nothing here changes at all.
--
-- The shape all of them share is the only thing this commits to: for a player, how many of each
-- item they hold. What "item" means, how many exist, and what they are called live in the official
-- basic_info manifest the page loads — exactly as the red wall reads its names and values from
-- collections_en.js rather than storing them.
create table if not exists public.event_collection (
  openid text not null references public.players(openid) on delete cascade,
  event_key text not null,
  item_id text not null,
  owned_count integer,
  fetched_at timestamptz not null default now(),
  primary key (openid, event_key, item_id)
);

-- Reading is one event at a time, for the players on your board.
create index if not exists event_collection_by_event on public.event_collection (event_key, openid);

alter table public.event_collection enable row level security;
drop policy if exists event_collection_shared on public.event_collection;
create policy event_collection_shared on public.event_collection
  for select to authenticated using (public.shares_group(openid));
grant select on public.event_collection to authenticated;

-- HQ's own totals for the event, kept verbatim rather than re-derived. For the cards that is
-- owned/unowned counts and the per-suit progress; for whatever S8 brings it will be something
-- else, which is why it is jsonb and not columns. A figure we add up ourselves can quietly
-- disagree with the one HQ shows, and when it does, HQ is the one the player will have seen.
create table if not exists public.event_collection_summary (
  openid text not null references public.players(openid) on delete cascade,
  event_key text not null,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  primary key (openid, event_key)
);

alter table public.event_collection_summary enable row level security;
drop policy if exists event_collection_summary_shared on public.event_collection_summary;
create policy event_collection_summary_shared on public.event_collection_summary
  for select to authenticated using (public.shares_group(openid));
grant select on public.event_collection_summary to authenticated;

comment on table public.event_collection is
  'Per-item holdings for a limited-time collection event, keyed by event_key. Item names and the denominator come from the official basic_info manifest, not from here.';
comment on column public.event_collection.owned_count is
  'HQ''s count for this item. For the Ahsarah cards this is a lifetime "ever unlocked" tally, not current inventory: selling a card does not decrement it.';
