-- Nothing asks shares_group() any more: since 0038 every policy and public view asks
-- `openid in (select public.my_squad())`, the same set computed once per query. Left in place it
-- is a slow per-row check waiting to be copied into the next policy.
drop function public.shares_group(text);
