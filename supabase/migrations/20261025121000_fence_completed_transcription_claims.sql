-- ---------------------------------------------------------------------------
-- Fence completed transcription claims.
--
-- Both claim RPCs admitted any row whose status was not 'processing' (or a
-- stale 'processing' row), including 'completed'. A duplicate submission of a
-- finished meeting therefore re-ran the provider and re-billed. Completed is
-- now a terminal fence: it can never be claimed again. Failed stays retryable;
-- stale processing stays reclaimable. Signatures, access predicates, and
-- grants are unchanged.
-- ---------------------------------------------------------------------------

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
     and transcription_status is distinct from 'completed'
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

create or replace function public.claim_segment_transcription(
  p_meeting_id uuid,
  p_seq integer,
  p_stale_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meeting_audio_segments
     set status = 'processing',
         updated_at = now()
   where meeting_id = p_meeting_id
     and seq = p_seq
     and EXISTS (
       SELECT 1 FROM public.meetings m
       WHERE m.id = p_meeting_id AND public.user_can_access_series(m.series_id)
     )
     and status is distinct from 'completed'
     and (
       status is distinct from 'processing'
       or updated_at < now() - make_interval(secs => p_stale_seconds)
     );

  return found;
end;
$$;

revoke all on function public.claim_segment_transcription(uuid, integer, integer) from public;
grant execute on function public.claim_segment_transcription(uuid, integer, integer) to authenticated, service_role;