-- Finish the job 0019 started: the publishable key now reads nothing at all.
--
-- 0019 left the SELECT grants in place so a signed-out visitor would get an empty list instead of
-- an error, and leaned on "no policy applies" to keep the rows back. That works, but it means every
-- future table is one `using (true)` away from being public again, and it kept `anon` holding
-- EXECUTE on the boundary helpers (a definer function reachable from /rest/v1/rpc without signing
-- in) purely so the definer views could evaluate their own predicate for a caller who may see
-- nothing anyway.
--
-- So the grants go. `anon` can now read exactly one thing in this schema: nothing. The site treats
-- a 401 on the publishable key as "locked" and shows the private-board page, which is what it
-- means -- there is no state in which the board wants to render half of itself.
--
-- To undo (the boundary is a decision, not a one-way door):
--   grant select on public.matches, public.match_details, public.red_drops, public.rank_samples,
--     public.carry_out_week, public.red_collection, public.red_collection_summary, public.site_data,
--     public.group_members, public.public_players, public.public_sessions, public.public_groups,
--     public.player_rank, public.match_latency, public.match_members to anon;
--   grant execute on function public.in_group(uuid), public.shares_group(text) to anon;
-- and re-add a policy naming `anon` on whichever tables should be readable again.

revoke select on
  public.matches, public.match_details, public.red_drops, public.rank_samples,
  public.carry_out_week, public.red_collection, public.red_collection_summary,
  public.site_data, public.group_members, public.player_stats,
  public.public_players, public.public_sessions, public.public_groups,
  public.player_rank, public.match_latency, public.match_members
from anon;
