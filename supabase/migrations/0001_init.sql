-- Delta Force Live: schema
create table if not exists public.players (
  openid        text primary key,
  nickname      text,
  avatar        text,
  level         int,
  ingest_key    text not null unique,
  token_ok      boolean,
  token_expires timestamptz,
  created_at    timestamptz not null default now(),
  last_poll_at  timestamptz
);

create table if not exists public.matches (
  openid          text not null references public.players(openid) on delete cascade,
  report_type     smallint not null,            -- 1 = Operations, 2 = Warfare
  room_id         text not null,
  match_time      timestamptz not null,
  map_id          int,
  result          smallint,                     -- 1 extracted/victory, 2 failed/defeat, 3 draw
  is_leave        smallint,
  kill_count      int,
  carry_out_value bigint,
  net_income      bigint,
  operator_id     text,
  score           int,
  first_seen_at   timestamptz not null default now(),
  raw             jsonb,
  primary key (openid, report_type, room_id)
);
create index if not exists matches_time_idx on public.matches (match_time desc);
create index if not exists matches_seen_idx on public.matches (first_seen_at desc);

create table if not exists public.match_details (
  openid      text not null,
  report_type smallint not null,
  room_id     text not null,
  raw         jsonb not null,
  fetched_at  timestamptz not null default now(),
  primary key (openid, report_type, room_id),
  foreign key (openid, report_type, room_id) references public.matches(openid, report_type, room_id) on delete cascade
);

-- Public read model: never expose ingest keys.
create or replace view public.public_players
with (security_invoker = false) as
  select openid, nickname, avatar, level, token_ok, last_poll_at, created_at
  from public.players;

alter table public.players       enable row level security;
alter table public.matches       enable row level security;
alter table public.match_details enable row level security;

-- Anonymous visitors may read matches and details (squad site), never players directly.
drop policy if exists "anon read matches" on public.matches;
create policy "anon read matches" on public.matches for select to anon, authenticated using (true);
drop policy if exists "anon read details" on public.match_details;
create policy "anon read details" on public.match_details for select to anon, authenticated using (true);

revoke all on public.players from anon, authenticated;
grant select on public.public_players to anon, authenticated;
grant select on public.matches, public.match_details to anon, authenticated;

-- Latency stat: how long after a match ended did the API first show it? Answers the "is it live?" question.
create or replace view public.match_latency
with (security_invoker = false) as
  select openid, report_type, room_id, match_time, first_seen_at,
         extract(epoch from (first_seen_at - match_time))::int as latency_seconds
  from public.matches
  where first_seen_at > match_time;            -- backfilled history is excluded by the ingest function
grant select on public.match_latency to anon, authenticated;
