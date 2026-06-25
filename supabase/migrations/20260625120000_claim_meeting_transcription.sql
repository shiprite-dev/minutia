-- Atomic claim as one SQL statement: self-host PostgREST (v12.2.3) ignores or=() on UPDATE.
create or replace function public.claim_meeting_transcription(
  p_meeting_id uuid,
  p_stale_seconds integer default 900
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  update public.meetings
     set transcription_status = 'processing',
         transcription_started_at = now()
   where id = p_meeting_id
     and public.user_can_access_series(series_id)
     and (
       transcription_status is distinct from 'processing'
       or transcription_started_at < now() - make_interval(secs => p_stale_seconds)
     )
  returning id into v_claimed;

  return v_claimed;
end;
$$;

revoke all on function public.claim_meeting_transcription(uuid, integer) from public;
grant execute on function public.claim_meeting_transcription(uuid, integer) to authenticated, service_role;
