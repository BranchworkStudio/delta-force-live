-- The detail was fetched, and then half of it was thrown away.
--
-- `storeDetails` has always stored the whole detail payload in `match_details.raw`, but it only
-- started copying the interesting fields out of it — the operator/AI kill split, the player's own
-- finish time, the match duration — when those columns were added to `matches`. Details fetched
-- before that kept their raw and got nothing copied across, so two matches have sat with a null
-- kill split ever since while the real numbers were in the database the whole time.
--
-- A null split reads as zero operator kills everywhere it is summed, which is what made the board
-- disagree with HQ's own Current Combat Status.
--
-- This fills a field only where it is null, so it can be run again without effect and can never
-- overwrite something the poller wrote. It is the same arithmetic `storeDetails` does, in SQL:
-- find the caller's own row inside the stored members array and take the numbers from it.
--
-- To undo: there is nothing to undo — every value written here came out of `match_details.raw`,
-- which is untouched. Setting the four columns back to null would restore the bug, not the data.

with self_row as (
  select d.openid, d.report_type, d.room_id,
         d.raw->'match_duration' as dur,
         (select x
            from jsonb_array_elements(coalesce(d.raw->'members', '[]'::jsonb)) x
           where (x->'is_self')::text in ('true', '1', '"1"')
           limit 1) as me
  from public.match_details d
)
update public.matches m
   set kill_operator     = coalesce(m.kill_operator, (s.me->>'kill_operator')::int),
       kill_other        = coalesce(m.kill_other,    (s.me->>'kill_other')::int),
       -- HQ states finish_time in seconds, like every other time it sends.
       finished_at       = coalesce(m.finished_at,
                             case when (s.me->>'finish_time') ~ '^[0-9]+$' and (s.me->>'finish_time')::bigint > 0
                                  then to_timestamp((s.me->>'finish_time')::bigint) end),
       match_duration_min = coalesce(m.match_duration_min,
                             case when jsonb_typeof(s.dur) = 'number' then (s.dur)::text::numeric end)
  from self_row s
 where s.openid = m.openid and s.report_type = m.report_type and s.room_id = m.room_id
   and s.me is not null
   and (m.kill_operator is null or m.kill_other is null
        or m.finished_at is null or m.match_duration_min is null);
