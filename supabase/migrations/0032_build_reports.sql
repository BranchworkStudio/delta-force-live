-- "This code doesn't work": a visitor on loadouts/ telling the person running the site that a build
-- needs a look. The loadouts page is the one part of the site anybody may open, so the reporter has
-- no account and the publishable key still writes nothing (0021): reports arrive through the
-- `report` edge function, which checks the code is on the list, takes creator/weapon/mode from the
-- list rather than the request, and keeps one report per browser per build a day.
--   visitor  a random id the browser made for itself, so one person clicking twice is one report
--   ip_hash  sha256 of the address salted with poll_secret, only to rate-limit; the address itself is not kept
create table if not exists public.build_reports (
  id bigint generated always as identity primary key,
  code text not null,
  creator text,
  weapon text,
  mode text,
  reason text not null check (reason in ('import', 'outdated', 'other')),
  note text check (char_length(note) <= 300),
  visitor text,
  ip_hash text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists build_reports_open on public.build_reports (code) where resolved_at is null;
create index if not exists build_reports_recent on public.build_reports (ip_hash, created_at);
alter table public.build_reports enable row level security;
revoke all on public.build_reports from anon, authenticated;

-- One row per build with something open against it, for the Admin tab. Same rule as 0026: a definer
-- view bypasses RLS, so it carries `where public.is_admin()` itself.
create or replace view public.admin_build_reports
with (security_invoker = false) as
  select r.code,
         max(r.creator) as creator, max(r.weapon) as weapon, max(r.mode) as mode,
         count(*)::int as reports,
         (count(*) filter (where r.reason = 'import'))::int as wont_import,
         (count(*) filter (where r.reason = 'outdated'))::int as outdated,
         (count(*) filter (where r.reason = 'other'))::int as other,
         min(r.created_at) as first_at, max(r.created_at) as last_at,
         (array_agg(r.note order by r.created_at desc) filter (where r.note is not null))[1:5] as notes
  from public.build_reports r
  where r.resolved_at is null and public.is_admin()
  group by r.code;
revoke all on public.admin_build_reports from anon;
grant select on public.admin_build_reports to authenticated;

-- Looked at it: close everything open against that code. A later report opens it again.
create or replace function public.admin_resolve_build_reports(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'only the owner of this tracker may close a report'; end if;
  update public.build_reports set resolved_at = now() where code = p_code and resolved_at is null;
end $$;
comment on function public.admin_resolve_build_reports(text) is 'Mark every open report on one build code as dealt with. Admin only.';
revoke execute on function public.admin_resolve_build_reports(text) from anon, public;
grant execute on function public.admin_resolve_build_reports(text) to authenticated;
