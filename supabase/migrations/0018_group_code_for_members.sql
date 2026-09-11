-- A group's own members may read it, code and all.
--
-- The code was locked away because anyone holding one can walk in, but the people already inside
-- are exactly the people who hand it out — asking a function for the code of a group you are
-- standing in is ceremony with no gain. Members read their own row; everyone else still reads
-- `public_groups`, which has names and sizes and no codes at all.
--
-- This is the first policy written against `my_openid()`, and it is the shape the rest will take in
-- the step after this one: a claim that is already in the JWT, so no lookup, so no recursion.
grant select on public.groups to authenticated;

drop policy if exists groups_readable_by_members on public.groups;
create policy groups_readable_by_members on public.groups
  for select to authenticated
  using (exists (select 1 from public.group_members m where m.group_id = groups.id and m.openid = public.my_openid()));
