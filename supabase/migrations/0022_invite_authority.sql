-- Two authorities, and they were the same one by accident.
--
-- Until now anybody who had connected could hand out a way in: their own tracker link, or the code
-- of a board they happened to be on. Worse, a board code *enrolled* — `resolveCode` accepted it
-- from a browser with no account at all — so forwarding six characters created a player on a
-- backend somebody else pays for. Two of the four accounts here arrived that way.
--
-- They are separated here, because they are genuinely different questions:
--
--   the tracker — who gets an account and gets polled at all. One authority: `players.is_admin`.
--                 Only an admin mints a link that enrols, and every enrolled player traces back to
--                 a row in `invites` with a name on it.
--   a board     — who sees whose matches. The board's owner. Anybody in the tracker may make a
--                 board and own it, hand out its code, change it, and put somebody out.
--
-- So mates still squad up among themselves without asking anyone: a code admits a player who is
-- already here. It no longer conjures one.
--
-- To undo: alter table public.players drop column is_admin, and restore the members-read-the-code
-- policy from 0018 (groups_readable_by_members). The revoke at the foot is a data change and comes
-- back with: update public.invites set revoked_at = null where label = 'the original shared code';

-- ---------------------------------------------------------------------------------------------
-- Who owns the backend. Not a role and not a group: an account that may open the front door.
alter table public.players add column if not exists is_admin boolean not null default false;

-- The account that claimed the empty board, which is the one paying for it. `enrolled_via` is null
-- for a player who was here before invites existed and 'first' for the hand-over that claims a
-- fresh deployment — the same test 0017 used to decide who owned the first group.
update public.players set is_admin = true
where enrolled_via is null or enrolled_via = 'first';

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.players p where p.openid = public.my_openid()), false)
$$;

-- Definer, like every helper a policy leans on, so a member checking their own board does not need
-- to read the membership table through the policy that is asking the question.
create or replace function public.owns_group(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group and m.openid = public.my_openid() and m.role = 'owner'
  )
$$;

comment on function public.is_admin() is
  'Whether the caller may bring a new player into the tracker. One account, normally the one paying the bill.';
comment on function public.owns_group(uuid) is
  'Whether the caller owns that board: may hand out its code, change it, and remove a member.';

revoke execute on function public.is_admin(), public.owns_group(uuid) from anon, public;
grant execute on function public.is_admin(), public.owns_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The code belongs to the owner now, not to everyone standing in the room.
--
-- 0018 gave every member the code on the grounds that the people inside are the people who hand it
-- out. That was true of one board with two mates on it and stops being true the moment a board can
-- be forwarded. Members still read `public_groups` — name, size, no code — which is all the site
-- needs to draw the switcher; the code appears only for somebody who may answer for who arrives.
drop policy if exists groups_readable_by_members on public.groups;
drop policy if exists groups_readable_by_owners on public.groups;
create policy groups_readable_by_owners on public.groups
  for select to authenticated
  using (public.owns_group(groups.id));

-- A code that has gone further than you meant it to is fixed by replacing it. Every link already
-- sent carrying the old one stops working, which is the point, so the site asks twice.
create or replace function public.rotate_group_code(p_group uuid) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.owns_group(p_group) then raise exception 'only the owner of a board can change its code'; end if;
  loop
    c := public.new_group_code();
    exit when not exists (select 1 from public.groups g where g.code = c);
  end loop;
  update public.groups set code = c where id = p_group;
  return c;
end $$;

-- Putting somebody out. The mirror of `leave_group`, and the thing that was missing: a board could
-- be joined and left but never corrected.
create or replace function public.remove_group_member(p_group uuid, p_openid text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_openid();
begin
  if not public.owns_group(p_group) then raise exception 'only the owner of a board can remove somebody from it'; end if;
  if p_openid = me then raise exception 'leave the board instead — it goes with its last member'; end if;
  if exists (select 1 from public.group_members m
             where m.group_id = p_group and m.openid = p_openid and m.role = 'owner')
    then raise exception 'an owner cannot be removed from their own board'; end if;
  delete from public.group_members where group_id = p_group and openid = p_openid;
end $$;

revoke execute on function public.rotate_group_code(uuid), public.remove_group_member(uuid, text) from anon, public;
grant execute on function public.rotate_group_code(uuid), public.remove_group_member(uuid, text) to authenticated;

-- A board whose owner walks out is a board nobody can ever hand out or correct again, now that
-- those are an owner's to do. So the board goes with them only if they are the last one on it;
-- otherwise it is handed to whoever has been there longest. Replaces 0017's version.
create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_openid(); was_owner boolean;
begin
  if me is null then raise exception 'not signed in'; end if;
  select (role = 'owner') into was_owner from public.group_members
  where group_id = p_group and openid = me;

  delete from public.group_members where group_id = p_group and openid = me;
  delete from public.groups g where g.id = p_group
    and not exists (select 1 from public.group_members m where m.group_id = g.id);

  if coalesce(was_owner, false) then
    update public.group_members set role = 'owner'
    where group_id = p_group and openid = (
      select openid from public.group_members where group_id = p_group
      order by joined_at limit 1
    );
  end if;
end $$;
revoke execute on function public.leave_group(uuid) from anon, public;
grant execute on function public.leave_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The site asks "may I offer the front door", so the answer has to reach it. Appended, because
-- create-or-replace cannot insert a column into the middle of a view — and the predicate from 0019
-- comes with it, since a definer view carries the whole boundary itself.
create or replace view public.public_players
with (security_invoker = false) as
  select openid, nickname, avatar, level, token_ok, last_poll_at, created_at, token_seen_since,
         on_squad, is_admin
  from public.players
  where public.shares_group(openid);

-- ---------------------------------------------------------------------------------------------
-- The one code that predates all of this: migrated out of app_settings by 0015, author unknown
-- because there was nobody to record, four uses, still live. It is the shared secret this whole
-- design replaced, so it stops being a way in.
update public.invites set revoked_at = now()
where label = 'the original shared code' and revoked_at is null;
