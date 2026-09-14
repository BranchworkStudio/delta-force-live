-- What the person running the tracker can see that nobody else can.
--
-- Everything here already existed; it just had no home outside a psql prompt. Who is enrolled and
-- what let them in, which links are still open, whether anybody's collection has quietly stopped —
-- the README answered all three with a SQL snippet to paste, which means they were only ever
-- checked when something had already gone wrong. This is the same three questions as three views,
-- so the Admin tab can ask them every thirty seconds like everything else on the board.
--
-- The gate is `public.is_admin()` from 0022 and nothing else. A view is not a secret: hiding the
-- tab in the front-end hides a button, and a button is not a boundary — so each view carries the
-- predicate itself and a signed-in stranger reading `/rest/v1/admin_players` directly gets an
-- empty list, exactly as they get an empty board.
--
-- 0019's trap applies with full force here: these are `security_invoker = false`, which BYPASSES
-- the row-level security on the tables underneath. That is what lets them cross board boundaries —
-- an admin needs to see the solo player they are not on a board with — and it is also what makes
-- the missing `where public.is_admin()` catastrophic rather than merely wrong. Every view below
-- ends with it. A view added later must too.
--
-- Two things are deliberately not here. `player_sessions.cookies` is somebody's live HQ login and
-- `control_key` is the authority to disconnect them: the admin runs the backend, which is not the
-- same as being able to act as everybody on it. The failure text is exposed, because "what broke"
-- is the whole question; the credential that broke is not part of the answer.
--
-- To undo: drop view public.admin_invites, public.admin_players, public.admin_sessions;
--          drop function public.admin_revoke_invite(text), public.admin_cap_invite(text, integer);

-- ---------------------------------------------------------------------------------------------
-- Every way in that has ever been made, spent or not.
create or replace view public.admin_invites
with (security_invoker = false) as
  select i.code, i.kind, i.label, i.created_at, i.created_by,
         m.nickname as created_by_name,
         i.group_id, g.name as group_name,
         i.uses, i.max_uses, i.last_used_at, i.revoked_at,
         (i.revoked_at is not null) as revoked,
         (i.max_uses is not null and i.uses >= i.max_uses) as spent
  from public.invites i
  left join public.players m on m.openid = i.created_by
  left join public.groups g on g.id = i.group_id
  where public.is_admin();

-- Everybody on the tracker, including the ones no board of mine can see. `boards` is aggregated
-- here rather than joined in the page, because group_members is narrowed to the caller's own
-- boards by RLS and a solo player would otherwise show up as belonging to nothing by accident
-- rather than by fact.
create or replace view public.admin_players
with (security_invoker = false) as
  select p.openid, p.nickname, p.level, p.avatar, p.is_admin, p.on_squad,
         p.enrolled_via, p.enrolled_at, p.created_at,
         p.token_ok, p.token_seen_since, p.last_poll_at,
         coalesce((select count(*) from public.group_members gm where gm.openid = p.openid), 0) as board_count,
         (select string_agg(g.name, ', ' order by g.name)
            from public.group_members gm join public.groups g on g.id = gm.group_id
           where gm.openid = p.openid) as boards
  from public.players p
  where public.is_admin();

-- Is it actually collecting. `has_error` was all the board ever needed; running the thing means
-- needing to know what the error said.
create or replace view public.admin_sessions
with (security_invoker = false) as
  select s.openid, s.source, s.connected_at, s.updated_at, s.last_ok_at, s.last_error, s.backfill
  from public.player_sessions s
  where public.is_admin();

revoke all on public.admin_invites, public.admin_players, public.admin_sessions from anon, public;
grant select on public.admin_invites, public.admin_players, public.admin_sessions to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Closing a link, and capping one that was made before there were caps.
--
-- Minting stays where it is — in the connect function, behind the browser's control key — because
-- making an account is the one thing that costs money and it is proved against the session that
-- asked. Withdrawing one costs nothing and breaks nothing, so it is an ordinary RPC like
-- rotate_group_code: same shape, same authority question, asked of `is_admin()` instead of an owner.
create or replace function public.admin_revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only the owner of this tracker may withdraw an invite'; end if;
  update public.invites set revoked_at = now() where code = p_code and revoked_at is null;
end $$;

-- A cap can be tightened or lifted, never quietly emptied: null is no limit and anything below the
-- uses already spent would be a link that refuses without anyone having done anything wrong.
create or replace function public.admin_cap_invite(p_code text, p_max integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only the owner of this tracker may change an invite'; end if;
  if p_max is not null and p_max < 1 then raise exception 'a limit below one is a withdrawal, not a limit'; end if;
  update public.invites set max_uses = p_max where code = p_code;
end $$;

comment on function public.admin_revoke_invite(text) is 'Withdraw one invite link. Admin only; already-revoked rows are left alone.';
comment on function public.admin_cap_invite(text, integer) is 'Set or lift the use limit on one invite link. Null is unlimited. Admin only.';

revoke execute on function public.admin_revoke_invite(text), public.admin_cap_invite(text, integer) from anon, public;
grant execute on function public.admin_revoke_invite(text), public.admin_cap_invite(text, integer) to authenticated;
