-- The browser extension is gone: the server has collected every match since the poller
-- shipped, so the push path it authenticated with has nothing left to protect.
--   * `ingest_key` was the per-browser key the extension posted with.
--   * `squad_code` was the shared secret that handed out those keys. Mates join with
--     `invite_code` now, which only lets someone add their own proven HQ session.
-- Delete the `ingest` edge function in the Supabase dashboard as well; nothing calls it.
alter table public.players drop column if exists ingest_key;
delete from public.app_settings where key = 'squad_code';
