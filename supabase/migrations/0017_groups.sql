-- Groups: a board per group of mates, instead of one board and a boolean.
--
-- `on_squad` could only ever answer one question — are you on *the* board — which is the wrong
-- question the moment there is more than one set of mates. A group replaces it, and "solo" stops
-- being a special case: a solo player is a player who is in no group, and their board is themselves.
--
-- A group is joined by its code, and the code is the thing worth protecting: anyone holding it can
-- walk in. So `groups` is service-role only, `public_groups` shows names without codes, and joining
-- goes through a function that takes a code and never hands one back. Nobody needs to read the
-- table they are trying to join.
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_by text references public.players(openid) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  openid text not null references public.players(openid) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, openid)
);
create index if not exists group_members_by_player on public.group_members (openid);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
revoke all on public.groups from anon, authenticated;              -- the codes live here

-- Membership itself is not a secret on a board that is already public, and the site needs it to
-- know whose rows to draw. Read-only: joining and leaving go through the functions below.
grant select on public.group_members to anon, authenticated;
create policy group_members_readable on public.group_members for select to anon, authenticated using (true);

-- Names and sizes, with the codes left behind.
create or replace view public.public_groups
with (security_invoker = false) as
  select g.id, g.name, g.created_by, g.created_at, count(m.openid) as members
  from public.groups g left join public.group_members m on m.group_id = g.id
  group by g.id, g.name, g.created_by, g.created_at;
grant select on public.public_groups to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Who is asking. The openid rides in the JWT that `connect` mints from the HQ hand-over, so this
-- needs no lookup — and therefore cannot recurse into the policies that will use it.
create or replace function public.my_openid() returns text
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'openid', '')
$$;
grant execute on function public.my_openid() to anon, authenticated;

-- Codes are read aloud as often as they are clicked, so the alphabet leaves out the characters
-- people mix up: no O or 0, no I or 1.
create or replace function public.new_group_code() returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6)
$$;

-- Making a group. The caller becomes its owner, which is how they get a code to hand out.
create or replace function public.create_group(p_name text)
returns table (id uuid, name text, code text)
language plpgsql security definer set search_path = public as $$
declare me text := public.my_openid(); gid uuid; c text;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.players p where p.openid = me) then raise exception 'no such player'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'a group needs a name'; end if;

  -- Unique is enforced by the index; this only saves the caller from an error on a collision.
  loop
    c := public.new_group_code();
    exit when not exists (select 1 from public.groups g where g.code = c);
  end loop;

  insert into public.groups (name, code, created_by) values (left(btrim(p_name), 48), c, me) returning groups.id into gid;
  insert into public.group_members (group_id, openid, role) values (gid, me, 'owner');
  return query select gid, left(btrim(p_name), 48), c;
end $$;
revoke all on function public.create_group(text) from anon, public;
grant execute on function public.create_group(text) to authenticated;

-- Joining by code. Definer, because a player who is not in a group yet cannot read `groups` — and
-- should not have to: they send the code they were given and get back the name of what they joined.
create or replace function public.join_group_by_code(p_code text)
returns table (id uuid, name text)
language plpgsql security definer set search_path = public as $$
declare me text := public.my_openid(); g record;
begin
  if me is null then raise exception 'not signed in'; end if;
  -- Equality on the upper-cased input, never a pattern match: `like` on a caller's string would let
  -- `%` match every group there is.
  select groups.id, groups.name into g from public.groups where groups.code = upper(btrim(p_code));
  if g.id is null then raise exception 'no group has that code'; end if;

  insert into public.group_members (group_id, openid) values (g.id, me) on conflict do nothing;
  return query select g.id, g.name;
end $$;
revoke all on function public.join_group_by_code(text) from anon, public;
grant execute on function public.join_group_by_code(text) to authenticated;

-- Leaving. A group nobody is left in is no longer anybody's board, so it goes with its last member.
create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_openid();
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from public.group_members where group_id = p_group and openid = me;
  delete from public.groups g where g.id = p_group and not exists (select 1 from public.group_members m where m.group_id = g.id);
end $$;
revoke all on function public.leave_group(uuid) from anon, public;
grant execute on function public.leave_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The board that exists today becomes the first group, with everyone on it in it. `on_squad` stays
-- for one more release so a browser still running the old script keeps working; groups are what the
-- site reads from here on.
do $$
declare gid uuid;
begin
  if not exists (select 1 from public.groups) and exists (select 1 from public.players where on_squad) then
    insert into public.groups (name, code, created_by)
    values ('The squad', public.new_group_code(),
            (select openid from public.players where enrolled_via is null or enrolled_via = 'first' order by created_at limit 1))
    returning id into gid;
    insert into public.group_members (group_id, openid, role)
    select gid, openid,
           case when enrolled_via is null or enrolled_via = 'first' then 'owner' else 'member' end
    from public.players where on_squad
    on conflict do nothing;
  end if;
end $$;

-- An invite now says which group it lets you into. Null means the tracker on its own, which is what
-- the 'solo' kind meant; the kind is kept because it is what the account panel asks for.
alter table public.invites add column if not exists group_id uuid references public.groups(id) on delete cascade;
update public.invites i set group_id = (select id from public.groups order by created_at limit 1)
where i.kind = 'squad' and i.group_id is null and i.revoked_at is null;
