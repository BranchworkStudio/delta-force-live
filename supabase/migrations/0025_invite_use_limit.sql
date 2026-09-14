-- An invite link that stops working after the person it was for.
--
-- A link handed to one stranger was a permanent open door: `uses` was counted and written down,
-- but nothing ever read it, so the only way to close a link was to remember it existed and revoke
-- it by hand. Forwarded on — pasted into a Discord, quoted in a reply — it kept enrolling people
-- onto a backend one person pays for. `max_uses` is the number that was missing.
--
-- Null means what every row here means today: no limit, exactly as before. Nothing already handed
-- out changes behaviour, which is the point of a nullable column rather than a default of 1.
-- New links are minted with 1 by default, because the button that makes one says "invite somebody
-- new" — singular — and that is what it should have meant all along.
--
-- `uses` changes meaning with this, and for the better. It used to count *resolutions* of the code:
-- it went up when an already-enrolled player reopened their own invite link, and it went up when a
-- hand-over failed at HQ a moment later, neither of which spent anything. Now it counts accounts —
-- it is incremented at the point a player row is actually created, and nowhere else. The counts on
-- rows minted before today are therefore high rather than wrong; since those rows are unlimited,
-- nothing reads them.
--
-- To undo: alter table public.invites drop column max_uses;

alter table public.invites add column if not exists max_uses integer
  check (max_uses is null or max_uses >= 1);

comment on column public.invites.max_uses is
  'How many accounts this link may open. Null is unlimited. Enforced in the connect function, which claims a use only when a player row is created.';
comment on column public.invites.uses is
  'Accounts opened with this link. Since 0025 it counts enrolments, not openings of the link.';
