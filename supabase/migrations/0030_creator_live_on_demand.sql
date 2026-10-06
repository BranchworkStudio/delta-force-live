-- The live check runs when a page asks (the `live` function's GET), not on a timer: 0029's
-- three-minute job goes. creator_live stays as the function's two-minute cache.
select cron.unschedule('df-creator-live') where exists (select 1 from cron.job where jobname = 'df-creator-live');
