-- pg_cron logs every run in cron.job_run_details and never clears it. The every-minute poller
-- alone adds ~1,440 rows a day (37k by 6 Oct, back to 10 Sep). Keep a week, enough to look back
-- at a bad night, and clear the rest once a day.
select cron.unschedule('df-cron-history-cleanup') where exists (select 1 from cron.job where jobname = 'df-cron-history-cleanup');
select cron.schedule('df-cron-history-cleanup', '17 3 * * *', $job$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
$job$);
