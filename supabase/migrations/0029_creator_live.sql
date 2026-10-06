-- Which loadout creators are live on Twitch or YouTube. The `live` function fills the one row every
-- three minutes and serves it to the site over GET; the publishable key still reads nothing (0021),
-- so this table has no grant and no policy, only the service role touches it.
--   live: { "<creator id>": [{ platform, url, title, since }] } -- only creators who are live
create table if not exists public.creator_live (
  id smallint primary key default 1 check (id = 1),
  live jsonb not null default '{}'::jsonb,
  checked_at timestamptz
);
alter table public.creator_live enable row level security;
revoke all on public.creator_live from anon, authenticated;

-- Same secret as the match poller (0007), read at run time so it is not stored in the job.
select cron.unschedule('df-creator-live') where exists (select 1 from cron.job where jobname = 'df-creator-live');
select cron.schedule('df-creator-live', '*/3 * * * *', $job$
  select net.http_post(
    url := 'https://faaskhwycywnwpdjcvgp.supabase.co/functions/v1/live',
    body := (select jsonb_build_object('secret', value) from public.app_settings where key = 'poll_secret'),
    timeout_milliseconds := 30000
  );
$job$);
