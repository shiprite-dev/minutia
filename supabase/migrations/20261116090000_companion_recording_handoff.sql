alter table public.meetings
  add column record_requested_at timestamptz,
  add column record_requested_by uuid references public.profiles(id) on delete set null,
  add column record_claimed_at timestamptz,
  add column recording_user_id uuid references public.profiles(id) on delete set null,
  add column recording_device_id text,
  add column recording_device_name text,
  add column recording_started_at timestamptz,
  add column recording_failed_reason text;

create or replace function public.guard_meeting_companion_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('minutia.companion_rpc', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role' then
    new.record_requested_at := old.record_requested_at;
    new.record_requested_by := old.record_requested_by;
    new.record_claimed_at := old.record_claimed_at;
    new.recording_user_id := old.recording_user_id;
    new.recording_device_id := old.recording_device_id;
    new.recording_device_name := old.recording_device_name;
    new.recording_started_at := old.recording_started_at;
    new.recording_failed_reason := old.recording_failed_reason;
  end if;

  if new.status = 'completed' and old.status <> 'completed' then
    new.record_requested_at := null;
    new.record_requested_by := null;
  end if;

  return new;
end;
$$;

create trigger guard_meeting_companion_columns
  before update on public.meetings
  for each row execute function public.guard_meeting_companion_columns();

create or replace function public.request_companion_record(p_meeting_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.meetings%rowtype;
begin
  select * into m from public.meetings where id = p_meeting_id for update;
  if not found or not public.user_can_manage_series(m.series_id) then
    return 'not_allowed';
  end if;
  if m.status <> 'live' then
    return 'not_live';
  end if;
  if m.recording_user_id is not null
     or (m.record_requested_by is not null
         and m.record_requested_by <> auth.uid()
         and m.record_requested_at > now() - interval '2 minutes') then
    return 'busy';
  end if;

  perform set_config('minutia.companion_rpc', 'on', true);
  update public.meetings
  set record_requested_at = now(),
      record_requested_by = auth.uid(),
      record_claimed_at = null,
      recording_failed_reason = null
  where id = p_meeting_id;
  return 'requested';
end;
$$;

create or replace function public.cancel_companion_record(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('minutia.companion_rpc', 'on', true);
  update public.meetings
  set record_requested_at = null,
      record_requested_by = null
  where id = p_meeting_id
    and record_requested_by = auth.uid()
    and record_claimed_at is null;
end;
$$;

create or replace function public.companion_checkin(
  p_device_id text,
  p_device_name text,
  p_can_claim boolean
)
returns table(meeting_id uuid, series_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
  claimed_series uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  update public.profiles
  set companion_last_seen_at = now()
  where id = auth.uid()
    and (companion_last_seen_at is null
         or companion_last_seen_at < now() - interval '20 seconds');

  if not p_can_claim then
    return;
  end if;

  select m.id, m.series_id into claimed_id, claimed_series
  from public.meetings m
  where m.record_requested_by = auth.uid()
    and m.record_requested_at > now() - interval '2 minutes'
    and m.status = 'live'
    and m.recording_user_id is null
  order by m.record_requested_at desc
  limit 1
  for update skip locked;

  if claimed_id is null then
    return;
  end if;

  perform set_config('minutia.companion_rpc', 'on', true);
  update public.meetings
  set recording_user_id = auth.uid(),
      recording_device_id = p_device_id,
      recording_device_name = p_device_name,
      record_claimed_at = now(),
      record_requested_at = null,
      record_requested_by = null
  where id = claimed_id;

  return query select claimed_id, claimed_series;
end;
$$;

create or replace function public.companion_recording_event(
  p_meeting_id uuid,
  p_device_id text,
  p_device_name text,
  p_event text,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.meetings%rowtype;
  mine boolean;
begin
  select * into m from public.meetings where id = p_meeting_id for update;
  if not found or not public.user_can_access_series(m.series_id) then
    return 'ignored';
  end if;

  mine := m.recording_user_id = auth.uid()
    and m.recording_device_id is not distinct from p_device_id;

  perform set_config('minutia.companion_rpc', 'on', true);

  if p_event = 'started' then
    if m.recording_user_id is not null
       and (m.recording_user_id <> auth.uid()
            or m.recording_device_id is distinct from p_device_id) then
      return 'conflict';
    end if;
    update public.meetings
    set recording_user_id = auth.uid(),
        recording_device_id = p_device_id,
        recording_device_name = p_device_name,
        recording_started_at = now(),
        recording_failed_reason = null,
        record_requested_at = null,
        record_requested_by = null
    where id = p_meeting_id;
    return 'ok';
  elsif p_event = 'failed' then
    if mine
       or (m.recording_user_id is null and m.record_requested_by = auth.uid()) then
      update public.meetings
      set recording_user_id = null,
          recording_device_id = null,
          recording_device_name = null,
          recording_started_at = null,
          record_claimed_at = null,
          record_requested_at = null,
          record_requested_by = null,
          recording_failed_reason = coalesce(p_reason, 'failed')
      where id = p_meeting_id;
      return 'ok';
    end if;
    return 'ignored';
  elsif p_event = 'stopped' then
    if mine then
      update public.meetings
      set recording_user_id = null,
          recording_device_id = null,
          recording_device_name = null,
          record_claimed_at = null,
          recording_started_at = null
      where id = p_meeting_id;
      return 'ok';
    end if;
    return 'ignored';
  end if;

  return 'ignored';
end;
$$;

revoke all on function public.request_companion_record(uuid) from public, anon;
revoke all on function public.cancel_companion_record(uuid) from public, anon;
revoke all on function public.companion_checkin(text, text, boolean) from public, anon;
revoke all on function public.companion_recording_event(uuid, text, text, text, text) from public, anon;
grant execute on function public.request_companion_record(uuid) to authenticated;
grant execute on function public.cancel_companion_record(uuid) to authenticated;
grant execute on function public.companion_checkin(text, text, boolean) to authenticated;
grant execute on function public.companion_recording_event(uuid, text, text, text, text) to authenticated;
