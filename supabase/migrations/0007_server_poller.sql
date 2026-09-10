-- The backend polls HQ itself, so matches keep arriving with the player's PC off.
-- Also drops the squad code from the connect path: a handed-over session is proved against HQ,
-- which is stronger authentication than a shared secret, so only enrolment needs a gate.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Details that could never be fetched must not be retried forever.
alter table public.matches add column if not exists detail_tries smallint not null default 0;

-- How far back the poller has walked this player's history, per report type (plus "red" for drops).
alter table public.player_sessions add column if not exists backfill jsonb not null default '{}'::jsonb;

-- The poller's work queue: matches with no detail row yet, newest first, giving up after 3 tries.
create or replace view public.pending_details as
  select m.openid, m.report_type, m.room_id, m.match_time, m.detail_tries
  from public.matches m
  left join public.match_details d
    on d.openid = m.openid and d.report_type = m.report_type and d.room_id = m.room_id
  where d.room_id is null and m.detail_tries < 3;

revoke all on public.pending_details from anon, authenticated;

-- Returned to the browser that handed the session over, so that browser (and only it) can disconnect again.
alter table public.player_sessions add column if not exists control_key text;

-- Shared secret between pg_cron and the `poll` function (it has no JWT to check).
insert into public.app_settings (key, value)
values ('poll_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Every minute. The secret is read from app_settings at run time, so it is not stored in the job.
select cron.unschedule('df-live-poll') where exists (select 1 from cron.job where jobname = 'df-live-poll');
select cron.schedule('df-live-poll', '* * * * *', $job$
  select net.http_post(
    url := 'https://faaskhwycywnwpdjcvgp.supabase.co/functions/v1/poll',
    body := (select jsonb_build_object('secret', value) from public.app_settings where key = 'poll_secret'),
    timeout_milliseconds := 55000
  );
$job$);
