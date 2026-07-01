-- First-class member assignment: assign_issue sets issues.owner_user_id (not
-- just the free-text owner_name) so assignment notifications and My Actions
-- work for real teammates. SECURITY DEFINER because it must insert the new
-- owner into series_participants BEFORE the issues update, so
-- notify_issue_assigned() (which only notifies participants) actually fires.
-- p_owner_user_id null means unassigned or a free-text owner_name.

create or replace function public.assign_issue(p_issue_id uuid, p_owner_user_id uuid, p_owner_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_series_id uuid; v_org_id uuid;
begin
  select series_id into v_series_id from public.issues where id = p_issue_id;
  if v_series_id is null then
    raise exception 'assign_issue: issue not found' using errcode = 'P0002';
  end if;

  if not public.user_can_access_series(v_series_id) then
    raise exception 'assign_issue: not authorized' using errcode = '42501';
  end if;

  if p_owner_user_id is not null then
    select organization_id into v_org_id from public.meeting_series where id = v_series_id;

    if v_org_id is not null then
      if not exists (
        select 1 from public.organization_members
        where organization_id = v_org_id and user_id = p_owner_user_id
      ) then
        raise exception 'assign_issue: user is not a workspace member' using errcode = '42501';
      end if;
    else
      if not exists (select 1 from public.profiles where id = p_owner_user_id) then
        raise exception 'assign_issue: user not found' using errcode = 'P0002';
      end if;
    end if;

    -- Must happen before the issues update below, so the AFTER UPDATE
    -- notify_issue_assigned() trigger finds the new owner as a participant.
    insert into public.series_participants (series_id, user_id, role)
      values (v_series_id, p_owner_user_id, 'participant')
      on conflict (series_id, user_id) do nothing;
  end if;

  update public.issues
    set owner_user_id = p_owner_user_id, owner_name = coalesce(p_owner_name, ''), updated_at = now()
    where id = p_issue_id;
end $$;

grant execute on function public.assign_issue(uuid, uuid, text) to authenticated;
