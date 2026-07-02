-- Drag-to-reorder issues within a series: reorder_issues persists the new
-- manual order into the existing (but previously untyped/unused) issues.sort_order
-- column. SECURITY DEFINER mirrors assign_issue (auth check inside the function
-- body, not RLS) and sidesteps self-host PostgREST v12's broken .or()/.and() on
-- UPDATE by taking the ordered id array as a single RPC argument instead of a
-- client-side batched PATCH.
-- No backfill: rows that have never been dragged keep sort_order 0 and the
-- client comparator (byManualOrder) falls back to priority then recency, so the
-- board's priority ordering is preserved until a user deliberately reorders.
-- A drag then assigns positive positions (1..N) that sort above the untouched 0s.

create or replace function public.reorder_issues(p_series_id uuid, p_ordered_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.user_can_access_series(p_series_id) then
    raise exception 'reorder_issues: not authorized' using errcode = '42501';
  end if;
  update public.issues i
     set sort_order = ord.pos
    from unnest(p_ordered_ids) with ordinality as ord(id, pos)
   where i.id = ord.id
     and i.series_id = p_series_id;
end $$;

revoke all on function public.reorder_issues(uuid, uuid[]) from public;
grant execute on function public.reorder_issues(uuid, uuid[]) to authenticated, service_role;
