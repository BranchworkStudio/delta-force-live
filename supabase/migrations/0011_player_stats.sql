-- HQ's GetMyData returns the career/season summary the HQ page shows above the match list —
-- the only place a rank or season score could live, since the match rows report rank_score = 0.
-- Stored raw, one row per player per mode, so what HQ actually sends can be read without
-- guessing at its shape. No anon policy yet: nothing on the board reads it until we know
-- there is something in it worth showing.
create table if not exists public.player_stats (
  openid text not null references public.players(openid) on delete cascade,
  report_type integer not null,
  raw jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (openid, report_type)
);

alter table public.player_stats enable row level security;
