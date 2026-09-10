-- Invite links, made on the site instead of rotated by hand in SQL.
--
-- Until now there was exactly one code, living in app_settings, shared by everyone and impossible
-- to withdraw from one person without withdrawing it from all. A link is now a row: it knows who
-- made it, what it was for, how many times it has been used, and whether it still works.
--
-- Two kinds, which is the whole point of the split:
--   squad — the mate joins the board and appears in the roster alongside everyone else
--   solo  — the mate is polled and gets the tracker for their own stats, and is not on the board
--
-- The solo boundary is presentational, and deliberately so: this board's data API is public by
-- design (a static site reading with the anon key), so a solo player's rows stay readable by
-- anyone who queries the API directly. It keeps them off the shared board; it does not hide them.
create table if not exists public.invites (
  code text primary key,
  kind text not null check (kind in ('squad', 'solo')),
  label text,
  created_by text references public.players(openid) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  uses integer not null default 0,
  last_used_at timestamptz
);

-- A code is a secret. Only the connect function, which holds the service role, ever reads this
-- table: no anon policy and no grant, so RLS-enabled with no policy means anon sees nothing.
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;

create index if not exists invites_by_maker on public.invites (created_by, created_at desc);

-- Whether this player belongs on the shared board. Everyone already here does.
alter table public.players add column if not exists on_squad boolean not null default true;

-- The code in circulation right now keeps working, as a squad link, so no link already sent to a
-- mate breaks on deploy. app_settings.invite_code stays where it is for the same reason.
insert into public.invites (code, kind, label)
select value, 'squad', 'the original shared code'
from public.app_settings where key = 'invite_code'
on conflict (code) do nothing;

create or replace view public.public_players
with (security_invoker = false) as
  select openid, nickname, avatar, level, token_ok, last_poll_at, created_at, token_seen_since,
         on_squad                                                            -- appended: create-or-replace cannot insert a column mid-list
  from public.players;

grant select on public.public_players to anon, authenticated;
