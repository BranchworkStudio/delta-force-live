-- Mates join by clicking a link, not by typing anything.
-- The invitation lives in the query string of the connect URL (`connect.html?i=...`), which the
-- bookmarklet carries through the hand-over for free: it navigates back to location minus the
-- fragment, so the invite survives the round trip without being stored anywhere.
insert into public.app_settings (key, value)
values ('invite_code', encode(extensions.gen_random_bytes(9), 'hex'))
on conflict (key) do nothing;

-- Who let this player in, so an invite can be traced (and revoked) later.
alter table public.players add column if not exists enrolled_via text;
alter table public.players add column if not exists enrolled_at timestamptz;
