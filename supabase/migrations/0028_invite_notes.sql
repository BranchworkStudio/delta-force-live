-- A line of your own on each invite link: where it was sent.
--
-- Going public means links that go to places rather than to people — a Reddit post, a Discord
-- server, a streamer's chat — and the question afterwards is which of them the accounts actually
-- came through. `uses` already counts the accounts per link and `players.enrolled_via` already
-- records the link each account arrived on; what was missing is the link's name for itself. The
-- code is a random hex string, and "3f9a1c02…" answers nothing.
--
-- It is a column of its own rather than `label`. `label` is written by the connect function
-- ("board link from …") and 0022 matches one row on its exact text, so it belongs to the machine;
-- `note` belongs to the admin and is never written by anything else.
--
-- Set by an RPC rather than at minting, for two reasons: the links made before today want notes
-- too, and a note is the kind of thing you fix afterwards. It also keeps the connect function —
-- the one route that creates accounts — exactly as it was.
--
-- To undo: drop function public.admin_note_invite(text, text);
--          (recreate admin_invites from 0026 without the column, then)
--          alter table public.invites drop column note;

alter table public.invites add column if not exists note text
  check (note is null or char_length(note) <= 80);

-- Same view as 0026 with the note on the end. `create or replace view` may only add columns
-- after the existing ones, which is where it goes. The admin predicate is repeated because this
-- view bypasses RLS: see 0026.
create or replace view public.admin_invites
with (security_invoker = false) as
  select i.code, i.kind, i.label, i.created_at, i.created_by,
         m.nickname as created_by_name,
         i.group_id, g.name as group_name,
         i.uses, i.max_uses, i.last_used_at, i.revoked_at,
         (i.revoked_at is not null) as revoked,
         (i.max_uses is not null and i.uses >= i.max_uses) as spent,
         i.note
  from public.invites i
  left join public.players m on m.openid = i.created_by
  left join public.groups g on g.id = i.group_id
  where public.is_admin();

-- Blank clears it. Trimmed, so a stray space is not a note.
create or replace function public.admin_note_invite(p_code text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only the owner of this tracker may label an invite'; end if;
  if char_length(btrim(coalesce(p_note, ''))) > 80 then raise exception 'a note is at most 80 characters'; end if;
  update public.invites set note = nullif(btrim(coalesce(p_note, '')), '') where code = p_code;
end $$;

comment on function public.admin_note_invite(text, text) is 'Set or clear the admin''s note on one invite link (where it was sent). Admin only.';

revoke execute on function public.admin_note_invite(text, text) from anon, public;
grant execute on function public.admin_note_invite(text, text) to authenticated;
