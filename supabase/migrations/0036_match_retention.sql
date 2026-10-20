-- Keep 30 days of matches, the board's widest range, so storage grows with players and not with
-- time. match_details goes with them (on delete cascade). The poller no longer stores anything
-- older, so this only ever trims the day that just aged out.
select cron.unschedule('df-match-retention') where exists (select 1 from cron.job where jobname = 'df-match-retention');
select cron.schedule('df-match-retention', '27 3 * * *', $job$
  delete from public.matches where match_time < now() - interval '30 days';
$job$);
