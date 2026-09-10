-- Server-side HQ sessions handed over from the site's connect flow (bookmarklet).
-- The cookies here let the backend call HQ as the player, so nothing but the service role may read this table.
create table if not exists public.player_sessions (
  openid       text primary key references public.players(openid) on delete cascade,
  cookies      jsonb not null,
  token_fp     text,                                   -- sha256 prefix of the token: tells a re-connect from a fresh login
  source       text,                                   -- 'bookmarklet'
  connected_at timestamptz not null default now(),     -- when this login first arrived
  updated_at   timestamptz not null default now(),     -- when we last received it
  last_ok_at   timestamptz,                            -- last successful HQ call made with it
  last_error   text
);

alter table public.player_sessions enable row level security;   -- no policies: service role only
revoke all on public.player_sessions from anon, authenticated;

-- What the board may know about a server session: that it exists and whether it still works.
create or replace view public.public_sessions
with (security_invoker = false) as
  select openid, connected_at, updated_at, last_ok_at, (last_error is not null) as has_error
  from public.player_sessions;

grant select on public.public_sessions to anon, authenticated;
