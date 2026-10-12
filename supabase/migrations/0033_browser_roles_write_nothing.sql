-- The browser roles write nothing directly. Every write the site makes goes through a definer RPC or
-- an edge function on the service role, so no table or view in this schema needs a write grant for
-- `anon` or `authenticated`.
--
-- Why this matters more than it looks: Supabase grants ALL on every new relation to both roles by
-- default, and 0021 only took SELECT back. Single-table views such as public_players are
-- auto-updatable, run as their owner (who bypasses RLS), and have no CHECK OPTION, so the old grants
-- let anyone holding the publishable key INSERT a players row with is_admin = true and then
-- enrol through connect as an "existing" player. Signed-in players could also DELETE a board mate
-- through the same views. RLS never saw any of it.
--
-- The default-privileges change keeps future tables and views from arriving with the same grants.
-- 0024's two event tables also picked up SELECT for anon after 0021; RLS held, but the boundary is
-- "anon reads nothing", so that goes too.

do $$
declare r record;
begin
  for r in select c.relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated, public', r.relname);
  end loop;
end $$;

revoke select on public.event_collection, public.event_collection_summary from anon;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;
