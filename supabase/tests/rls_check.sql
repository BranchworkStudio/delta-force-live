-- The read boundary, checked. Run it after every migration (MCP execute_sql, or psql); it changes
-- nothing and raises an exception naming every table or view that shows a row it should not.
--
-- It walks whatever `authenticated` may select in `public`, so a view added later is checked
-- without editing this file:
--   1. a signed-in token with no player behind it reads nothing at all;
--   2. a real non-admin player reads only rows of their own squad (themselves and anyone on a
--      board with them, worked out here from group_members, not by asking my_squad()), and no
--      admin_* rows.
do $$
declare
  subject text; squad text[]; r record; n bigint; leaks text[] := '{}';
begin
  -- 2's subject, picked while still the owner: a non-admin who has somebody outside their squad,
  -- so a leak would have rows to show.
  select p.openid into subject from public.players p
  where not p.is_admin and exists (
    select 1 from public.players o where o.openid <> p.openid and not exists (
      select 1 from public.group_members a join public.group_members b using (group_id)
      where a.openid = p.openid and b.openid = o.openid))
  order by p.openid limit 1;
  select coalesce(array_agg(distinct b.openid), '{}') || subject into squad
  from public.group_members a join public.group_members b using (group_id) where a.openid = subject;

  -- 1. nobody
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  execute 'set local role authenticated';
  for r in select distinct table_name from information_schema.role_table_grants
           where grantee = 'authenticated' and privilege_type = 'SELECT' and table_schema = 'public' loop
    execute format('select count(*) from public.%I', r.table_name) into n;
    if n > 0 then leaks := leaks || format('%s: %s rows to a token with no player', r.table_name, n); end if;
  end loop;
  execute 'reset role';

  -- 2. a player
  if subject is null then
    raise notice 'no non-admin player with an outsider: squad scoping not checked';
  else
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'app_metadata', json_build_object('openid', subject))::text, true);
    execute 'set local role authenticated';
    for r in select distinct g.table_name,
               exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                       and c.table_name = g.table_name and c.column_name = 'openid') as keyed
             from information_schema.role_table_grants g
             where g.grantee = 'authenticated' and g.privilege_type = 'SELECT' and g.table_schema = 'public' loop
      if r.table_name like 'admin\_%' then
        execute format('select count(*) from public.%I', r.table_name) into n;
      elsif r.keyed then
        execute format('select count(*) from public.%I where openid <> all($1)', r.table_name) into n using squad;
      else
        continue;
      end if;
      if n > 0 then leaks := leaks || format('%s: %s rows outside the squad', r.table_name, n); end if;
    end loop;
    execute 'reset role';
  end if;

  if cardinality(leaks) > 0 then raise exception 'read boundary broken: %', array_to_string(leaks, '; '); end if;
end $$;
select 'read boundary holds' as rls_check;
