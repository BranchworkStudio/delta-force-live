-- A claim on a player while one poll of them is running. The connect page pokes the poller the moment
-- a session is handed over, and cron polls everyone every minute; without a claim the two could poll
-- the same player at once (or a run that overran its minute could meet the next one) and write the
-- same rank sample twice. The poller sets it before polling and clears it after; a run that dies
-- leaves it to lapse on its own.
alter table public.player_sessions add column if not exists polling_until timestamptz;
