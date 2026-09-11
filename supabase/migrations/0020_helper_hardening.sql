-- Housekeeping on the functions the new boundary leans on.
--
-- `my_openid()` is read by every policy in 0019, so it is the one function in this schema that
-- must not be resolvable through a caller's search_path. `new_group_code()` mints the code a
-- board is shared by. Both get an empty search_path; everything they use is either fully
-- qualified or lives in pg_catalog, which is always searched.
create or replace function public.my_openid() returns text
language sql stable set search_path = '' as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'openid', '')
$$;

create or replace function public.new_group_code() returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6)
$$;

-- The boundary helpers are definer, and `anon` has no policy that evaluates them and no view it
-- reaches them through (the views are definer, so they run as the owner). Nothing needs anon to
-- hold EXECUTE, and a definer function callable straight off /rest/v1/rpc without signing in is
-- surface for no gain. They stay callable by a signed-in player, who can only ask about themselves.
-- PUBLIC holds EXECUTE on a new function by default, so revoking `anon` alone changes nothing:
-- anon inherits it from PUBLIC. Take it from both, then hand it back to signed-in players only.
revoke execute on function public.in_group(uuid), public.shares_group(text) from anon, public;
grant execute on function public.in_group(uuid), public.shares_group(text) to authenticated;
