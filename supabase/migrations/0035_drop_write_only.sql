-- Data that was written and never read. The poller stopped writing the first three in e25d049;
-- token_expires was never set (the HQ token is a session cookie with no expiry), and the old
-- invite_code row has lived on as a squad link in public.invites since 0015.
alter table public.matches drop column if exists raw;
alter table public.red_drops drop column if exists raw;
drop table if exists public.event_collection_summary;
alter table public.players drop column if exists token_expires;
delete from public.app_settings where key = 'invite_code';
