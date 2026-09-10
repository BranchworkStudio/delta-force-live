-- The HQ token cookie has no expiry, so we measure a session's real lifetime:
-- the extension reports when the current token fingerprint first appeared.
alter table public.players add column if not exists token_seen_since timestamptz;

create or replace view public.public_players
with (security_invoker = false) as
  select openid, nickname, avatar, level, token_ok, last_poll_at, created_at, token_seen_since   -- appended: create-or-replace cannot insert a column mid-list
  from public.players;

grant select on public.public_players to anon, authenticated;
