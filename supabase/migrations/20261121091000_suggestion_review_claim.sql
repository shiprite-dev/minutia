alter table public.meeting_ai_suggestions
  drop constraint if exists meeting_ai_suggestions_status_check;
alter table public.meeting_ai_suggestions
  add constraint meeting_ai_suggestions_status_check
  check (status in ('pending', 'reviewing', 'accepted', 'rejected'));

alter table public.meeting_ai_suggestions
  add column if not exists reviewing_at timestamptz;

create or replace function public.user_manages_suggestion_series(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.meeting_series
     where id = p_series_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.series_participants
     where series_id = p_series_id
       and user_id = auth.uid()
       and role in ('owner', 'facilitator')
  );
$$;

-- One statement so two concurrent keeps cannot both win; self-host PostgREST ignores or=() on UPDATE.
-- A claim older than 2 minutes belongs to a save that died, so it can be taken over.
create or replace function public.claim_ai_suggestion(p_suggestion_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  update public.meeting_ai_suggestions
     set status = 'reviewing',
         reviewing_at = now()
   where id = p_suggestion_id
     and (
       status = 'pending'
       or (status = 'reviewing' and reviewing_at < now() - interval '2 minutes')
     )
     and public.user_manages_suggestion_series(series_id)
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

create or replace function public.release_ai_suggestion(p_suggestion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meeting_ai_suggestions
     set status = 'pending',
         reviewing_at = null
   where id = p_suggestion_id
     and status = 'reviewing'
     and public.user_manages_suggestion_series(series_id);
end;
$$;

revoke all on function public.user_manages_suggestion_series(uuid) from public, anon;
revoke all on function public.claim_ai_suggestion(uuid) from public, anon;
revoke all on function public.release_ai_suggestion(uuid) from public, anon;
grant execute on function public.user_manages_suggestion_series(uuid) to authenticated;
grant execute on function public.claim_ai_suggestion(uuid) to authenticated;
grant execute on function public.release_ai_suggestion(uuid) to authenticated;
