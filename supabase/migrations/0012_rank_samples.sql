-- HQ reports a rank score, but only ever as today's total: the per-match rank_score is 0 on
-- every raid, so there is no record of what a single match was worth. The only way to get a
-- gained/lost figure is to watch the total. The poller samples it every minute and writes a row
-- whenever it moves, which makes the history from now on — nothing before the first sample can
-- be recovered.
create table if not exists public.rank_samples (
  openid text not null references public.players(openid) on delete cascade,
  report_type integer not null,
  taken_at timestamptz not null default now(),
  rank_score integer not null,
  primary key (openid, report_type, taken_at)
);

create index if not exists rank_samples_recent on public.rank_samples (openid, report_type, taken_at desc);

alter table public.rank_samples enable row level security;
drop policy if exists "anon read rank_samples" on public.rank_samples;
create policy "anon read rank_samples" on public.rank_samples for select to anon, authenticated using (true);
grant select on public.rank_samples to anon, authenticated;

-- The board needs the standing itself, not the career dump that arrives with it, so the rank
-- fields get their own view and `player_stats` stays unreadable to anon.
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
from public.player_stats;

grant select on public.player_rank to anon, authenticated;
